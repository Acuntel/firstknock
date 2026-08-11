import { fetchSocrata } from "../lib/socrata";
import { num, str } from "../lib/parse";
import { propertyCategory } from "../scoring/class-fit";
import type { EventSignals } from "../scoring/types";
import type { PropertyEvent, RawRecord } from "../types";

/**
 * Fills in what an event source left out, by parcel.
 *
 * Distinct from a CountyAdapter, and the distinction is load bearing. An
 * adapter answers "what happened"; an enricher answers "what is this property
 * worth and what is it". DuPage, Saratoga, and Onondaga all publish the second
 * kind and none of the first, which is why forcing them into the adapter shape
 * would have produced county-wide lists that never change.
 */
export interface Enricher {
  id: string;
  fips: string;
  /** Batched on purpose: one query per run, not one per lead. */
  enrich(events: PropertyEvent[]): Promise<Map<string, Enrichment>>;
}

export interface Enrichment {
  signals: EventSignals;
  /** Overrides the event's own category when the source had none. */
  category?: PropertyEvent["property"]["category"];
  classCode?: string;
}

const COOK_FIPS = "17031";
const DOMAIN = "datacatalog.cookcountyil.gov";
const ASSESSED_VALUES = "uzyt-m557";

/** Socrata caps a single IN list, so PINs go up in batches. */
const PIN_BATCH = 200;

function quoted(pins: string[]): string {
  return pins.map((pin) => `'${pin.replace(/'/g, "")}'`).join(",");
}

/**
 * Cook assessed values, joined by parcel.
 *
 * This is the half of the value gap term that has been missing since Phase 2.
 * The sales feed publishes a price and no assessment, so the investor preset's
 * highest weighted input has never once fired. Joining the assessor's own
 * figures by PIN is what turns it on.
 *
 * It also gives Cook permits a property class. Permits carry no assessor class
 * at all, so until now their category came from reading "COMMERCIAL PERMIT" out
 * of a job code. The assessor's class is the better answer where a PIN matches.
 */
export const cookAssessedValues: Enricher = {
  id: "il-cook-socrata-assessed-values",
  fips: COOK_FIPS,

  async enrich(events: PropertyEvent[]): Promise<Map<string, Enrichment>> {
    const pins = [
      ...new Set(
        events
          .filter((event) => event.fips === COOK_FIPS)
          .map((event) => event.property.parcelPin)
          .filter((pin): pin is string => Boolean(pin)),
      ),
    ];

    const found = new Map<string, Enrichment>();
    if (pins.length === 0) return found;

    for (let i = 0; i < pins.length; i += PIN_BATCH) {
      const batch = pins.slice(i, i + PIN_BATCH);
      const rows = await fetchSocrata({
        domain: DOMAIN,
        datasetId: ASSESSED_VALUES,
        // Ordered by year so the newest assessment lands last and wins.
        dateField: "year",
        // Three years covers a full cycle: Cook reassesses each township on a
        // rolling three year schedule, so a shorter window misses parcels that
        // are simply not due yet.
        where: `pin in (${quoted(batch)}) AND year >= ${new Date().getUTCFullYear() - 3}`,
        pageSize: 1000,
      });

      for (const row of rows) {
        const enrichment = fromAssessmentRow(row);
        const pin = str(row["pin"]);
        if (!pin || !enrichment) continue;

        // Rows arrive oldest first, so newer years overwrite older ones. But
        // newest is not the same as useful: the current year's row exists from
        // the moment the roll opens and carries no values until the township is
        // certified, so a blind overwrite replaces a real 2024 assessment with
        // an empty 2026 one. A row without a value may update the class and
        // nothing else.
        const existing = found.get(pin);
        if (enrichment.signals.assessedValue !== undefined || !existing) {
          found.set(pin, enrichment);
        } else {
          found.set(pin, {
            ...existing,
            classCode: enrichment.classCode ?? existing.classCode,
            category: enrichment.category ?? existing.category,
          });
        }
      }
    }

    return found;
  },
};

/**
 * Reads one assessment row.
 *
 * The board figure wins where it exists: it is the value after any appeal, and
 * therefore the one the owner is actually taxed on. Certified is the fallback,
 * and the mailed figure is only a first pass.
 */
/**
 * Cook's level of assessment, the fraction of market value a parcel is assessed
 * at by ordinance: 10 percent for residential, 25 percent for commercial and
 * industrial.
 *
 * This conversion is not optional. The value gap term compares an assessment to
 * a sale price, and a raw Cook assessment is roughly a tenth of what a house
 * sells for. Comparing the two directly makes every property look wildly
 * overpriced and the term fires backwards on every lead in the county.
 *
 * The two rates are Cook ordinance and stable. Whether other counties need
 * their own is question 14 in docs/OPEN_QUESTIONS.md.
 */
function marketValueFrom(assessed: number, classCode: string | undefined): number {
  const category = classCode ? propertyCategory(COOK_FIPS, classCode) : "unknown";
  const level = category === "commercial" || category === "industrial" ? 0.25 : 0.1;
  return Math.round(assessed / level);
}

export function fromAssessmentRow(row: RawRecord): Enrichment | null {
  const assessed =
    num(row["board_tot"]) ?? num(row["certified_tot"]) ?? num(row["mailed_tot"]);
  const classCode = str(row["class"]);

  if (assessed === undefined && !classCode) return null;

  const category =
    classCode && classCode !== "EX"
      ? propertyCategory(COOK_FIPS, classCode)
      : undefined;

  return {
    signals:
      assessed !== undefined && assessed > 0
        ? { assessedValue: marketValueFrom(assessed, classCode) }
        : {},
    category: category === "unknown" ? undefined : category,
    classCode: classCode ?? undefined,
  };
}

/**
 * Folds enrichment back onto events.
 *
 * The event's own values win where it has them: the source that saw the
 * transaction is more current than an annual assessment roll. Enrichment fills
 * gaps, it does not overwrite.
 */
export function applyEnrichment(
  events: PropertyEvent[],
  found: Map<string, Enrichment>,
): Array<PropertyEvent & { signals?: EventSignals }> {
  return events.map((event) => {
    const pin = event.property.parcelPin;
    const extra = pin ? found.get(pin) : undefined;
    if (!extra) return event;

    return {
      ...event,
      property: {
        ...event.property,
        class: event.property.class ?? extra.classCode,
        category: event.property.category ?? extra.category,
      },
      signals: { ...extra.signals },
    };
  });
}
