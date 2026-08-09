import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url),
);

/**
 * Supabase provides `auth.users` and `auth.uid()` for us in production. The
 * policies are written against them, so a test database has to supply the same
 * shapes or it would be proving something other than what ships.
 *
 * auth.uid() reads the same GUC Supabase uses, which is how a test can say
 * "run this query as that user" without a real JWT.
 */
const AUTH_STUB = `
  create schema if not exists auth;

  create table auth.users (
    id uuid primary key,
    email text
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
  $$;

  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

/**
 * Supabase hands anon and authenticated blanket table privileges and relies on
 * RLS to do the filtering. Reproducing that here matters more than it looks: if
 * the test role lacked GRANTs, a cross tenant read would fail with "permission
 * denied" and the test would pass green while proving nothing about RLS.
 */
const SUPABASE_DEFAULT_GRANTS = `
  grant select, insert, update, delete on all tables in schema public
    to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
`;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** A fresh in-process Postgres with the real migrations applied in order. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_STUB);

  const files = migrationFiles();
  const rlsIndex = files.findIndex((name) => name.includes("_rls"));

  for (const [index, file] of files.entries()) {
    // Grants land after the tables exist and before the RLS migration, which is
    // the order Supabase itself applies them.
    if (index === rlsIndex) await db.exec(SUPABASE_DEFAULT_GRANTS);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  return db;
}

/**
 * Runs a query the way a signed in user would: as the `authenticated` role, with
 * auth.uid() resolving to this user. Both settings are transaction local, so
 * they cannot leak into the next test.
 */
export async function asUser<T extends Record<string, unknown>>(
  db: PGlite,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId }),
    ]);
    const result = await tx.query<T>(sql, params);
    return result.rows;
  });
}

/** Runs a query as a signed out visitor. */
export async function asAnon<T extends Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    const result = await tx.query<T>(sql, params);
    return result.rows;
  });
}
