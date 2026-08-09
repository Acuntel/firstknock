import { describe, expect, it } from "vitest";
import { scoreEvent } from "../src/scoring/score";
import { weightsFromPreset } from "../src/scoring/presets";
import type { ScorableEvent, ScoringTenant } from "../src/scoring/types";

// Core mechanics of the engine. The individual signal terms, class fit,
// distance, exclusion, stage, absentee, and value gap, live in
// scoring-signals.test.ts.

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

describe("determinism", () => {
  // BUILD_SPEC section 4: "given the same event and config, the score is
  // bit-identical across runs". That is only assertable because `now` is an
  // argument. With a hidden clock the freshness term moves every call.
  it("produces an identical score and breakdown across calls", () => {
    const a = scoreEvent(event(), tenant(), NOW);
    const b = scoreEvent(event(), tenant(), NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not read the clock", () => {
    const later = new Date(NOW.getTime() + 5 * 3600_000);
    const atNow = scoreEvent(event(), tenant(), NOW).score;
    const atLater = scoreEvent(event(), tenant(), later).score;
    expect(atLater).toBeLessThan(atNow);
  });

  it("records what it scored against so a score can be reproduced", () => {
    const result = scoreEvent(event(), tenant(), NOW);
    expect(result.scoredAt).toBe(NOW.toISOString());
    expect(result.presetId).toBe("investors");
  });
});

describe("event severity", () => {
  it("ranks a notice of sale above a plain sale for investors", () => {
    const notice = scoreEvent(event({ type: "NOTICE_OF_SALE" }), tenant(), NOW);
    const sale = scoreEvent(event({ type: "SALE" }), tenant(), NOW);
    expect(notice.score).toBeGreaterThan(sale.score);
  });

  it("scores zero for an event type the vertical does not weight", () => {
    const lawfirm = tenant({
      verticalPresetId: "lawfirms",
      weights: weightsFromPreset("lawfirms", (w) => {
        delete w.eventSeverity.PERMIT;
      }),
    });
    const result = scoreEvent(event({ type: "PERMIT" }), lawfirm, NOW);
    expect(result.score).toBe(0);
    expect(result.components.severity.available).toBe(false);
  });
});

describe("freshness decay", () => {
  it("is steep: a three day old filing is worth far less than a three hour old one", () => {
    const restoration = tenant({
      verticalPresetId: "restoration",
      weights: weightsFromPreset("restoration"),
    });
    const threeHours = scoreEvent(
      event({ type: "LIS_PENDENS", occurredAt: new Date(NOW.getTime() - 3 * 3600_000) }),
      restoration,
      NOW,
    );
    const threeDays = scoreEvent(
      event({ type: "LIS_PENDENS", occurredAt: new Date(NOW.getTime() - 72 * 3600_000) }),
      restoration,
      NOW,
    );

    expect(threeHours.components.freshness.value).toBeGreaterThan(
      threeDays.components.freshness.value * 10,
    );
  });

  it("uses the per type half life so a 75 day old Cook sale still scores", () => {
    // The reason the override exists. Cook publishes a sale about 75 days after
    // it closes, so the global 72 hour half life would score every sale that
    // exists at zero and the investor and roofing presets would see no sales.
    const sale = event({
      type: "SALE",
      occurredAt: new Date(NOW.getTime() - 75 * 86_400_000),
      property: { class: "203" },
    });

    const withOverride = scoreEvent(sale, tenant(), NOW);
    const withoutOverride = scoreEvent(
      sale,
      tenant({
        weights: weightsFromPreset("investors", (w) => {
          delete w.freshnessHalfLifeByType;
        }),
      }),
      NOW,
    );

    expect(withOverride.score).toBeGreaterThan(0);
    expect(withoutOverride.score).toBe(0);
  });

  it("treats a future dated event as brand new rather than boosting it", () => {
    const future = event({ occurredAt: new Date(NOW.getTime() + 5 * 86_400_000) });
    expect(scoreEvent(future, tenant(), NOW).components.freshness.value).toBe(1);
  });
});

describe("output bounds", () => {
  it("never exceeds 100 no matter how the multipliers stack", () => {
    const stacked = tenant({
      weights: weightsFromPreset("investors", (w) => {
        w.eventSeverity.NOTICE_OF_SALE = 100;
        w.propertyClassFit.residential = 3;
        w.absenteeOwnerBonus = 2;
        w.valueGap = 1;
      }),
    });
    const hot = event({
      type: "NOTICE_OF_SALE",
      occurredAt: NOW,
      property: { class: "203", address: "1 A ST" },
      parties: [{ role: "owner", name: "X", address: "2 B ST" }],
      signals: { assessedValue: 500_000, lastSalePrice: 1, auctionDate: NOW },
    });
    expect(scoreEvent(hot, stacked, NOW).score).toBe(100);
  });

  it("never goes below zero", () => {
    const ancient = event({ occurredAt: new Date("1990-01-01T00:00:00.000Z") });
    expect(scoreEvent(ancient, tenant(), NOW).score).toBe(0);
  });

  it("returns a whole number", () => {
    const result = scoreEvent(event(), tenant(), NOW);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

describe("explainability", () => {
  it("gives every component a sentence the lead detail view can print", () => {
    const result = scoreEvent(event({ property: { class: "203" } }), tenant(), NOW);
    for (const [name, component] of Object.entries(result.components)) {
      expect(component.explanation.length, `${name} explanation`).toBeGreaterThan(10);
      expect(component.explanation.endsWith("."), `${name} is a sentence`).toBe(true);
    }
  });

  it("marks components that had no data rather than hiding them", () => {
    const bare = scoreEvent(event(), tenant(), NOW);
    expect(bare.components.distance.available).toBe(false);
    expect(bare.components.valueGap.available).toBe(false);
    expect(bare.components.propertyClass.available).toBe(false);
  });
});
