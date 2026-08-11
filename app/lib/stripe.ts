import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server only. Never imported into a client component: the secret key would end
 * up in the browser bundle.
 */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
}

/**
 * The service role client, for the webhook only.
 *
 * The webhook has no signed in user, so it cannot use the anon key and RLS. It
 * is authenticated by Stripe's signature instead, which is why verifying that
 * signature is not optional.
 */
export function adminDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are not set.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
}
