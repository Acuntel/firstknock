import { weightsFromPreset } from "./scoring/presets";
import type { ScoringTenant, ScoreWeights, ServiceArea } from "./scoring/types";

/**
 * The five design partners from ben/DESIGN_PARTNERS.md, as tenant fixtures.
 *
 * Their configs are the acceptance test for V1: "when all five configs work end
 * to end, V1 ships". Everything here traces to a line in that doc, and the
 * weight overrides are the config notes made concrete.
 *
 * Weights are cloned from the preset and then edited, never shared with it, so
 * a later preset change cannot silently retune a live tenant.
 */
export interface DesignPartnerTenant {
  key: string;
  name: string;
  plan: "solo" | "pro" | "team";
  verticalPresetId: string;
  /** County FIPS codes this tenant subscribes to. */
  counties: string[];
  excludedTowns: string[];
  serviceArea: ServiceArea;
  digestHour: number;
  digestMinute: number;
  digestCadence: "daily" | "weekly_monday";
  digestChannels: string[];
  hotPingThreshold: number;
  complianceFooter: string | null;
  weights: ScoreWeights;
  /** Why this tenant is configured the way it is, for the settings screen. */
  note: string;
}

// Service area centres. Coarse on purpose: the radius is what does the work,
// and a partner's exact address is not this repo's business.
const CHICAGO: ServiceArea = { lat: 41.8781, lng: -87.6298, radiusMiles: 35 };
const ROCKFORD: ServiceArea = { lat: 42.2711, lng: -89.094, radiusMiles: 30 };
const DETROIT: ServiceArea = { lat: 42.3314, lng: -83.0458, radiusMiles: 30 };

export const DESIGN_PARTNERS: DesignPartnerTenant[] = [
  {
    key: "paul",
    name: "Paul Restoration",
    plan: "pro",
    verticalPresetId: "restoration",
    counties: ["17031"],
    excludedTowns: [],
    serviceArea: { ...CHICAGO },
    digestHour: 6,
    digestMinute: 30,
    digestCadence: "daily",
    digestChannels: ["telegram", "email"],
    hotPingThreshold: 80,
    complianceFooter: null,
    // "Commercial fit boosted, freshness half-life short (losses get claimed fast)."
    weights: weightsFromPreset("restoration", (w) => {
      w.propertyClassFit.commercial = 1.45;
      w.propertyClassFit.industrial = 1.3;
      w.freshnessHalfLifeHours = 12;
    }),
    note: "Reference customer for the restoration vertical. Commercial losses weighted up and a 12 hour half life, because a loss claimed by someone else is worth nothing.",
  },
  {
    key: "vince",
    name: "Vince Investments",
    plan: "pro",
    verticalPresetId: "investors",
    counties: ["17031", "17043", "17197"],
    // "Exclude the town of Bellwood from his scoring (village-inspector reasons)."
    excludedTowns: ["Bellwood"],
    serviceArea: { ...CHICAGO, radiusMiles: 40 },
    digestHour: 7,
    digestMinute: 0,
    digestCadence: "daily",
    digestChannels: ["telegram"],
    hotPingThreshold: 85,
    complianceFooter: null,
    // "Absentee-owner weighting up, value-gap weight up, commercial zeroed."
    weights: weightsFromPreset("investors", (w) => {
      w.absenteeOwnerBonus = 0.3;
      w.valueGap = 0.4;
      w.propertyClassFit.commercial = 0;
      w.propertyClassFit.industrial = 0;
      w.propertyClassFit.nonprofit = 0;
    }),
    note: "Single family flipper. Commercial is zeroed rather than lowered, so a commercial parcel cannot reach his digest at all.",
  },
  {
    key: "z",
    name: "Z Preforeclosure",
    plan: "pro",
    verticalPresetId: "investors",
    counties: ["17201", "17007"],
    excludedTowns: [],
    serviceArea: { ...ROCKFORD },
    digestHour: 8,
    digestMinute: 0,
    digestCadence: "weekly_monday",
    digestChannels: ["telegram", "email"],
    hotPingThreshold: 85,
    complianceFooter: null,
    // "Stage-aware scoring: 30/60/90 day windows to auction matter more than raw
    // freshness." So the stage multipliers go up and the half life goes long.
    weights: weightsFromPreset("investors", (w) => {
      w.freshnessHalfLifeHours = 336;
      if (w.foreclosureStage) {
        w.foreclosureStage.windows = [
          { maxDaysToSale: 30, multiplier: 1.6 },
          { maxDaysToSale: 60, multiplier: 1.35 },
          { maxDaysToSale: 90, multiplier: 1.15 },
        ];
        w.foreclosureStage.pastSaleMultiplier = 0.25;
      }
      w.eventSeverity.NOTICE_OF_SALE = 100;
      w.eventSeverity.SALE = 20;
    }),
    note: "Rockford metro. A two week half life on purpose: for him a filing does not go stale, it matures toward the sheriff sale, which is what the stage windows measure.",
  },
  {
    key: "real-law",
    name: "REAL Law Group",
    plan: "team",
    verticalPresetId: "lawfirms",
    counties: ["17031"],
    excludedTowns: [],
    serviceArea: { ...CHICAGO, radiusMiles: 30 },
    digestHour: 8,
    digestMinute: 0,
    digestCadence: "weekly_monday",
    digestChannels: ["email"],
    hotPingThreshold: 90,
    // "Bar-advertising disclaimer in the tenant compliance footer."
    complianceFooter:
      "Attorney advertising. This communication is for informational purposes and does not create an attorney client relationship. Prior results do not guarantee a similar outcome.",
    weights: weightsFromPreset("lawfirms"),
    note: "Intake meets Mondays, so the digest is weekly rather than daily. Letter first, and email drafts stay off by default.",
  },
  {
    key: "mike",
    name: "Pilot Roofing",
    plan: "solo",
    verticalPresetId: "roofing",
    counties: ["26163"],
    excludedTowns: [],
    serviceArea: { ...DETROIT },
    digestHour: 7,
    digestMinute: 0,
    digestCadence: "daily",
    digestChannels: ["email"],
    hotPingThreshold: 75,
    complianceFooter: null,
    // "Permit-weighted scoring plus recent-sale signal, hot-ping on commercial permits."
    weights: weightsFromPreset("roofing", (w) => {
      w.eventSeverity.PERMIT = 90;
      w.eventSeverity.SALE = 60;
      w.propertyClassFit.commercial = 1.2;
    }),
    note: "The only cold prospect and the only out of state county. Commercial permits are weighted to clear his 75 ping threshold on their own.",
  },
];

export function designPartner(key: string): DesignPartnerTenant {
  const found = DESIGN_PARTNERS.find((tenant) => tenant.key === key);
  if (!found) throw new Error(`No design partner fixture named "${key}"`);
  return found;
}

/** Narrows a fixture to just what the scoring engine reads. */
export function toScoringTenant(tenant: DesignPartnerTenant): ScoringTenant {
  return {
    name: tenant.name,
    verticalPresetId: tenant.verticalPresetId,
    weights: tenant.weights,
    excludedTowns: tenant.excludedTowns,
    serviceArea: tenant.serviceArea,
    hotPingThreshold: tenant.hotPingThreshold,
  };
}
