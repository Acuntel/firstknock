import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookPermitsAdapter, cookSalesAdapter } from "../src/adapters/cook-socrata";
import { toEventRow } from "../src/db";
import type { CountyAdapter, PropertyEvent, RawRecord } from "../src/types";
import { createTestDb } from "./support/pg";

// The Phase 1 acceptance check: running the worker twice over the same window
// inserts zero duplicate events. This drives the real adapters and the real row
// builder against a real Postgres, so the only piece not covered here is the
// Supabase client wrapper itself.

const SOURCE_SALES = "33333333-3333-4333-8333-333333333333";
const SOURCE_PERMITS = "44444444-4444-4444-8444-444444444444";

let db: PGlite;

function fixture(name: string): RawRecord[] {
  const path = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as RawRecord[];
}

function normalizeAll(adapter: CountyAdapter, rows: RawRecord[]): PropertyEvent[] {
  return rows
    .map((row) => adapter.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

/**
 * The same statement Supabase emits for an upsert with ignoreDuplicates set,
 * written out so the test can count exactly what was inserted.
 */
async function insertEvents(
  sourceId: string,
  events: PropertyEvent[],
): Promise<number> {
  const unique = new Map(
    events.map((event) => [toEventRow(sourceId, event).dedupe_hash, event]),
  );

  let inserted = 0;
  for (const event of unique.values()) {
    const row = toEventRow(sourceId, event);
    const result = await db.query<{ id: string }>(
      `insert into events (
         source_id, fips, type, occurred_at, property_address, property_city,
         property_state, property_zip, parcel_pin, lat, lng, property_class,
         parties, raw, dedupe_hash
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (dedupe_hash) do nothing
       returning id`,
      [
        row.source_id,
        row.fips,
        row.type,
        row.occurred_at,
        row.property_address,
        row.property_city,
        row.property_state,
        row.property_zip,
        row.parcel_pin,
        row.lat,
        row.lng,
        row.property_class,
        JSON.stringify(row.parties),
        JSON.stringify(row.raw),
        row.dedupe_hash,
      ],
    );
    inserted += result.rows.length;
  }
  return inserted;
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into sources (id, adapter_id, fips, event_types, cadence) values
      ('${SOURCE_SALES}', 'il-cook-socrata-sales', '17031', '{SALE}', '0 5 * * *'),
      ('${SOURCE_PERMITS}', 'il-cook-socrata-permits', '17031', '{PERMIT}', '0 5 * * *');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("ingest is idempotent", () => {
  it("inserts on the first pass and nothing on the second", async () => {
    const sales = normalizeAll(cookSalesAdapter, fixture("cook-sales.json"));
    const permits = normalizeAll(cookPermitsAdapter, fixture("cook-permits.json"));
    expect(sales.length + permits.length).toBeGreaterThan(0);

    const firstPass =
      (await insertEvents(SOURCE_SALES, sales)) +
      (await insertEvents(SOURCE_PERMITS, permits));
    expect(firstPass).toBe(sales.length + permits.length);

    // Same window, polled again. This is what the overlap in run-once.ts causes
    // to happen on every single run, so it has to cost nothing.
    const secondPass =
      (await insertEvents(SOURCE_SALES, sales)) +
      (await insertEvents(SOURCE_PERMITS, permits));
    expect(secondPass).toBe(0);

    const total = await db.query<{ count: string }>("select count(*) from events");
    expect(Number(total.rows[0]?.count)).toBe(firstPass);
  });

  it("survives the same batch arriving twice inside one call", async () => {
    // Cook repeats a multi parcel sale once per PIN, and a re-poll window can
    // hand the same row back twice. Postgres rejects a statement that hits the
    // same conflict target twice, so the batch is deduped before it is sent.
    const sales = normalizeAll(cookSalesAdapter, fixture("cook-sales.json"));
    const doubled = [...sales, ...sales];
    await expect(insertEvents(SOURCE_SALES, doubled)).resolves.toBe(0);
  });

  it("treats a county correction as the same event, not a new one", async () => {
    const [sale] = normalizeAll(cookSalesAdapter, fixture("cook-sales.json"));
    expect(sale).toBeDefined();

    const corrected: PropertyEvent = {
      ...(sale as PropertyEvent),
      parties: [{ role: "buyer", name: "NAME FIXED BY COUNTY" }],
      raw: { ...(sale as PropertyEvent).raw, revision: 2 },
    };

    await expect(insertEvents(SOURCE_SALES, [corrected])).resolves.toBe(0);
  });

  it("stores a distinct row per parcel of a multi parcel sale", async () => {
    const [sale] = normalizeAll(cookSalesAdapter, fixture("cook-sales.json"));
    const sibling: PropertyEvent = {
      ...(sale as PropertyEvent),
      property: { ...(sale as PropertyEvent).property, parcelPin: "99999999999999" },
    };

    await expect(insertEvents(SOURCE_SALES, [sibling])).resolves.toBe(1);
  });
});
