import type { SupabaseClient } from "@supabase/supabase-js";
import { eventFromRow } from "../event-row";
import type { PropertyEvent } from "../types";
import type { DigestCadence } from "./schedule";

export interface DeliverableTenant {
  id: string;
  fixture_key: string | null;
  name: string;
  counties: string[];
  vertical_preset_id: string;
  digest_hour: number;
  digest_minute: number;
  digest_timezone: string;
  digest_cadence: DigestCadence;
  digest_channels: string[];
  digest_email: string | null;
  digest_paused_until: string | null;
  telegram_chat_id: string | null;
  hot_ping_threshold: number | null;
  compliance_footer: string | null;
}

const TENANT_COLUMNS =
  "id, fixture_key, name, counties, vertical_preset_id, digest_hour, digest_minute, " +
  "digest_timezone, digest_cadence, digest_channels, digest_email, digest_paused_until, " +
  "telegram_chat_id, hot_ping_threshold, compliance_footer";

export async function loadTenants(client: SupabaseClient): Promise<DeliverableTenant[]> {
  const { data, error } = await client
    .from("tenants")
    .select(TENANT_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to load tenants: ${error.message}`);
  // The client is untyped until Phase 6 generates database types, so it cannot
  // infer a shape from the select string.
  return (data ?? []) as unknown as DeliverableTenant[];
}

export interface LeadWithEvent {
  id: string;
  score: number;
  event: PropertyEvent;
}

function toLeads(rows: unknown[]): LeadWithEvent[] {
  return (rows as Array<Record<string, unknown>>)
    .filter((row) => row.events)
    .map((row) => ({
      id: String(row.id),
      score: Number(row.score),
      event: eventFromRow(row.events as Record<string, unknown>),
    }));
}

/** Top scoring open leads for a tenant, highest first. */
export async function loadTopLeads(
  client: SupabaseClient,
  tenantId: string,
  limit: number,
): Promise<LeadWithEvent[]> {
  const { data, error } = await client
    .from("leads")
    .select("id, score, events(*)")
    .eq("tenant_id", tenantId)
    .gt("score", 0)
    .order("score", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load leads: ${error.message}`);
  return toLeads(data ?? []);
}

/**
 * Leads at or above the tenant's threshold that have never pinged.
 *
 * The hot_pinged_at null check is what stops a lead sitting above the threshold
 * from pinging on every worker cycle for the rest of its life.
 */
export async function loadPendingHotPings(
  client: SupabaseClient,
  tenantId: string,
  threshold: number,
): Promise<LeadWithEvent[]> {
  const { data, error } = await client
    .from("leads")
    .select("id, score, events(*)")
    .eq("tenant_id", tenantId)
    .gte("score", threshold)
    .is("hot_pinged_at", null)
    .order("score", { ascending: false })
    .limit(20);

  if (error) throw new Error(`Failed to load hot pings: ${error.message}`);
  return toLeads(data ?? []);
}

export async function markHotPinged(
  client: SupabaseClient,
  leadIds: string[],
): Promise<void> {
  if (leadIds.length === 0) return;
  const { error } = await client
    .from("leads")
    .update({ hot_pinged_at: new Date().toISOString() })
    .in("id", leadIds);
  if (error) throw new Error(`Failed to mark hot pings: ${error.message}`);
}

/** The digest_date of the most recent digest, used as the send watermark. */
export async function lastDigestDate(
  client: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("digests")
    .select("digest_date")
    .eq("tenant_id", tenantId)
    .order("digest_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to read digests: ${error.message}`);
  return (data?.digest_date as string | undefined) ?? null;
}

/**
 * Records that a digest went out.
 *
 * Written even when every channel failed, with delivered_at left null. The row
 * is what stops a retry loop resending all morning, and a row with no
 * delivered_at is exactly the signal the sources health page should surface.
 */
export async function recordDigest(
  client: SupabaseClient,
  tenantId: string,
  digestDate: string,
  leadIds: string[],
  deliveredVia: string[],
): Promise<void> {
  const { error } = await client.from("digests").upsert(
    {
      tenant_id: tenantId,
      digest_date: digestDate,
      lead_ids: leadIds,
      delivered_via: deliveredVia,
      delivered_at: deliveredVia.length > 0 ? new Date().toISOString() : null,
    },
    { onConflict: "tenant_id,digest_date" },
  );

  if (error) throw new Error(`Failed to record digest: ${error.message}`);
}
