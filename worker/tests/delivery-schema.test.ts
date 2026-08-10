import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./support/pg";

// The delivery queries in src/digest/queries.ts and src/telegram/connect.ts go
// through the Supabase client, which cannot be pointed at a test database. What
// can be proven here is the layer underneath them: that the migrations create
// the columns those queries filter on, and that the filters mean what the code
// assumes they mean.

const TENANT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LEAD_HOT = "1ead1111-0000-4000-8000-000000000001";
const LEAD_COLD = "1ead2222-0000-4000-8000-000000000002";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into tenants (id, name, fixture_key, vertical_preset_id, counties,
                         digest_hour, digest_minute, hot_ping_threshold)
    values ('${TENANT}', 'Paul Restoration', 'paul', 'restoration', '{17031}', 6, 30, 80);

    insert into sources (id, adapter_id, fips, event_types, cadence)
    values ('${SOURCE}', 'il-cook-socrata-permits', '17031', '{PERMIT}', '0 5 * * *');

    insert into events (id, source_id, fips, type, occurred_at, property_category, dedupe_hash)
    values ('${EVENT}', '${SOURCE}', '17031', 'PERMIT', '2026-08-09T09:00:00Z',
            'commercial', 'hash-1');

    insert into leads (id, tenant_id, event_id, score) values
      ('${LEAD_HOT}', '${TENANT}', '${EVENT}', 92);
  `);

  // A second event so the cold lead has its own, since one event yields one lead
  // per tenant.
  await db.exec(`
    insert into events (id, source_id, fips, type, occurred_at, dedupe_hash)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', '${SOURCE}', '17031', 'PERMIT',
            '2026-08-09T09:00:00Z', 'hash-2');

    insert into leads (id, tenant_id, event_id, score) values
      ('${LEAD_COLD}', '${TENANT}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', 40);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the use category survives a round trip", () => {
  it("stores what the adapter stated", async () => {
    // The column that was missing. Without it the permit category the Cook
    // adapter derives existed only in memory, so anything scored from the
    // database silently lost every category weight.
    const result = await db.query<{ property_category: string }>(
      "select property_category from events where id = $1",
      [EVENT],
    );
    expect(result.rows[0]?.property_category).toBe("commercial");
  });

  it("refuses a category outside the vocabulary", async () => {
    await expect(
      db.query(
        `insert into events (source_id, fips, type, occurred_at, property_category, dedupe_hash)
         values ($1, '17031', 'PERMIT', now(), 'penthouse', 'hash-bad')`,
        [SOURCE],
      ),
    ).rejects.toThrow();
  });
});

describe("hot ping dedupe", () => {
  it("finds leads above the threshold that have never pinged", async () => {
    const pending = await db.query<{ id: string }>(
      "select id from leads where tenant_id = $1 and score >= 80 and hot_pinged_at is null",
      [TENANT],
    );
    expect(pending.rows.map((r) => r.id)).toEqual([LEAD_HOT]);
  });

  it("stops finding a lead once it has pinged", async () => {
    // The property that keeps a lead sitting above the threshold from pinging
    // on every worker cycle for the rest of its life.
    await db.query("update leads set hot_pinged_at = now() where id = $1", [LEAD_HOT]);

    const pending = await db.query(
      "select id from leads where tenant_id = $1 and score >= 80 and hot_pinged_at is null",
      [TENANT],
    );
    expect(pending.rows).toHaveLength(0);
  });

  it("never picks up a lead below the threshold", async () => {
    const pending = await db.query(
      "select id from leads where tenant_id = $1 and score >= 80",
      [TENANT],
    );
    expect(pending.rows.map((r) => (r as { id: string }).id)).not.toContain(LEAD_COLD);
  });
});

describe("digest idempotency", () => {
  it("allows one digest per tenant per local day", async () => {
    await db.query(
      "insert into digests (tenant_id, digest_date, lead_ids) values ($1, '2026-08-09', $2)",
      [TENANT, [LEAD_HOT]],
    );

    await expect(
      db.query(
        "insert into digests (tenant_id, digest_date, lead_ids) values ($1, '2026-08-09', $2)",
        [TENANT, [LEAD_COLD]],
      ),
    ).rejects.toThrow();
  });

  it("allows the next day", async () => {
    await expect(
      db.query(
        "insert into digests (tenant_id, digest_date, lead_ids) values ($1, '2026-08-10', $2)",
        [TENANT, [LEAD_HOT]],
      ),
    ).resolves.toBeDefined();
  });
});

describe("telegram connect", () => {
  it("finds an unexpired code and misses an expired one", async () => {
    await db.query(
      `update tenants set telegram_connect_code = 'k7m2p9qr4x',
                          telegram_connect_expires_at = now() + interval '30 minutes'
       where id = $1`,
      [TENANT],
    );

    const live = await db.query(
      "select id from tenants where telegram_connect_code = 'k7m2p9qr4x' and telegram_connect_expires_at > now()",
    );
    expect(live.rows).toHaveLength(1);

    await db.query(
      `update tenants set telegram_connect_expires_at = now() - interval '1 minute' where id = $1`,
      [TENANT],
    );

    const expired = await db.query(
      "select id from tenants where telegram_connect_code = 'k7m2p9qr4x' and telegram_connect_expires_at > now()",
    );
    expect(expired.rows).toHaveLength(0);
  });

  it("stores a negative group chat id, which is why the column is text", async () => {
    // Telegram group ids are negative and large. TELEGRAM_SETUP.md calls this
    // out specifically, and Paul wants his pings in an ops group.
    await db.query(
      "update tenants set telegram_chat_id = $1, telegram_connect_code = null where id = $2",
      ["-1001234567890", TENANT],
    );

    const result = await db.query<{ telegram_chat_id: string }>(
      "select telegram_chat_id from tenants where id = $1",
      [TENANT],
    );
    expect(result.rows[0]?.telegram_chat_id).toBe("-1001234567890");
  });

  it("cannot replay a code once it has been used", async () => {
    const reused = await db.query(
      "select id from tenants where telegram_connect_code = 'k7m2p9qr4x'",
    );
    expect(reused.rows).toHaveLength(0);
  });
});

describe("pausing", () => {
  it("records a pause window on the tenant", async () => {
    await db.query(
      "update tenants set digest_paused_until = now() + interval '7 days' where id = $1",
      [TENANT],
    );

    const paused = await db.query(
      "select id from tenants where digest_paused_until > now()",
    );
    expect(paused.rows).toHaveLength(1);
  });
});
