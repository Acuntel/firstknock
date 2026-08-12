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

// Detroit's blight ticket docket, 898,000 records and added to daily.
//
// A far better feed than the permits already ingested from the same city. The
// permits only ever say "Alteration", which names no trade, while every blight
// ticket says in plain English what is wrong: excessive weeds, bulk solid waste,
// failure to register a vacant building. It also carries the property owner's
// name and mailing address, which almost no county publishes.
const LAYER =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0";

/**
 * Category from the ordinance text, which names the building type.
 *
 * Detroit writes the dwelling type into the ordinance description itself, so
 * "one- or two-family dwelling or commercial Building" is doing double duty as
 * both the violation and the class. Anything ambiguous is left undefined so the
 * scorer treats it as unknown rather than guessing.
 */
export function blightCategory(record: RawRecord): PropertyCategory | undefined {
  const text = squish(record["ordinance_description"])?.toUpperCase();
  if (!text) return undefined;

  if (/VACANT LOT|VACANT LAND/.test(text)) return "vacant";
  if (/MULTIPLE DWELLING|APARTMENT|MULTI-?FAMILY/.test(text)) return "multifamily";
  if (/ONE- OR TWO-FAMILY|ONE OR TWO FAMILY|SINGLE FAMILY|RESIDENTIAL/.test(text)) {
    return "residential";
  }
  if (/COMMERCIAL|BUSINESS|INDUSTRIAL/.test(text)) return "commercial";
  return undefined;
}

/**
 * The owner the ticket was written against, with where to post a letter.
 *
 * The reason this feed is worth more than Detroit's permits. Contact resolution
 * is normally the expensive half of a lead, and here the city has already done
 * it: name, street, city, state and zip, on the same row as the violation.
 */
function ticketedOwner(record: RawRecord): EventParty[] {
  const name = squish(record["property_owner_name"]);
  if (!name) return [];

  const mailing = [
    squish(record["property_owner_address"]),
    squish(record["property_owner_city"]),
    squish(record["property_owner_state"]),
    str(record["property_owner_zip_code"]),
  ]
    .filter(Boolean)
    .join(", ");

  return [{ role: "owner", name, address: mailing || undefined }];
}

export const wayneBlightTicketsAdapter: CountyAdapter = {
  id: "mi-wayne-detroit-blight",
  fips: WAYNE_FIPS,
  eventTypes: ["CODE_VIOLATION"],
  cadence: "0 9 * * *",
  lookbackDays: 45,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchArcGis({
      layerUrl: LAYER,
      dateField: "ticket_issued_date",
      since,
      // The upper bound is not tidiness. The docket contains tickets dated 3016,
      // the same typed-year rubbish Cook County ships, and without this they sort
      // to the front of a descending window and fill the first page with
      // nonsense. The runner would drop them later; this stops them being
      // fetched at all.
      where: "address IS NOT NULL AND ticket_issued_date <= CURRENT_TIMESTAMP",
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = arcgisDate(record["ticket_issued_date"]);
    const address = squish(record["address"]);
    const externalId = str(record["ticket_id"]) ?? str(record["ticket_number"]);
    if (!occurredAt || !address || !externalId) return null;

    return {
      fips: WAYNE_FIPS,
      type: "CODE_VIOLATION",
      occurredAt,
      externalId,
      property: {
        address,
        city: "DETROIT",
        state: "MI",
        zip: str(record["zip_code"]),
        // The trailing dot is Detroit's own formatting, not part of the parcel.
        parcelPin: str(record["parcel_id"])?.replace(/\.$/, ""),
        category: blightCategory(record),
      },
      parties: ticketedOwner(record),
      raw: record,
    };
  },
};

/** Exported for the fixture test, which asserts on the fine. */
export function fineAmount(record: RawRecord): number | undefined {
  return num(record["amt_fine"]);
}
