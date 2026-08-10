import type { ScoreWeights } from "../scoring/types";
import type { PropertyEvent } from "../types";

/**
 * A deliberately fabricated lead, for proving the hot ping path end to end.
 *
 * Scored by the real engine rather than handed a number, so it tests the
 * weighting rather than asserting around it.
 *
 * Both the event type and the property category are the ones this tenant weights
 * highest, because fixing either turns the test into a test of one preset. A
 * permit tops out at 65 under Paul's restoration weights against an 80
 * threshold, and a commercial parcel scores a flat zero for Vince, who zeroes
 * commercial out entirely. Asking each tenant for their own strongest signal is
 * what makes this fire for all five.
 */
export function fabricatedHotEvent(weights: ScoreWeights, now: Date): PropertyEvent {
  const strongestType = Object.entries(weights.eventSeverity).sort(
    (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
  )[0];

  const bestCategory = Object.entries(weights.propertyClassFit)
    .filter(([name]) => name !== "unknown")
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];

  return {
    fips: "17031",
    type: (strongestType?.[0] as PropertyEvent["type"]) ?? "PERMIT",
    occurredAt: new Date(now.getTime() - 30 * 60_000),
    externalId: "fabricated-hot-lead",
    property: {
      address: "1 TEST LEAD WAY",
      city: "CHICAGO",
      state: "IL",
      zip: "60601",
      parcelPin: "00000000000000",
      category: bestCategory?.[0] as PropertyEvent["property"]["category"],
    },
    parties: [{ role: "applicant", name: "FIRSTKNOCK TEST" }],
    raw: { note: "Fabricated by digest:send-test. Not a real county record." },
  };
}
