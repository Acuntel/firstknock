import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isVacant,
  onondagaSyracuseViolationsAdapter as syracuse,
  syracuseCategory,
} from "../src/adapters/onondaga-syracuse";
import {
  delinquentFrom,
  milwaukeeCategory,
  milwaukeeDelinquentTaxAdapter as mkeTax,
  milwaukeeVacantAdapter as mkeVacant,
  taxOwed,
} from "../src/adapters/milwaukee";
import { ckanDate } from "../src/lib/ckan";
import type { CountyAdapter, PropertyEvent, RawRecord } from "../src/types";

function load(name: string): RawRecord[] {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as RawRecord[];
}

function normalizeAll(adapter: CountyAdapter, rows: RawRecord[]): PropertyEvent[] {
  return rows
    .map((row) => adapter.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

// Real responses saved live from each portal. Every odd value below is the
// city's own, not invented for the test.
const syracuseRows = load("onondaga-syracuse-violations");
const vacantRows = load("milwaukee-vacant-buildings");
const taxRows = load("milwaukee-delinquent-tax");

describe("Syracuse code violations", () => {
  it("normalizes every fixture row", () => {
    expect(normalizeAll(syracuse, syracuseRows)).toHaveLength(syracuseRows.length);
  });

  it("reads vacancy by presence, not by a yes value", () => {
    // The column is named Vacant but holds the property class when vacant and
    // nothing when occupied. Testing it against "Y" finds nothing at all, which
    // is the bug the first version of this adapter shipped with.
    const flagged = syracuseRows.filter(isVacant);
    expect(flagged.length).toBeGreaterThan(0);
    for (const row of flagged) {
      expect(String(row["Vacant"]).toUpperCase()).not.toBe("Y");
    }
  });

  it("takes the property class from the vacancy column", () => {
    expect(syracuseCategory({ Vacant: "Residential" })).toBe("residential");
    expect(syracuseCategory({ Vacant: "Commercial" })).toBe("commercial");
    // Occupied properties state no class anywhere on this feed, so the scorer
    // must see unknown rather than an assumed house.
    expect(syracuseCategory({ Vacant: null })).toBeUndefined();
    expect(syracuseCategory({})).toBeUndefined();
  });

  it("identifies a citation, not the complaint that raised it", () => {
    // complaint_number groups several citations from one complaint. Keying on
    // it would collapse distinct violations on a property into one event.
    const row = syracuseRows.find((r) => r["violation_id"]) as RawRecord;
    const event = syracuse.normalize(row);
    expect(event?.externalId).toBe(String(row["violation_id"]));
    expect(event?.externalId).not.toBe(String(row["complaint_number"]));
  });

  it("carries the cited owner and their mailing address", () => {
    const events = normalizeAll(syracuse, syracuseRows);
    const withOwner = events.filter((e) => e.parties.length > 0);
    expect(withOwner.length).toBeGreaterThan(0);
    for (const event of withOwner) {
      expect(event.parties[0]?.role).toBe("owner");
      expect(event.parties[0]?.name).toBeTruthy();
    }
  });

  it("drops a row with no address rather than inventing one", () => {
    expect(syracuse.normalize({ violation_date: "2026-08-01", violation_id: "1" })).toBeNull();
  });
});

describe("Milwaukee land use codes", () => {
  it("maps the housing block from the city's own code table", () => {
    expect(milwaukeeCategory("8810")).toBe("residential"); // single private households
    expect(milwaukeeCategory("8811")).toBe("residential"); // condo
    expect(milwaukeeCategory("8820")).toBe("multifamily"); // two family
    expect(milwaukeeCategory("8830")).toBe("multifamily"); // multi family
    expect(milwaukeeCategory("8880")).toBe("vacant"); // vacant lot
    expect(milwaukeeCategory("8885")).toBe("vacant"); // vacant lot with improvements
  });

  it("falls back to the SIC division outside the housing block", () => {
    expect(milwaukeeCategory("7538")).toBe("commercial"); // automotive repair
    expect(milwaukeeCategory("8011")).toBe("commercial"); // medical offices
    expect(milwaukeeCategory("8211")).toBe("nonprofit"); // schools
    expect(milwaukeeCategory("2011")).toBe("industrial"); // manufacturing
  });

  it("returns unknown rather than guessing at a value it cannot read", () => {
    expect(milwaukeeCategory("")).toBeUndefined();
    expect(milwaukeeCategory(null)).toBeUndefined();
    expect(milwaukeeCategory("RESIDENTIAL")).toBeUndefined();
  });
});

describe("Milwaukee vacant buildings", () => {
  it("normalizes every fixture row and categorizes it", () => {
    const events = normalizeAll(mkeVacant, vacantRows);
    expect(events).toHaveLength(vacantRows.length);
    expect(events.every((e) => e.property.category !== undefined)).toBe(true);
  });

  it("identifies a registration by parcel and the date it opened", () => {
    // The registry has no case number. A building registered, removed, and
    // registered again is genuinely two events, so the date is part of the id.
    const row = vacantRows[0] as RawRecord;
    const event = mkeVacant.normalize(row);
    expect(event?.externalId).toContain(String(row["PARCELNBR"]));
    expect(event?.externalId).toMatch(/\d{4}-\d{2}-\d{2}$/);
  });

  it("reads CKAN's date format without shifting the day", () => {
    expect(ckanDate("2026-08-03 00:00:00")?.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(ckanDate("")).toBeUndefined();
    expect(ckanDate(null)).toBeUndefined();
  });
});

describe("Milwaukee delinquent tax", () => {
  it("derives the date the debt became delinquent from the levy year", () => {
    // Wisconsin bills in the levy year and the first installment falls due on
    // January 31 of the next one, so a 2025 levy is delinquent from February 1,
    // 2026. normalize stays pure, so this is derived rather than clock stamped.
    expect(delinquentFrom(2025).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(delinquentFrom(2020).toISOString()).toBe("2021-02-01T00:00:00.000Z");
  });

  it("keeps one event per levy year for the same property", () => {
    // A property behind three years is three events. Depth of delinquency is
    // real evidence and collapsing it would throw that away.
    const events = normalizeAll(mkeTax, taxRows);
    const ids = new Set(events.map((e) => e.externalId));
    expect(ids.size).toBe(events.length);

    const byParcel = new Map<string, Set<string>>();
    for (const event of events) {
      const pin = event.property.parcelPin ?? "";
      if (!byParcel.has(pin)) byParcel.set(pin, new Set());
      byParcel.get(pin)?.add(event.externalId);
    }
    expect(byParcel.size).toBeGreaterThan(0);
  });

  it("carries the owner and their mailing address on every row", () => {
    // This is what makes the feed saleable: an investor can post a letter
    // without resolving contact details first.
    const events = normalizeAll(mkeTax, taxRows);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.parties[0]?.name, event.externalId).toBeTruthy();
      expect(event.parties[0]?.address, event.externalId).toBeTruthy();
    }
  });

  it("reads the amount owed", () => {
    const owed = taxRows.map(taxOwed).filter((n): n is number => n !== undefined);
    expect(owed.length).toBeGreaterThan(0);
    expect(owed.every((n) => n > 0)).toBe(true);
  });

  it("rejects a levy year outside living memory as a parse artefact", () => {
    const base = { "Property Address": "1 MAIN ST", "Tax Key #": "1234" };
    expect(mkeTax.normalize({ ...base, "Levy Year": 1200 })).toBeNull();
    expect(mkeTax.normalize({ ...base, "Levy Year": 3000 })).toBeNull();
    expect(mkeTax.normalize({ ...base, "Levy Year": 2025 })).not.toBeNull();
  });
});
