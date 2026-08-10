import { describe, expect, it } from "vitest";
import { fabricatedHotEvent } from "../src/digest/fabricated";
import { scoreEvent } from "../src/scoring/score";
import { DESIGN_PARTNERS, toScoringTenant } from "../src/tenants";

const NOW = new Date("2026-08-09T12:00:00.000Z");

// The second Phase 3 acceptance criterion is "a fabricated 95-score event pings
// inside one cycle". The send itself needs a bot token, but whether a fabricated
// lead actually clears each tenant's threshold is arithmetic, and that is the
// half that can regress silently.

describe("the fabricated hot lead", () => {
  it("clears the ping threshold for every design partner", () => {
    for (const partner of DESIGN_PARTNERS) {
      const event = fabricatedHotEvent(partner.weights, NOW);
      const score = scoreEvent(event, toScoringTenant(partner), NOW).score;

      expect(
        score,
        `${partner.name} should ping on a fabricated ${event.type}`,
      ).toBeGreaterThanOrEqual(partner.hotPingThreshold);
    }
  });

  it("picks each tenant's own strongest event type", () => {
    // A fixed type does not work. A permit tops out at 65 under Paul's
    // restoration weights against an 80 threshold.
    const byKey = Object.fromEntries(
      DESIGN_PARTNERS.map((p) => [p.key, fabricatedHotEvent(p.weights, NOW).type]),
    );

    expect(byKey.paul).toBe("FIRE_INCIDENT");
    expect(byKey["real-law"]).toBe("LIS_PENDENS");
    expect(byKey.mike).toBe("PERMIT");
  });

  it("avoids a category the tenant has zeroed out", () => {
    // Vince zeroes commercial entirely, so a commercial test lead scores zero
    // for him no matter how severe the event is.
    const vince = DESIGN_PARTNERS.find((p) => p.key === "vince");
    expect(vince).toBeDefined();

    const event = fabricatedHotEvent(vince!.weights, NOW);
    expect(event.property.category).toBe("residential");
    expect(vince!.weights.propertyClassFit[event.property.category!]).toBeGreaterThan(0);
  });

  it("is recognisable as a test record rather than a county one", () => {
    const event = fabricatedHotEvent(DESIGN_PARTNERS[0]!.weights, NOW);
    expect(event.externalId).toBe("fabricated-hot-lead");
    expect(String(event.raw.note)).toContain("Fabricated");
  });

  it("is fresh, so freshness decay is not what carries the test", () => {
    const event = fabricatedHotEvent(DESIGN_PARTNERS[0]!.weights, NOW);
    const ageMinutes = (NOW.getTime() - event.occurredAt.getTime()) / 60_000;
    expect(ageMinutes).toBeLessThan(60);
  });
});
