import { arcgisDate, fetchArcGis } from "../lib/arcgis";
import { num, squish, str } from "../lib/parse";
import type {
  CountyAdapter,
  EventParty,
  PropertyCategory,
  PropertyEvent,
  RawRecord,
} from "../types";

const WAYNE_FIPS = "26163";

// Detroit's Buildings, Safety Engineering and Environmental Department. The
// city publishes this, not the county, so coverage is Detroit rather than all
// of Wayne. That is the right starting point for Mike Ostrowski and it is a
// real limit worth knowing: a job in Dearborn or Livonia will not appear here.
const LAYER =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0";

/**
 * Detroit records the use type as free text, and the same thing is spelled
 * several ways: "One Family", "ONE FAMILY DWELLING", "Single-Family". Matching
 * on substrings rather than an enumerated list is what survives that.
 *
 * Anything unrecognised is left undefined so the scorer treats it as unknown
 * rather than guessing, which keeps a misread out of the weighting entirely.
 */
export function detroitCategory(value: unknown): PropertyCategory | undefined {
  const raw = squish(value)?.toUpperCase();
  if (!raw) return undefined;

  if (/APARTMENT|MULTIPLE|CO-?OP|CONDO|TOWNHOUS|ROOMING/.test(raw)) return "multifamily";
  if (/SINGLE|ONE FAMILY|TWO FAMILY|1 FAMILY|2 FAMILY|DWELLING|RESIDEN/.test(raw)) {
    return "residential";
  }
  if (/WAREHOUS|INDUSTRIAL|FACTORY|MANUFACTUR|STORAGE/.test(raw)) return "industrial";
  if (/SCHOOL|CHURCH|RELIGIOUS|HOSPITAL|MUSEUM|LIBRARY/.test(raw)) return "nonprofit";
  if (
    /OFFICE|RETAIL|RESTAURANT|STORE|COMMERCIAL|BUSINESS|HOTEL|MOTEL|CHILD CARE|DAY ?CARE|CLINIC|SALON|GARAGE|BANK/.test(
      raw,
    )
  ) {
    return "commercial";
  }
  if (/VACANT|LAND/.test(raw)) return "vacant";
  return undefined;
}

/**
 * Detroit splits the street across columns and also ships a joined address.
 *
 * The fallback requires both a number and a street name. Assembling whatever
 * columns happen to be populated produces fragments like "St", which is not an
 * address and would sail through as one.
 */
function streetAddress(record: RawRecord): string | undefined {
  const joined = squish(record["address"]);
  if (joined) return joined;

  const number = str(record["street_number"]);
  const name = str(record["street_name"]);
  if (!number || !name) return undefined;

  return [number, str(record["street_prefix"]), name, str(record["street_type"])]
    .filter(Boolean)
    .join(" ");
}

export const wayneDetroitPermitsAdapter: CountyAdapter = {
  id: "mi-wayne-detroit-permits",
  fips: WAYNE_FIPS,
  eventTypes: ["PERMIT"],
  // Mike's digest is 7am Eastern. The pull runs before it.
  cadence: "0 9 * * *",
  // Detroit issues and publishes same day, unlike Cook's 75 day sale lag. The
  // window is wide only to absorb a backdated batch, not a publication delay.
  lookbackDays: 30,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchArcGis({
      layerUrl: LAYER,
      dateField: "issued_date",
      since,
      // Rows without an address cannot be knocked on or mailed to, so they are
      // dropped in the query rather than fetched and discarded.
      where: "address IS NOT NULL",
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = arcgisDate(record["issued_date"]);
    const externalId = str(record["record_id"]);
    const address = streetAddress(record);
    if (!occurredAt || !externalId || !address) return null;

    // The permit applicant is not published on this feed, so there is no party
    // to record. Contact resolution starts from the parcel in Phase 4.
    const parties: EventParty[] = [];

    return {
      fips: WAYNE_FIPS,
      type: "PERMIT",
      occurredAt,
      externalId,
      property: {
        address,
        city: "DETROIT",
        state: "MI",
        zip: str(record["zip_code"]),
        parcelPin: str(record["parcel_id"])?.replace(/\.$/, ""),
        category: detroitCategory(record["current_use_type"]),
      },
      parties,
      raw: record,
    };
  },
};

/** Exported for the fixture test, which asserts on the parsed job value. */
export function contractorCost(record: RawRecord): number | undefined {
  return num(record["amt_estimated_contractor_cost"]);
}
