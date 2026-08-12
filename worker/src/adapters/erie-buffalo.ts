import { fetchSocrata } from "../lib/socrata";
import { socrataDate, squish, str } from "../lib/parse";
import type {
  CountyAdapter,
  PropertyCategory,
  PropertyEvent,
  RawRecord,
} from "../types";

const ERIE_FIPS = "36029";

// Buffalo's code enforcement casework, 250,000 records and still being added to.
// The city publishes this itself, so coverage is Buffalo rather than all of
// Erie. Suburbs like Cheektowaga and Amherst will not appear.
const DOMAIN = "data.buffalony.gov";
const DATASET = "ivrf-k9vm";

/**
 * New York's RPS property class codes, mapped by range.
 *
 * The state assigns every parcel a three digit code and the hundreds digit is
 * the division, which is why this reads ranges rather than listing 400 values.
 * Buffalo carries this on every violation, which Syracuse's feed does not, so
 * Buffalo leads know what kind of building they are about.
 *
 * https://www.tax.ny.gov/research/property/assess/manuals/prclas.htm
 */
export function nyPropertyCategory(value: unknown): PropertyCategory | undefined {
  const raw = squish(value);
  if (!raw || !/^\d{3}$/.test(raw)) return undefined;
  const code = Number(raw);

  // 210 through 260 are one to three family homes and seasonal residences.
  // 280 and above in the 200s are multiple dwellings on one parcel.
  if (code >= 200 && code < 280) return "residential";
  if (code >= 280 && code < 300) return "multifamily";
  if (code >= 300 && code < 400) return "vacant";
  if (code >= 400 && code < 500) return "commercial";
  if (code >= 500 && code < 600) return "commercial"; // recreation and entertainment
  if (code >= 600 && code < 700) return "nonprofit"; // community services
  if (code >= 700 && code < 800) return "industrial";
  if (code >= 800 && code < 900) return "industrial"; // public utilities
  if (code >= 900) return "nonprofit"; // parks, forest, conservation
  return undefined;
}

/**
 * True when the case is still open against the property.
 *
 * A closed violation is history: the owner already dealt with it, and pitching
 * them a repair they have finished is how a lead list loses credibility. Only
 * the status field says this, so it is read rather than inferred from dates.
 */
export function isOpenCase(record: RawRecord): boolean {
  const status = squish(record["status"])?.toUpperCase();
  return status === "ACTIVE" || status === "OPEN" || status === "PENDING";
}

export const erieBuffaloViolationsAdapter: CountyAdapter = {
  id: "ny-erie-buffalo-violations",
  fips: ERIE_FIPS,
  eventTypes: ["CODE_VIOLATION"],
  cadence: "0 9 * * *",
  // Buffalo posts in batches rather than daily, and the newest record is
  // typically a couple of weeks back, so the window has to cover the gap.
  lookbackDays: 60,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchSocrata({
      domain: DOMAIN,
      datasetId: DATASET,
      dateField: "date",
      since,
      // Closed cases are dropped in the query rather than fetched and
      // discarded, and a case with no address cannot be visited or mailed to.
      where: "address IS NOT NULL AND upper(status) in ('ACTIVE','OPEN','PENDING')",
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = socrataDate(record["date"]);
    const address = squish(record["address"]);
    // uniquekey identifies the violation. case_number groups every violation
    // raised under one case, so keying on it would collapse them into one.
    const externalId = str(record["uniquekey"]) ?? str(record["case_number"]);
    if (!occurredAt || !address || !externalId) return null;

    return {
      fips: ERIE_FIPS,
      type: "CODE_VIOLATION",
      occurredAt,
      externalId,
      property: {
        address,
        city: squish(record["city"]) ?? "BUFFALO",
        state: "NY",
        zip: str(record["zip"]),
        // SBL is New York's section block lot, the state's parcel identifier.
        parcelPin: str(record["sbl"]),
        category: nyPropertyCategory(record["propclass"]),
      },
      // Buffalo publishes the inspector but not the owner, so there is nobody
      // to record as a party. Contact resolution starts from the parcel.
      parties: [],
      raw: record,
    };
  },
};
