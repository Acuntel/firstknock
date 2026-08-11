import { arcgisDate, fetchArcGis } from "../lib/arcgis";
import { squish, str } from "../lib/parse";
import type {
  CountyAdapter,
  EventParty,
  PropertyCategory,
  PropertyEvent,
  RawRecord,
} from "../types";

const ONONDAGA_FIPS = "36067";

// Syracuse code enforcement. The city publishes this, not the county, so
// coverage is Syracuse proper. Skaneateles and the rest of Onondaga are not in
// here, which is a real limit worth knowing before promising a lead in either.
//
// Syracuse publishes several other layers and almost all of them are abandoned:
// fire incidents and building permits both stop in December 2019, permit
// requests stopped in August 2025. This one is current to yesterday, so it is
// the only Syracuse feed worth building on.
const LAYER =
  "https://services6.arcgis.com/bdPqSfflsdgFRVVM/arcgis/rest/services/Code_Violations_V2/FeatureServer/0";

/**
 * Category, taken from the vacancy column rather than the violation text.
 *
 * The Vacant column is misleadingly named. It is not a yes or no flag: it is
 * empty for an occupied property and holds the property class, "Residential" or
 * "Commercial", when the city has recorded the building as vacant. So the one
 * column answers both questions, and it is the only field on this feed that
 * states a class at all.
 *
 * The violation text is no use for this. It is nearly all code citations, along
 * the lines of "2025 PMCNYS - Section 305.3 - Interior Surfaces", which says
 * what was breached and nothing about the building. Occupied properties are
 * therefore left undefined, so the scorer treats them as unknown rather than
 * assuming a house.
 */
export function syracuseCategory(record: RawRecord): PropertyCategory | undefined {
  const vacancyClass = squish(record["Vacant"])?.toUpperCase();
  if (!vacancyClass) return undefined;

  if (vacancyClass.startsWith("COMMERCIAL")) return "commercial";
  if (vacancyClass.startsWith("RESIDENTIAL")) return "residential";
  return undefined;
}

/**
 * Whoever the city cited, which is normally the owner.
 *
 * This feed carries the name and a separate mailing address, which is unusual
 * and valuable: most county feeds give a parcel and leave contact resolution as
 * an exercise. Recording the mailing address as its own party field is what
 * lets Phase 4 skip straight to a letter.
 */
function citedParty(record: RawRecord): EventParty[] {
  const name = squish(record["issued_to"]);
  if (!name) return [];

  const mailing = [
    squish(record["issued_to_address"]),
    squish(record["issued_to_city"]),
    str(record["issued_to_zip"]),
  ]
    .filter(Boolean)
    .join(", ");

  return [{ role: "owner", name, address: mailing || undefined }];
}

export const onondagaSyracuseViolationsAdapter: CountyAdapter = {
  id: "ny-onondaga-syracuse-violations",
  fips: ONONDAGA_FIPS,
  eventTypes: ["CODE_VIOLATION"],
  cadence: "0 9 * * *",
  // Syracuse posts violations within a day or two of the inspection. The window
  // absorbs a backdated batch rather than a publication delay.
  lookbackDays: 30,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchArcGis({
      layerUrl: LAYER,
      dateField: "violation_date",
      since,
      // A violation with no address cannot be knocked on or mailed to.
      where: "complaint_address IS NOT NULL",
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = arcgisDate(record["violation_date"]);
    const address = squish(record["complaint_address"]);

    // violation_id identifies the citation. complaint_number groups several
    // citations raised from one complaint, so using it would collapse distinct
    // violations on the same property into one event.
    const externalId = str(record["violation_id"]);
    if (!occurredAt || !externalId || !address) return null;

    return {
      fips: ONONDAGA_FIPS,
      type: "CODE_VIOLATION",
      occurredAt,
      externalId,
      property: {
        address,
        city: "SYRACUSE",
        state: "NY",
        zip: str(record["complaint_zip"]),
        // SBL is New York's section block lot, the state's parcel identifier.
        parcelPin: str(record["SBL"]),
        category: syracuseCategory(record),
      },
      parties: citedParty(record),
      raw: record,
    };
  },
};

/**
 * True when the city recorded the property as vacant.
 *
 * Vacancy is the strongest single signal on this feed for a flipper or a
 * restoration company: nobody is living there, the owner is carrying it, and
 * the city has just put a citation on the record.
 *
 * Presence, not equality. The column holds the property class when vacant and
 * nothing when occupied, so testing it against "Y" finds nothing at all, which
 * is exactly the bug the first version of this shipped with.
 */
export function isVacant(record: RawRecord): boolean {
  return squish(record["Vacant"]) !== undefined;
}
