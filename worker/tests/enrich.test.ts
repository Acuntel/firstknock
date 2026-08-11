import { describe, expect, it } from "vitest";
import { applyEnrichment, fromAssessmentRow } from "../src/enrich/cook-assessed";
import { scoreEvent } from "../src/scoring/score";
import { weightsFromPreset } from "../src/scoring/presets";
import type { PropertyEvent } from "../src/types";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function event(overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    fips: "17031",
    type: "SALE",
    occurredAt: new Date("2026-05-28T00:00:00.000Z"),
    externalId: "s1",
    property: { parcelPin: "17032280160000", state: "IL" },
    parties: [],
    raw: {},
    ...overrides,
  };
}

const investor = {
  name: "Vince",
  verticalPresetId: "investors",
  weights: weightsFromPreset("investors"),
  excludedTowns: [],
};

describe("reading an assessment row", () => {
  it("prefers the board figure, which is the value after any appeal", () => {
    const row = { pin: "1", class: "203", mailed_tot: "10000", certified_tot: "20000", board_tot: "30000" };
    // Residential is assessed at 10 percent, so 30,000 assessed is 300,000 market.
    expect(fromAssessmentRow(row)?.signals.assessedValue).toBe(300_000);
  });

  it("falls back through certified to mailed", () => {
    expect(
      fromAssessmentRow({ pin: "1", class: "203", mailed_tot: "10000", certified_tot: "20000" })
        ?.signals.assessedValue,
    ).toBe(200_000);
    expect(
      fromAssessmentRow({ pin: "1", class: "203", mailed_tot: "10000" })?.signals.assessedValue,
    ).toBe(100_000);
  });

  it("converts assessed value to market value using Cook's level of assessment", () => {
    // The trap this exists to avoid: a raw Cook assessment is about a tenth of
    // what a house sells for. Comparing it straight to a sale price makes every
    // property look wildly overpriced and fires the value gap backwards.
    expect(fromAssessmentRow({ pin: "1", class: "203", board_tot: "50000" })?.signals.assessedValue).toBe(
      500_000,
    );
    // Commercial is assessed at 25 percent, not 10.
    expect(fromAssessmentRow({ pin: "1", class: "529", board_tot: "50000" })?.signals.assessedValue).toBe(
      200_000,
    );
  });

  it("returns the class even when the year has no values yet", () => {
    // The current year's row exists from the moment the roll opens and carries
    // no values until the township is certified.
    const enrichment = fromAssessmentRow({ pin: "1", class: "203" });
    expect(enrichment?.signals.assessedValue).toBeUndefined();
    expect(enrichment?.category).toBe("residential");
  });

  it("ignores exempt parcels' class rather than miscategorising them", () => {
    expect(fromAssessmentRow({ pin: "1", class: "EX" })?.category).toBeUndefined();
  });

  it("returns nothing for a row with neither a value nor a class", () => {
    expect(fromAssessmentRow({ pin: "1" })).toBeNull();
  });
});

describe("folding enrichment onto events", () => {
  it("fills a gap without overwriting what the event already knew", () => {
    // The source that saw the transaction is more current than an annual roll.
    const [result] = applyEnrichment(
      [event({ property: { parcelPin: "p1", class: "391" } })],
      new Map([["p1", { signals: { assessedValue: 500_000 }, classCode: "203", category: "residential" as const }]]),
    );

    expect(result?.property.class).toBe("391");
    expect((result as { signals?: { assessedValue?: number } }).signals?.assessedValue).toBe(500_000);
  });

  it("supplies a class to an event that had none, which is every Cook permit", () => {
    const [result] = applyEnrichment(
      [event({ type: "PERMIT", property: { parcelPin: "p1" } })],
      new Map([["p1", { signals: {}, classCode: "203", category: "residential" as const }]]),
    );

    expect(result?.property.class).toBe("203");
    expect(result?.property.category).toBe("residential");
  });

  it("leaves an unmatched event exactly as it was", () => {
    const original = event();
    const [result] = applyEnrichment([original], new Map());
    expect(result).toBe(original);
  });
});

describe("what enrichment unblocks", () => {
  it("turns on the value gap term, which had never once fired", () => {
    const sold = event({ property: { parcelPin: "p1", class: "203" } });

    const before = scoreEvent(sold, investor, NOW);
    expect(before.components.valueGap.available).toBe(false);

    const after = scoreEvent(
      { ...sold, signals: { assessedValue: 800_000, lastSalePrice: 400_000 } },
      investor,
      NOW,
    );

    expect(after.components.valueGap.available).toBe(true);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("adds nothing when a property sold above its assessment", () => {
    // Correct, not a miss: there is no gap to reward.
    const result = scoreEvent(
      { ...event(), signals: { assessedValue: 400_000, lastSalePrice: 900_000 } },
      investor,
      NOW,
    );
    expect(result.components.valueGap.value).toBe(0);
  });
});
