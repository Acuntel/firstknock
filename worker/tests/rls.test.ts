import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb } from "./support/pg";

// Two tenants watching the same county, which is the case the whole model turns
// on: one public record fact, two separate per tenant leads, neither visible to
// the other. Fixed ids so failures are readable.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHARED_EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LEAD_A = "1ead1111-0000-4000-8000-000000000001";
const LEAD_B = "1ead2222-0000-4000-8000-000000000002";

let db: PGlite;

async function seed(): Promise<void> {
  // Seeded as the owning superuser, which is the worker's service role position:
  // it bypasses RLS on purpose. Every assertion below runs as a normal user.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'vince@example.com'),
      ('${USER_B}', 'paul@example.com');

    insert into tenants (id, name, vertical_preset_id, counties) values
      ('${TENANT_A}', 'Vince', 'investors', '{17031}'),
      ('${TENANT_B}', 'Paul', 'restoration', '{17031}');

    insert into members (tenant_id, user_id, role) values
      ('${TENANT_A}', '${USER_A}', 'owner'),
      ('${TENANT_B}', '${USER_B}', 'owner');

    insert into sources (id, adapter_id, fips, event_types, cadence) values
      ('33333333-3333-4333-8333-333333333333',
       'il-cook-socrata-sales', '17031', '{SALE}', '0 5 * * *');

    insert into events (id, source_id, fips, type, occurred_at, parcel_pin, dedupe_hash)
    values
      ('${SHARED_EVENT}', '33333333-3333-4333-8333-333333333333', '17031', 'SALE',
       '2026-05-28T00:00:00Z', '17032280160000', 'hash-shared-event');

    insert into leads (id, tenant_id, event_id, score) values
      ('${LEAD_A}', '${TENANT_A}', '${SHARED_EVENT}', 88),
      ('${LEAD_B}', '${TENANT_B}', '${SHARED_EVENT}', 42);

    insert into contacts (lead_id, name, resolution_trail) values
      ('${LEAD_A}', 'Owner A', '[{"step":"county_record"}]'),
      ('${LEAD_B}', 'Owner B', '[{"step":"county_record"}]');

    insert into outreach (lead_id, channel) values
      ('${LEAD_A}', 'letter'),
      ('${LEAD_B}', 'email_draft');

    insert into digests (tenant_id, digest_date, lead_ids) values
      ('${TENANT_A}', '2026-08-09', '{${LEAD_A}}'),
      ('${TENANT_B}', '2026-08-09', '{${LEAD_B}}');

    insert into usage_ledger (tenant_id, op, tokens, dollars) values
      ('${TENANT_A}', 'email_draft', 1200, 0.0180),
      ('${TENANT_B}', 'email_draft', 900, 0.0135);
  `);
}

beforeAll(async () => {
  db = await createTestDb();
  await seed();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("rls: a member sees their own tenant and nothing else", () => {
  it("reads only their own leads", async () => {
    const rows = await asUser<{ id: string }>(db, USER_A, "select id from leads");
    expect(rows.map((r) => r.id)).toEqual([LEAD_A]);
  });

  it("returns zero rows when reaching for the other tenant's lead by id", async () => {
    // The failure mode that matters is a leak, not an error. A denied read comes
    // back empty, so the assertion is on the row count.
    const rows = await asUser(db, USER_A, "select id from leads where id = $1", [
      LEAD_B,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("reads only their own tenant row", async () => {
    const rows = await asUser<{ name: string }>(db, USER_A, "select name from tenants");
    expect(rows.map((r) => r.name)).toEqual(["Vince"]);
  });

  it("reads only their own membership rows", async () => {
    const rows = await asUser(db, USER_B, "select tenant_id from members");
    expect(rows).toHaveLength(1);
  });

  it("cannot reach contacts hanging off the other tenant's lead", async () => {
    const own = await asUser<{ name: string }>(db, USER_A, "select name from contacts");
    expect(own.map((r) => r.name)).toEqual(["Owner A"]);
  });

  it("cannot reach outreach hanging off the other tenant's lead", async () => {
    const rows = await asUser<{ channel: string }>(
      db,
      USER_B,
      "select channel from outreach",
    );
    expect(rows.map((r) => r.channel)).toEqual(["email_draft"]);
  });

  it("cannot read the other tenant's digests or usage", async () => {
    const digests = await asUser(db, USER_A, "select id from digests");
    const usage = await asUser<{ tokens: number }>(
      db,
      USER_A,
      "select tokens from usage_ledger",
    );
    expect(digests).toHaveLength(1);
    expect(usage.map((r) => r.tokens)).toEqual([1200]);
  });
});

describe("rls: writes are scoped too", () => {
  it("cannot update a lead belonging to another tenant", async () => {
    const updated = await asUser(
      db,
      USER_A,
      "update leads set status = 'won' where id = $1 returning id",
      [LEAD_B],
    );
    expect(updated).toHaveLength(0);

    // And the row really is untouched, not just invisible to the returning clause.
    const check = await db.query<{ status: string }>(
      "select status from leads where id = $1",
      [LEAD_B],
    );
    expect(check.rows[0]?.status).toBe("new");
  });

  it("allows a member to move their own lead through the kanban", async () => {
    const updated = await asUser(
      db,
      USER_A,
      "update leads set status = 'contacted' where id = $1 returning status",
      [LEAD_A],
    );
    expect(updated).toHaveLength(1);
  });
});

describe("rls: signed out reads nothing", () => {
  it("refuses anon outright on every tenant scoped table", async () => {
    // Two layers deny this, and the assertion is on the outer one. The RLS
    // migration revokes anon's grants as well as leaving it without a policy, so
    // a signed out client is stopped before RLS is even consulted. Asserting the
    // throw rather than an empty result is deliberate: if someone later re-grants
    // anon, the rows would come back empty via RLS and a row count assertion
    // would stay green while the outer layer had quietly disappeared.
    for (const table of [
      "tenants",
      "members",
      "leads",
      "contacts",
      "outreach",
      "digests",
      "usage_ledger",
    ]) {
      await expect(
        asAnon(db, `select 1 as present from ${table}`),
        `anon should be refused on ${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("returns no global rows to anon either", async () => {
    const events = await asAnon(db, "select 1 as present from events");
    const sources = await asAnon(db, "select 1 as present from sources");
    expect(events).toHaveLength(0);
    expect(sources).toHaveLength(0);
  });
});

describe("rls: global fact tables stay readable to signed in users", () => {
  it("lets any member read events and sources", async () => {
    // Deliberate: an event carries no tenant column, so sharing it leaks nothing
    // about who else subscribes to that county.
    const events = await asUser(db, USER_A, "select id from events");
    const sources = await asUser(db, USER_B, "select id from sources");
    expect(events).toHaveLength(1);
    expect(sources).toHaveLength(1);
  });

  it("still refuses direct writes to the fact tables", async () => {
    await expect(
      asUser(
        db,
        USER_A,
        `insert into events (source_id, fips, type, occurred_at, dedupe_hash)
         values ('33333333-3333-4333-8333-333333333333', '17031', 'SALE', now(), 'nope')`,
      ),
    ).rejects.toThrow();
  });
});

describe("rls: the same event yields separate per tenant leads", () => {
  it("scores one fact differently for two tenants without either seeing the other", async () => {
    const a = await asUser<{ score: number }>(
      db,
      USER_A,
      "select score from leads where event_id = $1",
      [SHARED_EVENT],
    );
    const b = await asUser<{ score: number }>(
      db,
      USER_B,
      "select score from leads where event_id = $1",
      [SHARED_EVENT],
    );

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.score).toBe(88);
    expect(b[0]?.score).toBe(42);
  });
});
