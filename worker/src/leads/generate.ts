import type { SupabaseClient } from "@supabase/supabase-js";
import { eventFromRow } from "../event-row";
import { applyEnrichment, cookAssessedValues } from "../enrich/cook-assessed";
import { log } from "../lib/log";
import { loadPreset } from "../scoring/presets";
import { scoreEvent } from "../scoring/score";
import type { ScorableEvent, ScoringTenant } from "../scoring/types";
import type { PropertyEvent } from "../types";

/**
 * Turns stored events into per tenant scored leads.
 *
 * This is the step between ingest and delivery. Events are global facts; a lead
 * is one tenant's interpretation of one fact, which is why the same Cook sale
 * becomes a different row with a different score for Paul and for Vince.
 *
 * Without this the pipeline has a hole in the middle: the worker fills `events`
 * and the digest reads `leads`, and nothing joined them.
 */
export interface LeadTenant extends ScoringTenant {
  id: string;
  counties: string[];
}

export interface GenerateResult {
  tenant: string;
  considered: number;
  created: number;
  skippedZero: number;
  excluded: number;
}

/** How far back to look for events that have not been scored for a tenant yet. */
const LOOKBACK_DAYS = 120;

async function loadTenants(client: SupabaseClient): Promise<LeadTenant[]> {
  const { data, error } = await client
    .from("tenants")
    .select(
      "id, name, vertical_preset_id, score_weights, counties, excluded_towns, " +
        "service_area_lat, service_area_lng, service_area_radius_miles, hot_ping_threshold",
    );

  if (error) throw new Error(`Failed to load tenants: ${error.message}`);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    verticalPresetId: String(row.vertical_preset_id),
    weights: row.score_weights as LeadTenant["weights"],
    excludedTowns: (row.excluded_towns as string[]) ?? [],
    counties: (row.counties as string[]) ?? [],
    serviceArea:
      typeof row.service_area_lat === "number" && typeof row.service_area_lng === "number"
        ? {
            lat: row.service_area_lat,
            lng: row.service_area_lng,
            radiusMiles: Number(row.service_area_radius_miles ?? 25),
          }
        : undefined,
    hotPingThreshold: row.hot_ping_threshold as number | undefined,
  }));
}

/**
 * Events in a tenant's counties that do not yet have a lead for them.
 *
 * The not-in filter is what makes this safe to run on a tight cron: a tenant
 * scored yesterday is not rescored today, so the job's cost tracks new events
 * rather than the size of the table.
 */
async function unscoredEvents(
  client: SupabaseClient,
  tenant: LeadTenant,
  since: Date,
): Promise<PropertyEvent[]> {
  if (tenant.counties.length === 0) return [];

  const { data: existing, error: leadError } = await client
    .from("leads")
    .select("event_id")
    .eq("tenant_id", tenant.id);

  if (leadError) throw new Error(`Failed to read leads: ${leadError.message}`);
  const seen = new Set((existing ?? []).map((row) => String(row.event_id)));

  const { data, error } = await client
    .from("events")
    .select("*")
    .in("fips", tenant.counties)
    .gte("occurred_at", since.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`Failed to read events: ${error.message}`);

  return (data ?? [])
    .filter((row) => !seen.has(String(row.id)))
    .map((row) => ({ ...eventFromRow(row), externalId: String(row.id) }));
}

/**
 * Scores and stores.
 *
 * Two things are deliberately not written. A score of zero means the vertical
 * does not care about that event at all, and storing those would bury the real
 * leads under every permit in the county. An excluded town is dropped for the
 * same reason plus an explicit tenant instruction.
 */
export async function generateLeads(
  client: SupabaseClient,
  now: Date,
): Promise<GenerateResult[]> {
  const tenants = await loadTenants(client);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const results: GenerateResult[] = [];

  for (const tenant of tenants) {
    const events = await unscoredEvents(client, tenant, since);
    if (events.length === 0) {
      results.push({ tenant: tenant.name, considered: 0, created: 0, skippedZero: 0, excluded: 0 });
      continue;
    }

    // Enrichment before scoring, not after: the value gap and class fit terms
    // read signals that only the assessment roll carries.
    const enriched = applyEnrichment(events, await cookAssessedValues.enrich(events));

    const preset = loadPreset(tenant.verticalPresetId);
    const rows: Array<Record<string, unknown>> = [];
    let skippedZero = 0;
    let excluded = 0;

    for (const event of enriched) {
      const scorable = event as ScorableEvent & { externalId: string };
      // A sale carries its own price, which is the other half of the value gap.
      const salePrice = Number((event.raw as Record<string, unknown>)?.sale_price ?? 0);
      if (salePrice > 0) {
        scorable.signals = { ...scorable.signals, lastSalePrice: salePrice };
      }

      const breakdown = scoreEvent(scorable, tenant, now);
      if (breakdown.excluded) {
        excluded += 1;
        continue;
      }
      if (breakdown.score <= 0) {
        skippedZero += 1;
        continue;
      }

      rows.push({
        tenant_id: tenant.id,
        event_id: scorable.externalId,
        score: breakdown.score,
        score_breakdown: breakdown,
      });
    }

    if (rows.length > 0) {
      // The unique key on (tenant_id, event_id) makes a repeat run a no-op
      // rather than a duplicate, the same property the dedupe hash gives ingest.
      const { error } = await client
        .from("leads")
        .upsert(rows, { onConflict: "tenant_id,event_id", ignoreDuplicates: true });
      if (error) throw new Error(`Failed to write leads: ${error.message}`);
    }

    results.push({
      tenant: tenant.name,
      considered: events.length,
      created: rows.length,
      skippedZero,
      excluded,
    });

    log.info("leads generated", {
      tenant: tenant.name,
      preset: preset.id,
      considered: events.length,
      created: rows.length,
      skippedZero,
      excluded,
    });
  }

  return results;
}
