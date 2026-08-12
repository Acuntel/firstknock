import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  erieBuffaloViolationsAdapter as buffalo,
  isOpenCase,
  nyPropertyCategory,
} from "../src/adapters/erie-buffalo";
import type { PropertyEvent, RawRecord } from "../src/types";

// A real Socrata response from Buffalo code enforcement, saved live and spread
// across property class divisions so the class mapping is actually exercised.
const rows = JSON.parse(
  readFileSync(new URL("../fixtures/erie-buffalo-violations.json", import.meta.url), "utf8"),
) as RawRecord[];

describe("New York property class codes", () => {
  it("reads the division from the hundreds digit", () => {
    expect(nyPropertyCategory("210")).toBe("residential"); // one family
    expect(nyPropertyCategory("220")).toBe("residential"); // two family
    expect(nyPropertyCategory("281")).toBe("multifamily"); // multiple residences
    expect(nyPropertyCategory("311")).toBe("vacant"); // residential vacant land
    expect(nyPropertyCategory("481")).toBe("commercial"); // downtown row building
    expect(nyPropertyCategory("620")).toBe("nonprofit"); // religious
    expect(nyPropertyCategory("710")).toBe("industrial"); // manufacturing
  });

  it("returns unknown rather than guessing at anything that is not a code", () => {
    expect(nyPropertyCategory("")).toBeUndefined();
    expect(nyPropertyCategory(null)).toBeUndefined();
    expect(nyPropertyCategory("RESIDENTIAL")).toBeUndefined();
    expect(nyPropertyCategory("21")).toBeUndefined();
  });
});

describe("Buffalo code violations", () => {
  it("normalizes every fixture row", () => {
    const events = rows
      .map((row) => buffalo.normalize(row))
      .filter((event): event is PropertyEvent => event !== null);
    expect(events).toHaveLength(rows.length);
  });

  it("only carries cases that are still open against the property", () => {
    // A closed violation is history. The owner already dealt with it, and
    // pitching a repair someone has finished is how a lead list loses
    // credibility, so closed cases are dropped in the query.
    expect(rows.every(isOpenCase)).toBe(true);
    expect(isOpenCase({ status: "CLOSED" })).toBe(false);
    expect(isOpenCase({})).toBe(false);
  });

  it("identifies a violation, not the case that grouped it", () => {
    // case_number groups every violation raised under one case, so keying on it
    // would collapse distinct problems on a property into a single event.
    const row = rows.find((r) => r["uniquekey"]) as RawRecord;
    const event = buffalo.normalize(row);
    expect(event?.externalId).toBe(String(row["uniquekey"]));
    expect(event?.externalId).not.toBe(String(row["case_number"]));
  });

  it("classifies nearly every row, unlike the Syracuse feed", () => {
    // Buffalo publishes the state property class on each violation and Syracuse
    // does not, which is the difference between class fit doing work and
    // sitting idle.
    const events = rows
      .map((row) => buffalo.normalize(row))
      .filter((event): event is PropertyEvent => event !== null);
    const known = events.filter((e) => e.property.category !== undefined);
    expect(known.length).toBeGreaterThan(events.length * 0.9);
  });

  it("drops a row with no address rather than inventing one", () => {
    expect(buffalo.normalize({ date: "2026-06-13T00:00:00.000", uniquekey: "1" })).toBeNull();
  });
});
