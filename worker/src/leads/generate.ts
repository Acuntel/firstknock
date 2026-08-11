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
  /** Events of a type this vertical does not deal in. */
  offVertical: number;
}

/** How far back to look for events that have not been scored for a tenant yet. */
const LOOKBACK_DAYS = 120;

/**
 * PostgREST caps a response at its max-rows setting, 1000 by default, and it
 * does so silently: `.limit(5000)` returns 1000 rows with no error and no
 * indication anything was truncated.
 *
 * That is invisible in tests against a bare Postgres, because it is a PostgREST
 * behaviour rather than a database one. Against the real project it meant the
 * scorer considered the first thousand events and quietly ignored the rest.
 * Every read that can exceed a thousand rows pages explicitly.
 */
const PAGE = 1000;

async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
  maxRows = 50_000,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read ${label}: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }

  log.warn("row cap reached while paging", { label, rows: rows.length, maxRows });
  return rows;
}

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

  const existing = await fetchAllRows<{ event_id: string }>(
    (from, to) =>
      client.from("leads").select("event_id").eq("tenant_id", tenant.id).range(from, to),
    "existing leads",
  );
  const seen = new Set(existing.map((row) => String(row.event_id)));

  const rows = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      client
        .from("events")
        .select("*")
        .in("fips", tenant.counties)
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: false })
        .range(from, to),
    "events",
  );

  return rows
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
      results.push({ tenant: tenant.name, considered: 0, created: 0, skippedZero: 0, excluded: 0, offVertical: 0 });
      continue;
    }

    // Enrichment before scoring, not after: the value gap and class fit terms
    // read signals that only the assessment roll carries.
    const enriched = applyEnrichment(events, await cookAssessedValues.enrich(events));

    const preset = loadPreset(tenant.verticalPresetId);
    // A vertical declares the event types it is actually about. Anything else
    // is not a weak lead, it is the wrong kind of record: a property sale is
    // not law firm intake at any score. Without this the law firm preset
    // produced 7,247 leads all scoring 7, which is a digest of noise and worse
    // than an empty one, because an empty one tells the truth about coverage.
    const relevant = new Set(preset.eventTypes);

    const rows: Array<Record<string, unknown>> = [];
    let skippedZero = 0;
    let excluded = 0;
    let offVertical = 0;

    for (const event of enriched) {
      if (!relevant.has(event.type)) {
        offVertical += 1;
        continue;
      }

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
      offVertical,
    });

    log.info("leads generated", {
      tenant: tenant.name,
      preset: preset.id,
      considered: events.length,
      created: rows.length,
      skippedZero,
      excluded,
      offVertical,
    });
  }

  return results;
}
