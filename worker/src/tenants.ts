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
  /**
   * Left null in the fixtures on purpose. These are real people and this repo
   * should not carry their addresses. Brady supplies them, or set
   * DIGEST_TEST_EMAIL to route every seeded tenant to your own inbox while
   * testing.
   */
  digestEmail: string | null;
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
const MILWAUKEE: ServiceArea = { lat: 43.0389, lng: -87.9065, radiusMiles: 30 };
const SYRACUSE: ServiceArea = { lat: 43.0481, lng: -76.1474, radiusMiles: 25 };
const BUFFALO: ServiceArea = { lat: 42.8864, lng: -78.8784, radiusMiles: 25 };

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
    digestEmail: null,
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
    digestEmail: null,
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
    digestEmail: null,
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
    digestEmail: null,
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
    digestEmail: null,
    hotPingThreshold: 75,
    complianceFooter: null,
    // "Permit-weighted scoring plus recent-sale signal, hot-ping on commercial permits."
    weights: weightsFromPreset("roofing", (w) => {
      w.eventSeverity.PERMIT = 90;
      w.eventSeverity.SALE = 60;
      w.propertyClassFit.commercial = 1.2;
    }),
    note: "The only cold prospect and the only out of state county. Commercial permits are weighted to clear his 75 ping threshold on their own.",
  }
];

/**
 * Markets Ben is producing leads for, as opposed to Brady's design partners.
 *
 * Kept separate on purpose. DESIGN_PARTNERS is a record of the five operators
 * V1 was scoped around and the spec asserts against it, so growing that array
 * would quietly rewrite what V1 promised. These are new coverage in states the
 * design partners do not operate in, and they answer to nobody's contract yet.
 *
 * Both are placeholders until Ben names real buyers.
 */
export const MARKET_TENANTS: DesignPartnerTenant[] = [
  {
    key: "milwaukee",
    name: "Milwaukee Flippers",
    plan: "solo",
    verticalPresetId: "investors",
    counties: ["55079"],
    excludedTowns: [],
    serviceArea: { ...MILWAUKEE },
    digestHour: 7,
    digestMinute: 0,
    digestCadence: "daily",
    digestChannels: ["telegram"],
    digestEmail: null,
    hotPingThreshold: 80,
    complianceFooter: null,
    weights: weightsFromPreset("investors", (w) => {
      // Delinquent tax is the whole reason to be in Milwaukee: the city
      // publishes the owner's name and mailing address with every account, so a
      // lead here is ready to post a letter to.
      w.eventSeverity.TAX_DELINQUENT = 85;
      // Standing debt is not news. The preset's 30 day half life suits a fresh
      // delinquency notice, but this feed is a snapshot of who is currently
      // behind, dated from when the levy came due. At 30 days a February levy
      // would score near zero by summer, which would throw away the entire
      // file. A year of half life keeps last winter's debt worth acting on
      // while still ranking this year's ahead of 2020's.
      w.freshnessHalfLifeByType = {
        ...w.freshnessHalfLifeByType,
        TAX_DELINQUENT: 8760,
      };
    }),
    note: "Placeholder until Ben names a real buyer. Covers Milwaukee delinquent tax and the vacant building registry, both of which carry owner contact details.",
  },
  {
    key: "syracuse",
    name: "Syracuse Flippers",
    plan: "solo",
    verticalPresetId: "investors",
    counties: ["36067"],
    excludedTowns: [],
    serviceArea: { ...SYRACUSE },
    digestHour: 7,
    digestMinute: 0,
    digestCadence: "daily",
    digestChannels: ["telegram"],
    digestEmail: null,
    hotPingThreshold: 80,
    complianceFooter: null,
    weights: weightsFromPreset("investors", (w) => {
      // Code violations are the only live feed Syracuse publishes, so the
      // vertical's usual foreclosure signals will never fire here.
      w.eventSeverity.CODE_VIOLATION = 75;
    }),
    note: "Placeholder until Ben names a real buyer. Syracuse city only: the violations feed belongs to the city, so Skaneateles and the rest of Onondaga are not covered.",
  },
  {
    key: "buffalo",
    name: "Buffalo Flippers",
    plan: "solo",
    verticalPresetId: "investors",
    counties: ["36029"],
    excludedTowns: [],
    serviceArea: { ...BUFFALO },
    digestHour: 7,
    digestMinute: 0,
    digestCadence: "daily",
    digestChannels: ["telegram"],
    digestEmail: null,
    hotPingThreshold: 85,
    complianceFooter: null,
    weights: weightsFromPreset("investors", (w) => {
      // Buffalo only publishes open cases here, so every event is a problem the
      // owner still has. It also carries the state property class, which
      // Syracuse does not, so class fit actually does work on this feed.
      w.eventSeverity.CODE_VIOLATION = 70;
    }),
    note: "Placeholder until Ben names a real buyer. Buffalo city only, so Cheektowaga and Amherst are not covered. Closed cases are filtered out at the source.",
  },
];

/** Every tenant the worker seeds and serves. */
export const ALL_TENANTS: DesignPartnerTenant[] = [...DESIGN_PARTNERS, ...MARKET_TENANTS];


export function designPartner(key: string): DesignPartnerTenant {
  const found = ALL_TENANTS.find((tenant) => tenant.key === key);
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
