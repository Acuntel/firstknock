import type {
  EventParty,
  EventProperty,
  EventType,
  PropertyCategory,
} from "../types";

// The category lives on the event contract in ../types, because adapters set it
// directly when a county states the use type without a class code. Re-exported
// so scoring consumers have one import site for the whole vocabulary.
export type { PropertyCategory };

export interface ForeclosureStageWindow {
  /** Upper bound of the window, in days between now and the auction. */
  maxDaysToSale: number;
  multiplier: number;
}

export interface ForeclosureStageConfig {
  enabled: boolean;
  /** Evaluated in order, first match wins, so keep them ascending. */
  windows: ForeclosureStageWindow[];
  /** Applied once the auction date has passed. */
  pastSaleMultiplier: number;
}

export interface ScoreWeights {
  eventSeverity: Partial<Record<EventType, number>>;
  freshnessHalfLifeHours: number;
  /**
   * Per event type override of the half life.
   *
   * A single global half life cannot work across feeds that publish at wildly
   * different speeds. Cook posts a sale about 75 days after the closing, so the
   * steep decay the spec asks for would score every sale that exists at zero.
   * A sale is not stale at 75 days, that is simply the freshest the county has.
   * Fire and permit events are genuinely time critical and keep short half lives.
   */
  freshnessHalfLifeByType?: Partial<Record<EventType, number>>;
  valueGap: number;
  propertyClassFit: Partial<Record<PropertyCategory, number>>;
  distanceDecayMiles: number;
  absenteeOwnerBonus?: number;
  foreclosureStage?: ForeclosureStageConfig;
}

export interface VerticalPreset {
  id: string;
  label: string;
  eventTypes: EventType[];
  weights: ScoreWeights;
  digest: { subject: string; leadNoun: string; topN: number };
  outreach: { emailTemplate: string; letterTemplate: string; doorScript: string };
  hotPingDefault: number;
}

export interface ServiceArea {
  lat: number;
  lng: number;
  radiusMiles: number;
}

/**
 * The tenant fields scoring actually reads. Deliberately narrower than the
 * tenants table so the engine can be exercised without a database.
 */
export interface ScoringTenant {
  id?: string;
  name: string;
  verticalPresetId: string;
  /** Cloned from the preset at onboarding, then edited per tenant. */
  weights: ScoreWeights;
  excludedTowns: string[];
  serviceArea?: ServiceArea;
  hotPingThreshold?: number;
}

/**
 * Enrichments that are not on an event today but that scoring is built to use.
 *
 * None of these are available from the Cook feeds: the sales dataset carries no
 * assessed value, and neither sales nor permits carry coordinates. They are
 * modelled now so the weights are real rather than invented later, and every
 * component reports whether it had data instead of silently contributing zero.
 */
export interface EventSignals {
  assessedValue?: number;
  lastSalePrice?: number;
  /** Scheduled sheriff sale or auction date, for the foreclosure windows. */
  auctionDate?: Date;
}

export interface ScorableEvent {
  type: EventType;
  occurredAt: Date;
  fips: string;
  property: EventProperty;
  parties: EventParty[];
  signals?: EventSignals;
}

export interface ScoreComponent {
  /** Multiplier applied to the running score, or points added for bonuses. */
  value: number;
  /** How the component acts on the score. */
  kind: "base" | "multiplier" | "bonus";
  /** Plain sentence for the lead detail view. */
  explanation: string;
  /** False when the underlying data was missing, so it stayed neutral. */
  available: boolean;
}

export interface ScoreBreakdown {
  score: number;
  excluded: boolean;
  excludedReason: string | null;
  components: {
    severity: ScoreComponent;
    freshness: ScoreComponent;
    propertyClass: ScoreComponent;
    distance: ScoreComponent;
    foreclosureStage: ScoreComponent;
    absenteeOwner: ScoreComponent;
    valueGap: ScoreComponent;
  };
  /** Timestamp the score was computed against, so a score can be reproduced. */
  scoredAt: string;
  /** Config identity, so a score can be traced to the weights that made it. */
  presetId: string;
}
