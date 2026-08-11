import { ckanDate, fetchCkan } from "../lib/ckan";
import { num, squish, str } from "../lib/parse";
import type {
  CountyAdapter,
  EventParty,
  PropertyCategory,
  PropertyEvent,
  RawRecord,
} from "../types";

const MILWAUKEE_FIPS = "55079";
const HOST = "https://data.milwaukee.gov";

/**
 * Milwaukee land use is a four digit SIC style code, not a word.
 *
 * The 88xx block is where nearly all housing sits and the codes there do not
 * follow SIC's own meaning, so it is listed out from the city's published Land
 * Use Code table rather than inferred. Everything else falls back to the SIC
 * division the code belongs to, which is stable and saves carrying 500 rows.
 *
 * Unrecognised codes are left undefined so the scorer treats them as unknown
 * rather than guessing, which keeps a misread out of the weighting entirely.
 */
export function milwaukeeCategory(value: unknown): PropertyCategory | undefined {
  const raw = squish(value);
  if (!raw || !/^\d{3,4}$/.test(raw)) return undefined;
  const code = Number(raw);

  const HOUSING: Record<number, PropertyCategory> = {
    8800: "residential", // MKE Community Land Trust
    8810: "residential", // single private households
    8811: "residential", // condo
    8820: "multifamily", // two family
    8830: "multifamily", // multi family
    8850: "residential", // residential unit under construction
    8860: "nonprofit", // playground
    8870: "nonprofit", // park
    8871: "nonprofit", // parkway
    8880: "vacant", // vacant lot
    8885: "vacant", // vacant lot with improvements
    8888: "residential", // discontinued residential unit
    8890: "commercial", // skilled care facility
    8899: "multifamily", // mixed residential and commercial
  };
  const housing = HOUSING[code];
  if (housing) return housing;

  if (code >= 2000 && code <= 4999) return "industrial";
  if (code >= 5200 && code <= 5999) return "commercial";
  if (code >= 6000 && code <= 6799) return "commercial";
  if (code >= 8200 && code <= 8499) return "nonprofit";
  if (code >= 8600 && code <= 8699) return "nonprofit"; // churches, membership orgs
  if (code >= 9000) return "nonprofit"; // public administration
  if (code >= 1500 && code <= 8199) return "commercial";
  return undefined;
}

/**
 * Milwaukee's vacant building registry.
 *
 * Filed as a code violation rather than a type of its own. Registration here is
 * a code enforcement action: the Department of Neighborhood Services places a
 * building on the registry and the owner owes a fee, so it is the city
 * recording that something is wrong with a property, which is what
 * CODE_VIOLATION means. Worth revisiting if vacancy ever needs to be scored
 * differently from a citation.
 */
export const milwaukeeVacantAdapter: CountyAdapter = {
  id: "wi-milwaukee-vacant-buildings",
  fips: MILWAUKEE_FIPS,
  eventTypes: ["CODE_VIOLATION"],
  cadence: "0 10 * * *",
  lookbackDays: 45,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchCkan({
      host: HOST,
      resourceId: "46dca88b-fec0-48f1-bda6-7296249ea61f",
      dateField: "DATEOPENED",
      since,
      where: `"ADDRFULLLINE" IS NOT NULL`,
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const occurredAt = ckanDate(record["DATEOPENED"]);
    const address = squish(record["ADDRFULLLINE"]);
    const parcel = str(record["PARCELNBR"]);
    if (!occurredAt || !address || !parcel) return null;

    return {
      fips: MILWAUKEE_FIPS,
      // The registry has no case number, so the parcel and the date it opened
      // are what identify a registration. A building registered, removed, and
      // registered again is genuinely two events.
      externalId: `${parcel}-${occurredAt.toISOString().slice(0, 10)}`,
      type: "CODE_VIOLATION",
      occurredAt,
      property: {
        address,
        city: "MILWAUKEE",
        state: "WI",
        zip: str(record["ZipCode"]),
        parcelPin: parcel,
        category: milwaukeeCategory(record["LANDUSE"]),
      },
      // The registry lists the building, not who owns it. Contact resolution
      // starts from the parcel, and the delinquent tax feed below often has the
      // owner for the same property.
      parties: [],
      raw: record,
    };
  },
};

/**
 * When an unpaid Milwaukee levy actually becomes delinquent.
 *
 * Wisconsin bills in the levy year and the first installment falls due on
 * January 31 of the following year, so a 2025 levy is delinquent from February
 * 1, 2026. The file carries no date column at all, only the levy year, and
 * normalize has to stay pure, so this is derived rather than stamped with the
 * clock. It is the honest date: it is when the debt started, not when we
 * happened to read the file.
 */
export function delinquentFrom(levyYear: number): Date {
  return new Date(Date.UTC(levyYear + 1, 1, 1));
}

function ownerParty(record: RawRecord): EventParty[] {
  const name = squish(record["Owner's Name"]);
  if (!name) return [];

  const mailing = [
    squish(record["Owner's Mailing Address"]),
    squish(record["City"]),
    squish(record["State"]),
    str(record["Zip"]),
  ]
    .filter(Boolean)
    .join(", ");

  return [{ role: "owner", name, address: mailing || undefined }];
}

/**
 * Milwaukee's delinquent real estate tax accounts.
 *
 * The most directly saleable feed in this project. Every row carries the
 * owner's name, their mailing address, and what they owe, which is the whole
 * job for an investor doing direct mail. Most county feeds give a parcel and
 * leave contact resolution as an exercise.
 *
 * It is a snapshot rather than a stream: the city republishes the whole list,
 * so every run reads all of it and dedupe_hash keeps repeat rows from piling
 * up. A property behind on three years produces three events, one per levy
 * year, which is the right shape. Depth of delinquency is real evidence and
 * collapsing it to one event would throw that away.
 */
export const milwaukeeDelinquentTaxAdapter: CountyAdapter = {
  id: "wi-milwaukee-delinquent-tax",
  fips: MILWAUKEE_FIPS,
  eventTypes: ["TAX_DELINQUENT"],
  // Weekly. The city refreshes this file every few days and the underlying debt
  // moves far slower than a permit does.
  cadence: "0 10 * * 1",
  // Nothing to window against, so the lookback only documents intent. The fetch
  // reads the whole file every time because there is no date column to filter.
  lookbackDays: 3650,

  async fetch(since: Date): Promise<RawRecord[]> {
    return fetchCkan({
      host: HOST,
      resourceId: "8f1367e1-6f8f-44cc-8ed6-2eecd8267ec7",
      since,
      where: `"Property Address" IS NOT NULL AND "Tax Key #" IS NOT NULL`,
    });
  },

  normalize(record: RawRecord): PropertyEvent | null {
    const levyYear = num(record["Levy Year"]);
    const address = squish(record["Property Address"]);
    const taxKey = str(record["Tax Key #"]);
    if (!levyYear || !address || !taxKey) return null;

    // A levy year outside living memory is a parse artefact, not a debt.
    if (levyYear < 1990 || levyYear > 2100) return null;

    return {
      fips: MILWAUKEE_FIPS,
      externalId: `${taxKey}-${levyYear}`,
      type: "TAX_DELINQUENT",
      occurredAt: delinquentFrom(levyYear),
      property: {
        address,
        city: "MILWAUKEE",
        state: "WI",
        parcelPin: taxKey,
      },
      parties: ownerParty(record),
      raw: record,
    };
  },
};

/** Exported for the fixture test, which asserts on the amount owed. */
export function taxOwed(record: RawRecord): number | undefined {
  return num(record["Total Tax Principal"]);
}

export const milwaukeeAdapters = [
  milwaukeeVacantAdapter,
  milwaukeeDelinquentTaxAdapter,
] as const;
