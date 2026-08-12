import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentUser } from "./session";

/**
 * Whether the signed in user runs FirstKnock rather than buys from it.
 *
 * Prospects are the people this business sells to, and a customer must never
 * see that list. There is no tenant to scope them by, so row level security
 * cannot express the rule and the prospects table is left with RLS on and no
 * policy at all, which denies everyone.
 *
 * That means the only way to read it is the service role key, and the only
 * thing standing between a signed in customer and the prospect list is this
 * check. It is an allowlist of addresses rather than anything cleverer,
 * because there is one operator today and an explicit list is auditable.
 */
export async function isOperator(): Promise<boolean> {
  const user = await currentUser();
  if (!user?.email) return false;

  const allowed = (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  // An empty allowlist grants nobody. Defaulting the other way would turn a
  // missing environment variable into an open door.
  return allowed.includes(user.email.toLowerCase());
}

/**
 * A client that bypasses row level security.
 *
 * The file is marked server-only, so importing it from a client component is a
 * build error rather than a leaked key. Every caller must check isOperator
 * first: this client answers to nobody's policy.
 */
export function operatorClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
