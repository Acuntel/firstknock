// The adapter contract. BUILD_SPEC section 3 is the source of record for this
// file: if the two disagree, the spec wins and this file is the bug.

export type EventType =
  | "LIS_PENDENS"
  | "JUDGMENT"
  | "NOTICE_OF_SALE"
  | "TAX_DELINQUENT"
  | "PERMIT"
  | "SALE"
  | "HOA_REGISTRATION"
  | "FIRE_INCIDENT";

/** Whatever the county handed back, untouched. Adapters narrow it themselves. */
export type RawRecord = Record<string, unknown>;

export type PartyRole =
  | "owner"
  | "buyer"
  | "seller"
  | "applicant"
  | "appellant"
  | "attorney";

export interface EventParty {
  role: PartyRole;
  name: string;
  address?: string;
}

/**
 * How a property is used, which is what the vertical presets weight against.
 * Counties express this in incompatible ways, so adapters normalize to this.
 */
export type PropertyCategory =
  | "residential"
  | "multifamily"
  | "commercial"
  | "industrial"
  | "vacant"
  | "nonprofit"
  | "unknown";

export interface EventProperty {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** County parcel identifier. Cook calls it a PIN. */
  parcelPin?: string;
  lat?: number;
  lng?: number;
  /** County property class code, used by the vertical fit weighting. */
  class?: string;
  /**
   * Use type stated by the source directly, when it says so without a class
   * code. Cook's permit feed is the case that forced this: permits carry no
   * assessor class at all, but they do say "COMMERCIAL PERMIT", and without
   * reading that a roofer's commercial permit weighting could never fire.
   * Takes precedence over `class` during scoring.
   */
  category?: PropertyCategory;
}

export interface PropertyEvent {
  fips: string;
  type: EventType;
  occurredAt: Date;
  /**
   * The county's own stable identifier for this record. Combined with fips, type,
   * occurredAt, and the parcel it becomes the dedupe hash, which is what makes
   * re-polling the same window idempotent. Adapters do not hash anything
   * themselves, so the hash rule stays in one place.
   */
  externalId: string;
  property: EventProperty;
  parties: EventParty[];
  raw: RawRecord;
}

export interface CountyAdapter {
  /** Registry key, e.g. il-cook-socrata-sales. Matches sources.adapter_id. */
  id: string;
  /** Five character county FIPS, e.g. 17031 for Cook. */
  fips: string;
  eventTypes: EventType[];
  /** Cron expression describing how often this source should be polled. */
  cadence: string;
  /**
   * How far back every poll reaches, in days. Sized to the county's publication
   * lag, not to how often we poll.
   *
   * This is required rather than optional because getting it wrong is silent.
   * Cook publishes a sale roughly 75 days after it happens, and `since` filters
   * on the sale date, so a window narrower than that lag returns zero rows
   * forever while every source still reports healthy. Every new county pack has
   * to answer "how far behind is this feed" before it ships.
   *
   * Re-reading the same window daily costs nothing: the dedupe hash turns
   * everything already stored into a no-op insert.
   */
  lookbackDays: number;
  fetch(since: Date): Promise<RawRecord[]>;
  /** Pure. Fixture in, normalized event out. Null means discard the row. */
  normalize(r: RawRecord): PropertyEvent | null;
}
