import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detroitCategory,
  wayneDetroitPermitsAdapter as adapter,
} from "../src/adapters/wayne-detroit";
import { arcgisDate } from "../src/lib/arcgis";
import type { RawRecord } from "../src/types";

// A real ArcGIS response from Detroit's permit office, saved live. The messy
// use-type strings below are the county's own, not invented for the test.
const rows = JSON.parse(
  readFileSync(new URL("../fixtures/wayne-detroit-permits.json", import.meta.url), "utf8"),
) as RawRecord[];

describe("ArcGIS date handling", () => {
  it("reads both shapes ArcGIS returns", () => {
    // Date columns come back as epoch milliseconds, DateOnly columns as a
    // plain string. Detroit uses DateOnly; other layers will not.
    expect(arcgisDate(Date.UTC(2026, 7, 9))?.toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(arcgisDate("2026-08-09")?.toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(arcgisDate(null)).toBeUndefined();
    expect(arcgisDate("")).toBeUndefined();
    expect(arcgisDate("not a date")).toBeUndefined();
  });
});

describe("Detroit use types", () => {
  it("collapses the county's several spellings of the same thing", () => {
    for (const value of [
      "One Family",
      "ONE FAMILY DWELLING",
      "Single Family Dwelling w/Rear Detached Garage",
      "Single-Family",
      "Two Family",
    ]) {
      expect(detroitCategory(value), value).toBe("residential");
    }
  });

  it("separates the categories the presets weight differently", () => {
    expect(detroitCategory("Co-Op")).toBe("multifamily");
    expect(detroitCategory("Child Care Center")).toBe("commercial");
    expect(detroitCategory("School")).toBe("nonprofit");
    expect(detroitCategory("Warehouse")).toBe("industrial");
  });

  it("leaves anything it cannot read undefined rather than guessing", () => {
    // "Water Works Park" and "Marijuana Grower Facility" are both real values
    // from this feed and neither maps cleanly, so neither is forced into one.
    expect(detroitCategory("Water Works Park")).toBeUndefined();
    expect(detroitCategory(null)).toBeUndefined();
    expect(detroitCategory("")).toBeUndefined();
  });
});

describe("wayne detroit permits adapter", () => {
  it("is registered against Wayne County with the permit event type", () => {
    expect(adapter.fips).toBe("26163");
    expect(adapter.eventTypes).toEqual(["PERMIT"]);
    expect(adapter.lookbackDays).toBeGreaterThan(0);
  });

  it("normalizes every fixture row", () => {
    const kept = rows.map((r) => adapter.normalize(r)).filter((e) => e !== null);
    expect(kept).toHaveLength(rows.length);

    for (const event of kept) {
      expect(event.type).toBe("PERMIT");
      expect(event.property.state).toBe("MI");
      expect(event.property.city).toBe("DETROIT");
      expect(event.property.address?.length).toBeGreaterThan(0);
      expect(Number.isNaN(event.occurredAt.getTime())).toBe(false);
    }
  });

  it("reads a known row end to end", () => {
    const row = rows.find((r) => r["record_id"] === "RES2026-02770");
    expect(row).toBeDefined();

    const event = adapter.normalize(row as RawRecord);
    expect(event?.property.address).toBe("4511 Bishop St");
    expect(event?.property.zip).toBe("48224");
    expect(event?.property.category).toBe("residential");
    expect(event?.occurredAt.toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  it("strips the trailing dot Detroit leaves on parcel ids", () => {
    const event = adapter.normalize(rows[0] as RawRecord);
    expect(event?.property.parcelPin).not.toMatch(/\.$/);
  });

  it("discards rows missing anything the dedupe key needs", () => {
    const base = rows[0] as RawRecord;
    const { issued_date: _d, ...noDate } = base;
    const { record_id: _r, ...noId } = base;

    expect(adapter.normalize(noDate)).toBeNull();
    expect(adapter.normalize(noId)).toBeNull();
    expect(adapter.normalize({ ...base, address: null, street_number: null, street_name: null })).toBeNull();
  });

  it("falls back to the split street columns when the joined address is absent", () => {
    const base = rows[0] as RawRecord;
    const event = adapter.normalize({
      ...base,
      address: null,
      street_number: 4511,
      street_name: "Bishop",
      street_type: "St",
    });
    expect(event?.property.address).toBe("4511 Bishop St");
  });

  it("stays pure across calls", () => {
    for (const row of rows) {
      expect(JSON.stringify(adapter.normalize(row))).toBe(
        JSON.stringify(adapter.normalize(row)),
      );
    }
  });
});
