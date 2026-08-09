import { describe, expect, it } from "vitest";
import {
  PRESET_IDS,
  cloneWeights,
  loadAllPresets,
  loadPreset,
  weightsFromPreset,
} from "../src/scoring/presets";

describe("vertical presets", () => {
  it("ships the four launch verticals", () => {
    expect(PRESET_IDS).toEqual(["restoration", "investors", "roofing", "lawfirms"]);
    expect(loadAllPresets()).toHaveLength(4);
  });

  it("loads and validates every preset", () => {
    for (const id of PRESET_IDS) {
      const preset = loadPreset(id);
      expect(preset.id).toBe(id);
      expect(preset.eventTypes.length).toBeGreaterThan(0);
      expect(preset.hotPingDefault).toBeGreaterThan(0);
      expect(preset.digest.topN).toBeGreaterThan(0);
      expect(preset.outreach.letterTemplate.length).toBeGreaterThan(0);
    }
  });

  it("gives every advertised event type a severity", () => {
    // A vertical that lists an event type it then scores at zero would promise a
    // signal it never delivers.
    for (const preset of loadAllPresets()) {
      for (const type of preset.eventTypes) {
        expect(
          preset.weights.eventSeverity[type],
          `${preset.id} severity for ${type}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives every preset an unknown class fallback", () => {
    // Counties without a class mapping fall through to unknown, so a missing
    // fallback would silently zero every lead from a new county pack.
    for (const preset of loadAllPresets()) {
      expect(preset.weights.propertyClassFit.unknown).toBe(1);
    }
  });

  it("reads the same lens differently across verticals", () => {
    // CUSTOMIZATION.md: "a new lis pendens is a 20 for a restoration company, an
    // 85 for an investor, and a 95 for a foreclosure-defense firm."
    expect(loadPreset("restoration").weights.eventSeverity.LIS_PENDENS).toBe(20);
    expect(loadPreset("investors").weights.eventSeverity.LIS_PENDENS).toBe(85);
    expect(loadPreset("lawfirms").weights.eventSeverity.LIS_PENDENS).toBe(95);
  });

  it("only stages foreclosures on the investor preset", () => {
    expect(loadPreset("investors").weights.foreclosureStage?.enabled).toBe(true);
    expect(loadPreset("restoration").weights.foreclosureStage).toBeUndefined();
    expect(loadPreset("roofing").weights.foreclosureStage).toBeUndefined();
  });

  it("orders the stage windows so the first match is the nearest auction", () => {
    const windows = loadPreset("investors").weights.foreclosureStage?.windows ?? [];
    expect(windows.map((w) => w.maxDaysToSale)).toEqual([30, 60, 90]);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]!.multiplier).toBeLessThan(windows[i - 1]!.multiplier);
    }
  });

  it("fails loudly for a preset that does not exist", () => {
    // A tenant pointing at a missing preset must stop the run rather than fall
    // back to defaults and score every lead wrong without anyone noticing.
    expect(() => loadPreset("does-not-exist")).toThrow(/No preset file/);
  });
});

describe("cloning onto a tenant", () => {
  it("hands back a copy, so tuning a tenant cannot mutate the shared preset", () => {
    // CUSTOMIZATION.md section 2: presets are cloned at onboarding "so later
    // preset edits never surprise existing clients". This is the mechanism.
    const first = weightsFromPreset("investors", (w) => {
      w.propertyClassFit.commercial = 0;
    });
    const second = weightsFromPreset("investors");

    expect(first.propertyClassFit.commercial).toBe(0);
    expect(second.propertyClassFit.commercial).toBe(0.6);
    expect(loadPreset("investors").weights.propertyClassFit.commercial).toBe(0.6);
  });

  it("deep clones nested weight objects, not just the top level", () => {
    const original = loadPreset("investors").weights;
    const copy = cloneWeights(original);
    copy.eventSeverity.SALE = 999;
    if (copy.foreclosureStage) copy.foreclosureStage.windows[0]!.multiplier = 9;

    expect(original.eventSeverity.SALE).toBe(35);
    expect(original.foreclosureStage?.windows[0]?.multiplier).toBe(1.35);
  });
});
