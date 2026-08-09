import { describe, expect, it } from "vitest";
import {
  adapterById,
  adaptersForFips,
  allAdapters,
  registeredFips,
} from "../src/registry";

describe("adapter registry", () => {
  it("keys Cook County adapters by FIPS", () => {
    const cook = adaptersForFips("17031");
    expect(cook.map((a) => a.id).sort()).toEqual([
      "il-cook-socrata-permits",
      "il-cook-socrata-sales",
    ]);
  });

  it("returns an empty list for a county with no pack yet", () => {
    // Winnebago is built last per DESIGN_PARTNERS.md. Asking for it should be a
    // quiet miss, not a crash, because the sources table can name it early.
    expect(adaptersForFips("17201")).toEqual([]);
  });

  it("resolves a sources.adapter_id back to its adapter", () => {
    expect(adapterById("il-cook-socrata-sales")?.fips).toBe("17031");
    expect(adapterById("does-not-exist")).toBeUndefined();
  });

  it("gives every adapter a unique id", () => {
    const ids = allAdapters().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every adapter a five digit FIPS, a cadence, and event types", () => {
    for (const adapter of allAdapters()) {
      expect(adapter.fips).toMatch(/^\d{5}$/);
      expect(adapter.cadence.trim().length).toBeGreaterThan(0);
      expect(adapter.eventTypes.length).toBeGreaterThan(0);
    }
  });

  it("reports the counties it currently covers", () => {
    expect(registeredFips()).toContain("17031");
  });
});
