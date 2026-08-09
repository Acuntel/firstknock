import type {
  CountyAdapter,
  EventParty,
  PropertyCategory,
  PropertyEvent,
  RawRecord,
} from "../types";
import { fetchSocrata } from "../lib/socrata";
import { num, parcelPin, socrataDate, squish, str } from "../lib/parse";

const COOK_FIPS = "17031";
const DOMAIN = "datacatalog.cookcountyil.gov";

// Poll before the digest hours in DESIGN_PARTNERS.md. Paul is the earliest at
// 6:30am Central, so the county pull has to be finished before that.
const CADENCE = "0 5 * * *";

/**
 * Municipality arrives as "VILLAGE OF BARRINGTON". The bare town name is what the
 * tenant level exclusion list compares against, so it gets stored that way.
 */
function townName(value: unknown): string | undefined {
  const raw = squish(value);
  if (!raw) return undefined;
  const stripped = raw.replace(/^(VILLAGE|CITY|TOWN|TOWNSHIP)\s+OF\s+/i, "");
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * Cook permits carry no assessor class, but job_code_primary states the use
 * type outright. Counts across the full feed: 536,647 residential, 93,323
 * commercial, 14,781 exempt, and a long tail. Anything not clearly one of these
 * is left undefined so the scorer treats it as unknown rather than guessing.
 */
function permitCategory(value: unknown): PropertyCategory | undefined {
  const raw = squish(value)?.toUpperCase();
  if (!raw) return undefined;
  if (raw.includes("RESIDENTIAL")) return "residential";
  if (raw.includes("COMMERCIAL") || raw.includes("OFFICE")) return "commercial";
  if (raw.includes("RAILROAD")) return "industrial";
  if (raw.includes("EXEMPT")) return "nonprofit";
  return undefined;
}

/**
 * Permit addresses arrive with the zip glued onto the street line, as in
 * "18231 PARK AV 60430". Splitting it here keeps the letter templates in Phase 4
 * from having to re-parse a field the county already told us.
 */
function splitAddress(value: unknown): {
  street: string | undefined;
  zip: string | undefined;
} {
  const raw = squish(value);
  if (!raw) return { street: undefined, zip: undefined };

  const match = /^(.*?)[\s,]+(\d{5})$/.exec(raw);
  if (!match) return { street: raw, zip: undefined };

  const street = match[1]?.trim();
  return {
    street: street && street.length > 0 ? street : undefined,
    zip: match[2],
  };
}

// ---------------------------------------------------------------------------
// Parcel sales. Feeds the roofing preset's recent sale signal and the investor
// preset's value gap comparison.
// ---------------------------------------------------------------------------

export const cookSalesAdapter: CountyAdapter = {
  id: "il-cook-socrata-sales",
  fips: COOK_FIPS,
  eventTypes: ["SALE"],
  cadence: CADENCE,
  // Measured against the live feed on 2026-08-09: the newest sale_date in the
  // dataset was 2026-05-28, a lag of 73 days, because a deed has to be recorded
  // and processed before it appears. Anything under about 90 days here returns
  // zero rows every run. 120 leaves room for the lag to worsen seasonally.
  lookbackDays: 120,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchSocrata({
      domain: DOMAIN,
      datasetId: "wvhk-k5uv",
      dateField: "sale_date",
      since,
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = socrataDate(record["sale_date"]);
    const pin = parcelPin(record["pin"]);
    const externalId = str(record["row_id"]) ?? str(record["doc_no"]);
    if (!occurredAt || !pin || !externalId) return null;

    // Cook flags these itself. Both are the county telling us the row is not a
    // real arms length transfer, which would poison the value gap weighting.
    if (record["sale_filter_less_than_10k"] === true) return null;
    if (record["sale_filter_deed_type"] === true) return null;

    const parties: EventParty[] = [];
    const seller = squish(record["seller_name"]);
    if (seller) parties.push({ role: "seller", name: seller });
    const buyer = squish(record["buyer_name"]);
    if (buyer) parties.push({ role: "buyer", name: buyer });

    return {
      fips: COOK_FIPS,
      type: "SALE",
      occurredAt,
      externalId,
      property: {
        state: "IL",
        parcelPin: pin,
        class: str(record["class"]),
      },
      parties,
      raw: record,
    };
  },
};

// ---------------------------------------------------------------------------
// Assessor permits. The primary signal for the roofing and restoration presets:
// a permit means work is happening on a specific building right now.
// ---------------------------------------------------------------------------

export const cookPermitsAdapter: CountyAdapter = {
  id: "il-cook-socrata-permits",
  fips: COOK_FIPS,
  eventTypes: ["PERMIT"],
  cadence: CADENCE,
  // Permits arrive promptly, within days of issue. The wider window is cheap
  // insurance against a municipality submitting a batch late.
  lookbackDays: 45,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchSocrata({
      domain: DOMAIN,
      datasetId: "6yjf-dfxs",
      dateField: "date_issued",
      since,
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = socrataDate(record["date_issued"]);
    const pin = parcelPin(record["pin"]);
    const externalId = str(record["row_id"]) ?? str(record["local_permit_number"]);
    if (!occurredAt || !pin || !externalId) return null;

    const { street, zip } = splitAddress(record["property_address"]);

    // The applicant is sometimes the owner and sometimes the contractor, so it is
    // recorded as its own role rather than assumed to be either. Phase 4 decides.
    const parties: EventParty[] = [];
    const applicant = squish(record["applicant_name"]);
    if (applicant) parties.push({ role: "applicant", name: applicant });

    return {
      fips: COOK_FIPS,
      type: "PERMIT",
      occurredAt,
      externalId,
      property: {
        address: street,
        city: townName(record["municipality"]),
        state: "IL",
        zip,
        parcelPin: pin,
        category: permitCategory(record["job_code_primary"]),
      },
      parties,
      raw: record,
    };
  },
};

/**
 * Cook County pack.
 *
 * Assessment appeals are named in BUILD_SPEC section 3 as part of this pack but
 * have no matching value in the EventType union, so that adapter is not built
 * yet. The saved fixture and the open question are in docs/OPEN_QUESTIONS.md.
 */
export const cookAdapters: CountyAdapter[] = [cookSalesAdapter, cookPermitsAdapter];

/** Exported for the fixture tests, which assert on the parsed sale price. */
export function salePrice(record: RawRecord): number | undefined {
  return num(record["sale_price"]);
}
