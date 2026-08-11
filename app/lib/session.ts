import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client carrying the signed in user's session.
 *
 * This is the client every page uses, and it holds the anon key on purpose. RLS
 * is what scopes the data, so a query here returns exactly the rows this user's
 * tenant membership allows and nothing else. The service role key is never used
 * in a page: it bypasses RLS entirely, and a single mistake with it would serve
 * one tenant another tenant's leads.
 */
export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. Refresh happens in the
            // route handler and middleware instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

export interface SignedInUser {
  id: string;
  email: string | null;
}

export async function currentUser(): Promise<SignedInUser | null> {
  const client = await sessionClient();
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export interface UserTenant {
  id: string;
  name: string;
  fixtureKey: string | null;
  verticalPresetId: string;
  counties: string[];
  hotPingThreshold: number | null;
}

/**
 * The tenants this user belongs to.
 *
 * Reads through RLS rather than filtering in application code. The policy on
 * `tenants` already restricts the result to this user's memberships, so a bug
 * here cannot widen it.
 */
export async function tenantsForUser(): Promise<UserTenant[]> {
  const client = await sessionClient();
  const { data, error } = await client
    .from("tenants")
    .select("id, name, fixture_key, vertical_preset_id, counties, hot_ping_threshold")
    .order("name");

  if (error || !data) return [];

  return data.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    fixtureKey: (row.fixture_key as string) ?? null,
    verticalPresetId: String(row.vertical_preset_id),
    counties: (row.counties as string[]) ?? [],
    hotPingThreshold: (row.hot_ping_threshold as number) ?? null,
  }));
}
