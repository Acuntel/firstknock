import { describe, expect, it } from "vitest";
import { scoreEvent, rankForTenant } from "../src/scoring/score";
import { propertyCategory } from "../src/scoring/class-fit";
import { weightsFromPreset } from "../src/scoring/presets";
import type { ScorableEvent, ScoringTenant } from "../src/scoring/types";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function tenant(overrides: Partial<ScoringTenant> = {}): ScoringTenant {
  return {
    name: "Test",
    verticalPresetId: "investors",
    weights: weightsFromPreset("investors"),
    excludedTowns: [],
    ...overrides,
  };
}

function event(overrides: Partial<ScorableEvent> = {}): ScorableEvent {
  return {
    type: "LIS_PENDENS",
    occurredAt: new Date("2026-08-09T09:00:00.000Z"),
    fips: "17031",
    property: {},
    parties: [],
    ...overrides,
  };
}

// The individual scoring terms. The core mechanics, determinism, severity,
// freshness, and bounds, live in scoring.test.ts.

describe("property class fit", () => {
  it("maps Cook class codes to categories", () => {
    expect(propertyCategory("17031", "203")).toBe("residential");
    expect(propertyCategory("17031", "391")).toBe("multifamily");
    expect(propertyCategory("17031", "529")).toBe("commercial");
    expect(propertyCategory("17031", "100")).toBe("vacant");
    expect(propertyCategory("17031", undefined)).toBe("unknown");
  });

  it("prefers a category the source stated outright over a class code", () => {
    // Cook permits say "COMMERCIAL PERMIT" and carry no class. Where both exist,
    // the source's own words win over a code we interpreted.
    expect(propertyCategory("17031", undefined, "commercial")).toBe("commercial");
    expect(propertyCategory("17031", "203", "commercial")).toBe("commercial");
  });

  it("stays neutral for counties with no class mapping yet", () => {
    // Wayne MI lands in Phase 5. Until then its codes must not be read as if
    // they meant what Cook's do.
    expect(propertyCategory("26163", "401")).toBe("unknown");
  });

  it("lets a tenant zero a whole class out of their digest", () => {
    const noCommercial = tenant({
      weights: weightsFromPreset("investors", (w) => {
        w.propertyClassFit.commercial = 0;
      }),
    });
    const result = scoreEvent(event({ property: { class: "529" } }), noCommercial, NOW);
    expect(result.score).toBe(0);
  });
});

describe("distance from the service area", () => {
  const withArea = tenant({
    serviceArea: { lat: 41.8781, lng: -87.6298, radiusMiles: 30 },
  });

  it("does not penalise anything inside the radius", () => {
    const inside = event({ property: { lat: 41.9, lng: -87.65 } });
    expect(scoreEvent(inside, withArea, NOW).components.distance.value).toBe(1);
  });

  it("decays rather than dropping leads beyond the radius", () => {
    // A large commercial loss 40 miles out can still be worth a ping, so the
    // spec asks for decay, not a hard cutoff.
    const far = event({ property: { lat: 42.5, lng: -88.5 } });
    const distance = scoreEvent(far, withArea, NOW).components.distance.value;
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1);
  });

  it("stays neutral and says so when the record has no coordinates", () => {
    // Neither Cook sales nor Cook permits carry coordinates today.
    const component = scoreEvent(event(), withArea, NOW).components.distance;
    expect(component.value).toBe(1);
    expect(component.available).toBe(false);
  });
});

describe("town exclusion", () => {
  const vince = tenant({ excludedTowns: ["Bellwood"] });

  it("zeroes a lead in an excluded town and says which town", () => {
    const result = scoreEvent(event({ property: { city: "BELLWOOD" } }), vince, NOW);
    expect(result.score).toBe(0);
    expect(result.excluded).toBe(true);
    expect(result.excludedReason).toContain("Bellwood");
  });

  it("compares town names case and whitespace insensitively", () => {
    const result = scoreEvent(event({ property: { city: "  bellwood " } }), vince, NOW);
    expect(result.excluded).toBe(true);
  });

  it("leaves neighbouring towns alone", () => {
    const result = scoreEvent(event({ property: { city: "Maywood" } }), vince, NOW);
    expect(result.excluded).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("drops excluded leads out of a ranked list entirely", () => {
    const ranked = rankForTenant(
      [event({ property: { city: "Bellwood" } }), event({ property: { city: "Berwyn" } })],
      vince,
      NOW,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.event.property.city).toBe("Berwyn");
  });
});

describe("foreclosure stage windows", () => {
  const staged = (days: number) =>
    scoreEvent(
      event({
        type: "NOTICE_OF_SALE",
        signals: { auctionDate: new Date(NOW.getTime() + days * 86_400_000) },
      }),
      tenant(),
      NOW,
    );

  it("weights nearer auctions higher through the 30, 60, and 90 day windows", () => {
    const within30 = staged(20).components.foreclosureStage.value;
    const within60 = staged(45).components.foreclosureStage.value;
    const within90 = staged(75).components.foreclosureStage.value;

    expect(within30).toBeGreaterThan(within60);
    expect(within60).toBeGreaterThan(within90);
    expect(within90).toBeGreaterThan(1);
  });

  it("discounts an auction that has already happened", () => {
    expect(staged(-10).components.foreclosureStage.value).toBeLessThan(1);
  });

  it("stays neutral for verticals that do not stage, such as roofing", () => {
    const roofing = tenant({
      verticalPresetId: "roofing",
      weights: weightsFromPreset("roofing"),
    });
    const component = scoreEvent(
      event({ signals: { auctionDate: new Date(NOW.getTime() + 86_400_000) } }),
      roofing,
      NOW,
    ).components.foreclosureStage;

    expect(component.value).toBe(1);
    expect(component.available).toBe(false);
  });
});

describe("absentee owner", () => {
  const vince = tenant({
    weights: weightsFromPreset("investors", (w) => {
      w.absenteeOwnerBonus = 0.3;
    }),
  });

  it("boosts an owner who receives mail somewhere else", () => {
    const absentee = event({
      property: { address: "123 MAIN ST" },
      parties: [{ role: "owner", name: "OWNER LLC", address: "500 OTHER RD" }],
    });
    expect(scoreEvent(absentee, vince, NOW).components.absenteeOwner.value).toBeCloseTo(1.3);
  });

  it("does not boost an owner occupant, ignoring punctuation and case", () => {
    const occupied = event({
      property: { address: "123 Main St." },
      parties: [{ role: "owner", name: "A PERSON", address: "123 MAIN ST" }],
    });
    expect(scoreEvent(occupied, vince, NOW).components.absenteeOwner.value).toBe(1);
  });

  it("stays neutral for a permit applicant, who is often the contractor", () => {
    // Cook permits name an applicant, not an owner. Treating a builder's office
    // address as evidence of an absentee owner would be wrong most of the time.
    const permit = event({
      type: "PERMIT",
      property: { address: "123 MAIN ST" },
      parties: [{ role: "applicant", name: "SOME ROOFING CO", address: "9 SHOP LN" }],
    });
    const component = scoreEvent(permit, vince, NOW).components.absenteeOwner;
    expect(component.value).toBe(1);
    expect(component.available).toBe(false);
  });
});

describe("value gap", () => {
  it("adds points when the assessment sits above the last sale", () => {
    const gap = event({
      type: "SALE",
      signals: { assessedValue: 200_000, lastSalePrice: 100_000 },
    });
    const component = scoreEvent(gap, tenant(), NOW).components.valueGap;
    expect(component.value).toBeGreaterThan(0);
    expect(component.available).toBe(true);
  });

  it("stays at zero and says why when no assessed value exists", () => {
    // The Cook sales feed carries a sale price but no assessed value, so this is
    // the case that actually runs today.
    const component = scoreEvent(event({ type: "SALE" }), tenant(), NOW).components.valueGap;
    expect(component.value).toBe(0);
    expect(component.available).toBe(false);
  });
});

