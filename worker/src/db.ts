import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EventType, PropertyEvent } from "./types";
import { dedupeHash } from "./dedupe";

export interface SourceRow {
  id: string;
  adapter_id: string;
  fips: string;
  event_types: EventType[];
  enabled: boolean;
  cadence: string;
  last_run_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
}

/**
 * The worker is the only thing holding the service role key, and that key carries
 * BYPASSRLS. Nothing here should ever be imported by the Next.js app.
 */
export function createWorkerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy env.example to .env.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadEnabledSources(
  client: SupabaseClient,
): Promise<SourceRow[]> {
  const { data, error } = await client
    .from("sources")
    .select(
      "id, adapter_id, fips, event_types, enabled, cadence, last_run_at, last_success_at, consecutive_failures",
    )
    .eq("enabled", true)
    .order("adapter_id", { ascending: true });

  if (error) throw new Error(`Failed to load sources: ${error.message}`);
  return (data ?? []) as SourceRow[];
}

/**
 * Exported so the idempotency test can exercise the same mapping production
 * uses, rather than a copy of it that could drift.
 */
export function toEventRow(sourceId: string, event: PropertyEvent) {
  return {
    source_id: sourceId,
    fips: event.fips,
    type: event.type,
    occurred_at: event.occurredAt.toISOString(),
    property_address: event.property.address ?? null,
    property_city: event.property.city ?? null,
    property_state: event.property.state ?? null,
    property_zip: event.property.zip ?? null,
    parcel_pin: event.property.parcelPin ?? null,
    lat: event.property.lat ?? null,
    lng: event.property.lng ?? null,
    property_class: event.property.class ?? null,
    parties: event.parties,
    raw: event.raw,
    dedupe_hash: dedupeHash(event),
  };
}

const INSERT_CHUNK = 500;

/**
 * Inserts normalized events, skipping anything already stored.
 *
 * ignoreDuplicates turns this into ON CONFLICT DO NOTHING against the
 * dedupe_hash unique index, so the second run of a window writes nothing. The
 * returned count is genuinely new rows, which is what the acceptance check for
 * Phase 1 measures.
 */
export async function insertEvents(
  client: SupabaseClient,
  sourceId: string,
  events: PropertyEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  // Two adapters can legitimately produce the same hash inside one run, and
  // Postgres rejects a statement that hits the same conflict target twice.
  const unique = new Map(events.map((e) => [dedupeHash(e), e]));
  const rows = [...unique.values()].map((event) => toEventRow(sourceId, event));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { data, error } = await client
      .from("events")
      .upsert(chunk, { onConflict: "dedupe_hash", ignoreDuplicates: true })
      .select("id");

    if (error) throw new Error(`Failed to insert events: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function recordSuccess(
  client: SupabaseClient,
  sourceId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("sources")
    .update({
      last_run_at: now,
      last_success_at: now,
      last_error: null,
      consecutive_failures: 0,
      health: "healthy",
    })
    .eq("id", sourceId);
  if (error) throw new Error(`Failed to record source success: ${error.message}`);
}

/**
 * Health ladder for the sources page in Phase 3: one miss is noise, three in a
 * row means the county changed something and a human needs to look.
 */
export async function recordFailure(
  client: SupabaseClient,
  source: SourceRow,
  message: string,
): Promise<void> {
  const failures = source.consecutive_failures + 1;
  const { error } = await client
    .from("sources")
    .update({
      last_run_at: new Date().toISOString(),
      last_error: message.slice(0, 1000),
      consecutive_failures: failures,
      health: failures >= 3 ? "failing" : "degraded",
    })
    .eq("id", source.id);
  if (error) throw new Error(`Failed to record source failure: ${error.message}`);
}
