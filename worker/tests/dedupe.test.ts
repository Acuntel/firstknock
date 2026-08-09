import { describe, expect, it } from "vitest";
import { dedupeHash } from "../src/dedupe";
import type { PropertyEvent } from "../src/types";

function event(overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    fips: "17031",
    type: "SALE",
    occurredAt: new Date("2026-05-28T00:00:00.000Z"),
    externalId: "7860952",
    property: { parcelPin: "17032280160000", state: "IL" },
    parties: [],
    raw: {},
    ...overrides,
  };
}

describe("dedupe hash", () => {
  it("is a sha256 hex digest", () => {
    expect(dedupeHash(event())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls, which is what makes re-polling idempotent", () => {
    expect(dedupeHash(event())).toBe(dedupeHash(event()));
  });

  it("ignores fields that the county can revise after publication", () => {
    // Parties and raw both change when a county corrects a record. If they were
    // part of the key, a correction would land as a second lead for the same
    // event and the operator would knock on the same door twice.
    const revised = event({
      parties: [{ role: "buyer", name: "CORRECTED NAME" }],
      raw: { revision: 2 },
    });
    expect(dedupeHash(revised)).toBe(dedupeHash(event()));
  });

  it("separates the parcels of one multi parcel sale", () => {
    // Cook publishes a four parcel sale as one document number repeated per PIN.
    // Those are genuinely four properties, so they must not collapse into one.
    const a = event({ property: { parcelPin: "17032280160000" } });
    const b = event({ property: { parcelPin: "17032280170000" } });
    expect(dedupeHash(a)).not.toBe(dedupeHash(b));
  });

  it("separates different counties, types, dates, and record ids", () => {
    const base = dedupeHash(event());
    expect(dedupeHash(event({ fips: "17043" }))).not.toBe(base);
    expect(dedupeHash(event({ type: "PERMIT" }))).not.toBe(base);
    expect(
      dedupeHash(event({ occurredAt: new Date("2026-05-29T00:00:00.000Z") })),
    ).not.toBe(base);
    expect(dedupeHash(event({ externalId: "7860953" }))).not.toBe(base);
  });

  it("does not collide when a parcel is absent on one of two events", () => {
    const withPin = event({ property: { parcelPin: "123" }, externalId: "A" });
    const withoutPin = event({ property: {}, externalId: "123A" });
    expect(dedupeHash(withPin)).not.toBe(dedupeHash(withoutPin));
  });
});
