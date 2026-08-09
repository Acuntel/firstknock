import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cookPermitsAdapter, cookSalesAdapter } from "../src/adapters/cook-socrata";
import { rankForTenant, scoreEvent } from "../src/scoring/score";
import { DESIGN_PARTNERS, designPartner, toScoringTenant } from "../src/tenants";
import type { ScorableEvent } from "../src/scoring/types";
import type { CountyAdapter, PropertyEvent, RawRecord } from "../src/types";

// The Phase 2 acceptance criteria, both clauses:
//   "same event scores identically across runs"
//   "each of the 5 seeded tenants sees a differently-scored lead list from the
//    same Cook County fixture events"

const NOW = new Date("2026-08-09T12:00:00.000Z");

function fixture(name: string): RawRecord[] {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as RawRecord[];
}

function normalizeAll(adapter: CountyAdapter, rows: RawRecord[]): PropertyEvent[] {
  return rows
    .map((row) => adapter.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

const COOK_EVENTS: ScorableEvent[] = [
  ...normalizeAll(cookSalesAdapter, fixture("cook-sales.json")),
  ...normalizeAll(cookPermitsAdapter, fixture("cook-permits.json")),
];

/** The ranked list as a comparable string, for asserting two tenants differ. */
function signature(tenantKey: string): string {
  const tenant = toScoringTenant(designPartner(tenantKey));
  return rankForTenant(COOK_EVENTS, tenant, NOW)
    .map((row) => `${row.event.type}:${row.breakdown.score}`)
    .join("|");
}

describe("the five design partner fixtures", () => {
  it("covers exactly the five partners V1 is scoped to", () => {
    expect(DESIGN_PARTNERS.map((t) => t.key)).toEqual([
      "paul",
      "vince",
      "z",
      "real-law",
      "mike",
    ]);
  });

  it("gives each partner the counties named in DESIGN_PARTNERS.md", () => {
    expect(designPartner("paul").counties).toEqual(["17031"]);
    expect(designPartner("vince").counties).toEqual(["17031", "17043", "17197"]);
    expect(designPartner("z").counties).toEqual(["17201", "17007"]);
    expect(designPartner("real-law").counties).toEqual(["17031"]);
    expect(designPartner("mike").counties).toEqual(["26163"]);
  });

  it("puts REAL Law on a weekly Monday cadence and everyone else where they asked", () => {
    expect(designPartner("real-law").digestCadence).toBe("weekly_monday");
    expect(designPartner("z").digestCadence).toBe("weekly_monday");
    expect(designPartner("paul").digestCadence).toBe("daily");
  });

  it("keeps Paul's 6:30am digest time intact", () => {
    const paul = designPartner("paul");
    expect(paul.digestHour).toBe(6);
    expect(paul.digestMinute).toBe(30);
  });

  it("carries the bar advertising disclaimer only for the law firm", () => {
    expect(designPartner("real-law").complianceFooter).toContain("Attorney advertising");
    expect(designPartner("paul").complianceFooter).toBeNull();
  });

  it("excludes Bellwood for Vince and nobody else", () => {
    expect(designPartner("vince").excludedTowns).toEqual(["Bellwood"]);
    for (const key of ["paul", "z", "real-law", "mike"]) {
      expect(designPartner(key).excludedTowns).toEqual([]);
    }
  });

  it("applies each partner's config notes as real weight overrides", () => {
    // Paul: commercial fit boosted, short half life.
    expect(designPartner("paul").weights.propertyClassFit.commercial).toBe(1.45);
    expect(designPartner("paul").weights.freshnessHalfLifeHours).toBe(12);

    // Vince: absentee up, value gap up, commercial zeroed.
    expect(designPartner("vince").weights.absenteeOwnerBonus).toBe(0.3);
    expect(designPartner("vince").weights.valueGap).toBe(0.4);
    expect(designPartner("vince").weights.propertyClassFit.commercial).toBe(0);

    // Mike: permit weighted.
    expect(designPartner("mike").weights.eventSeverity.PERMIT).toBe(90);
  });

  it("does not let one partner's overrides leak into another on the same preset", () => {
    // Vince and Z both start from the investors preset. Vince zeroes commercial;
    // Z must not inherit that.
    expect(designPartner("vince").weights.propertyClassFit.commercial).toBe(0);
    expect(designPartner("z").weights.propertyClassFit.commercial).toBe(0.6);
  });
});

describe("the same Cook events, five different lead lists", () => {
  it("has fixture events to score", () => {
    expect(COOK_EVENTS.length).toBeGreaterThan(10);
  });

  it("produces a distinct ranked list for every partner", () => {
    const signatures = DESIGN_PARTNERS.map((t) => signature(t.key));
    expect(new Set(signatures).size).toBe(DESIGN_PARTNERS.length);
  });

  it("scores permits high for the roofer and near zero for the law firm", () => {
    const permit = COOK_EVENTS.find((e) => e.type === "PERMIT");
    expect(permit).toBeDefined();

    const mike = scoreEvent(permit!, toScoringTenant(designPartner("mike")), NOW);
    const realLaw = scoreEvent(permit!, toScoringTenant(designPartner("real-law")), NOW);

    expect(mike.score).toBeGreaterThan(realLaw.score);
    expect(realLaw.score).toBeLessThan(15);
  });

  it("still surfaces 75 day old Cook sales to the investor and the roofer", () => {
    // The publication lag finding from Phase 1, carried through to scoring. If
    // the per type half life regressed, both of these would be zero.
    const sale = COOK_EVENTS.find((e) => e.type === "SALE");
    expect(sale).toBeDefined();

    for (const key of ["vince", "mike"]) {
      const result = scoreEvent(sale!, toScoringTenant(designPartner(key)), NOW);
      expect(result.score, `${key} should still see Cook sales`).toBeGreaterThan(0);
    }
  });

  it("clears Mike's ping threshold on a fresh commercial permit", () => {
    // DESIGN_PARTNERS.md promises him a "hot-ping on commercial permits". This
    // is that promise as an assertion: if the permit weighting or the category
    // plumbing regresses, his pings go quiet and nothing else would catch it.
    const mike = designPartner("mike");
    const freshCommercial: ScorableEvent = {
      type: "PERMIT",
      occurredAt: new Date(NOW.getTime() - 2 * 3600_000),
      fips: "26163",
      property: { city: "Detroit", category: "commercial" },
      parties: [],
    };

    const result = scoreEvent(freshCommercial, toScoringTenant(mike), NOW);
    expect(result.score).toBeGreaterThanOrEqual(mike.hotPingThreshold);
  });

  it("keeps a two week old permit below the ping threshold", () => {
    // The other half of the same promise. A ping that fires on stale permits is
    // just a digest arriving at the wrong time.
    const mike = designPartner("mike");
    const stale: ScorableEvent = {
      type: "PERMIT",
      occurredAt: new Date(NOW.getTime() - 14 * 86_400_000),
      fips: "26163",
      property: { city: "Detroit", category: "commercial" },
      parties: [],
    };

    expect(scoreEvent(stale, toScoringTenant(mike), NOW).score).toBeLessThan(
      mike.hotPingThreshold,
    );
  });

  it("drops a Bellwood lead for Vince while everyone else keeps it", () => {
    const bellwood: ScorableEvent = {
      type: "PERMIT",
      occurredAt: new Date(NOW.getTime() - 3600_000),
      fips: "17031",
      property: { city: "Bellwood", class: "203", address: "1 TEST ST" },
      parties: [],
    };

    const vince = rankForTenant([bellwood], toScoringTenant(designPartner("vince")), NOW);
    const paul = rankForTenant([bellwood], toScoringTenant(designPartner("paul")), NOW);

    expect(vince).toHaveLength(0);
    expect(paul).toHaveLength(1);
  });
});

describe("reproducibility of a whole ranked list", () => {
  it("ranks identically across runs for every partner", () => {
    for (const partner of DESIGN_PARTNERS) {
      expect(signature(partner.key), partner.name).toBe(signature(partner.key));
    }
  });

  it("breaks score ties by recency, so the order is never arbitrary", () => {
    const tenant = toScoringTenant(designPartner("paul"));
    const older: ScorableEvent = {
      type: "PERMIT",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      fips: "17031",
      property: { class: "203" },
      parties: [],
    };
    const newer: ScorableEvent = { ...older, occurredAt: new Date("2026-08-02T00:00:00.000Z") };

    const ranked = rankForTenant([older, newer], tenant, NOW);
    expect(ranked[0]?.event.occurredAt.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });
});
