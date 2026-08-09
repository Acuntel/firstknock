import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cookPermitsAdapter, cookSalesAdapter } from "../src/adapters/cook-socrata";
import type { RawRecord } from "../src/types";

// Fixtures are real Socrata responses saved from the live endpoints, not
// hand written samples. That matters: the permits feed omits null columns
// entirely rather than sending nulls, which is the kind of thing an invented
// fixture would never reproduce.
function fixture(name: string): RawRecord[] {
  const path = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as RawRecord[];
}

const salesRows = fixture("cook-sales.json");
const permitRows = fixture("cook-permits.json");

describe("cook sales adapter", () => {
  it("is registered against Cook County with the sale event type", () => {
    expect(cookSalesAdapter.fips).toBe("17031");
    expect(cookSalesAdapter.eventTypes).toEqual(["SALE"]);
  });

  it("normalizes every fixture row into a sale event", () => {
    const events = salesRows.map((r) => cookSalesAdapter.normalize(r));
    const kept = events.filter((e) => e !== null);

    expect(kept.length).toBeGreaterThan(0);
    for (const event of kept) {
      expect(event.type).toBe("SALE");
      expect(event.fips).toBe("17031");
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(Number.isNaN(event.occurredAt.getTime())).toBe(false);
      expect(event.property.parcelPin).toMatch(/^\d+$/);
      expect(event.externalId.length).toBeGreaterThan(0);
    }
  });

  it("reads the parcel, date, and buyer off a known row", () => {
    const row = salesRows.find((r) => r["row_id"] === "7860952");
    expect(row).toBeDefined();

    const event = cookSalesAdapter.normalize(row as RawRecord);
    expect(event).not.toBeNull();
    expect(event?.property.parcelPin).toBe("17032280160000");
    expect(event?.occurredAt.toISOString()).toBe("2026-05-28T00:00:00.000Z");
    expect(event?.property.class).toBe("391");
    expect(event?.parties).toContainEqual({
      role: "buyer",
      name: "FRED PRIMOLI",
    });
  });

  it("discards rows the county itself flags as not arms length", () => {
    const base = salesRows[0] as RawRecord;
    expect(cookSalesAdapter.normalize(base)).not.toBeNull();

    expect(
      cookSalesAdapter.normalize({ ...base, sale_filter_less_than_10k: true }),
    ).toBeNull();
    expect(
      cookSalesAdapter.normalize({ ...base, sale_filter_deed_type: true }),
    ).toBeNull();
  });

  it("discards rows missing the fields the dedupe key needs", () => {
    const base = salesRows[0] as RawRecord;
    const { sale_date: _date, ...noDate } = base;
    const { pin: _pin, ...noPin } = base;

    expect(cookSalesAdapter.normalize(noDate)).toBeNull();
    expect(cookSalesAdapter.normalize(noPin)).toBeNull();
  });
});

describe("cook permits adapter", () => {
  it("is registered against Cook County with the permit event type", () => {
    expect(cookPermitsAdapter.fips).toBe("17031");
    expect(cookPermitsAdapter.eventTypes).toEqual(["PERMIT"]);
  });

  it("normalizes every fixture row into a permit event", () => {
    const kept = permitRows
      .map((r) => cookPermitsAdapter.normalize(r))
      .filter((e) => e !== null);

    expect(kept.length).toBe(permitRows.length);
    for (const event of kept) {
      expect(event.type).toBe("PERMIT");
      expect(event.property.state).toBe("IL");
      expect(event.property.parcelPin).toMatch(/^\d+$/);
    }
  });

  it("strips the municipality prefix so town names compare cleanly", () => {
    const towns = permitRows
      .map((r) => cookPermitsAdapter.normalize(r)?.property.city)
      .filter((c): c is string => typeof c === "string");

    expect(towns.length).toBeGreaterThan(0);
    for (const town of towns) {
      expect(town).not.toMatch(/^(VILLAGE|CITY|TOWN|TOWNSHIP)\s+OF\s+/i);
    }
    expect(towns).toContain("HOMEWOOD");
    expect(towns).toContain("BLUE ISLAND");
  });

  it("splits the zip off the street line", () => {
    const row = permitRows.find(
      (r) => r["property_address"] === "18231 PARK AV 60430",
    );
    expect(row).toBeDefined();

    const event = cookPermitsAdapter.normalize(row as RawRecord);
    expect(event?.property.address).toBe("18231 PARK AV");
    expect(event?.property.zip).toBe("60430");
  });

  it("records the applicant as its own role rather than assuming ownership", () => {
    const row = permitRows.find((r) => r["applicant_name"] !== undefined);
    expect(row).toBeDefined();

    const event = cookPermitsAdapter.normalize(row as RawRecord);
    expect(event?.parties[0]?.role).toBe("applicant");
  });

  it("reads the use type off job_code_primary, since permits carry no class", () => {
    // Without this the commercial weighting in the roofing preset could never
    // fire on a permit, because the feed has no assessor class field at all.
    const commercial = permitRows.find(
      (r) => r["job_code_primary"] === "COMMERCIAL PERMIT",
    );
    expect(commercial).toBeDefined();
    expect(
      cookPermitsAdapter.normalize(commercial as RawRecord)?.property.category,
    ).toBe("commercial");
  });

  it("leaves the category undefined for job codes that state nothing useful", () => {
    const base = permitRows[0] as RawRecord;
    const vague = { ...base, job_code_primary: "OTHER" };
    expect(cookPermitsAdapter.normalize(vague)?.property.category).toBeUndefined();

    const { job_code_primary: _code, ...missing } = base;
    expect(cookPermitsAdapter.normalize(missing)?.property.category).toBeUndefined();
  });

  it("discards rows with no issue date, which the live feed does return", () => {
    const base = permitRows[0] as RawRecord;
    const { date_issued: _issued, ...noDate } = base;
    expect(cookPermitsAdapter.normalize(noDate)).toBeNull();
  });
});

describe("adapter purity", () => {
  // BUILD_SPEC section 3: adapters are pure. Same fixture in, same event out,
  // with no hidden clock or environment reads anywhere in the path.
  it("produces identical output for the same input across calls", () => {
    for (const row of [...salesRows, ...permitRows]) {
      const adapter = row["sale_date"] ? cookSalesAdapter : cookPermitsAdapter;
      const first = adapter.normalize(row);
      const second = adapter.normalize(row);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });

  it("does not mutate the record it was handed", () => {
    const row = salesRows[0] as RawRecord;
    const before = JSON.stringify(row);
    cookSalesAdapter.normalize(row);
    expect(JSON.stringify(row)).toBe(before);
  });
});
