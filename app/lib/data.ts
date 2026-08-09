import {
  cookPermitsAdapter,
  cookSalesAdapter,
} from "@firstknock/worker/adapters/cook-socrata";
import salesFixture from "@firstknock/worker/fixtures/cook-sales.json";
import permitsFixture from "@firstknock/worker/fixtures/cook-permits.json";
import { rankForTenant } from "@firstknock/worker/scoring";
import { toScoringTenant } from "@firstknock/worker/tenants";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";
import type { ScoreBreakdown } from "@firstknock/worker/scoring/types";
import type { CountyAdapter, PropertyEvent, RawRecord } from "@firstknock/worker/types";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "responded",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadView {
  id: string;
  score: number;
  status: LeadStatus;
  breakdown: ScoreBreakdown;
  event: PropertyEvent;
}

/**
 * True when there is no Supabase project to read from.
 *
 * In that state the app serves leads computed from the saved Cook County
 * fixtures through the real scoring engine, so the views are reviewable before
 * any infrastructure exists. Every page says so plainly rather than letting
 * fixture rows pass for a live pipeline.
 */
export function isFixtureMode(): boolean {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY;
}

function normalizeAll(adapter: CountyAdapter, rows: unknown[]): PropertyEvent[] {
  return (rows as RawRecord[])
    .map((row) => adapter.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

function fixtureEvents(): PropertyEvent[] {
  return [
    ...normalizeAll(cookSalesAdapter, salesFixture),
    ...normalizeAll(cookPermitsAdapter, permitsFixture),
  ];
}

/** URL safe, stable id. County record ids contain spaces and punctuation. */
function leadId(event: PropertyEvent): string {
  return `${event.type}-${event.externalId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Spreads fixture leads across the kanban columns.
 *
 * Illustrative, not a claim about real state, which is why it only runs in
 * fixture mode and every page carrying it shows the fixture banner. The hash
 * keeps it stable, so a lead does not jump columns between page loads.
 */
function demoStatus(id: string): LeadStatus {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  // Weighted toward new, which is what a real board looks like most mornings.
  const table: LeadStatus[] = [
    "new",
    "new",
    "new",
    "contacted",
    "contacted",
    "responded",
    "won",
    "lost",
  ];
  return table[hash % table.length] ?? "new";
}

export interface LeadQueryResult {
  leads: LeadView[];
  fixtureMode: boolean;
  /**
   * Events that scored zero for this tenant and were left out.
   *
   * A zero is not a weak lead, it is the vertical saying it does not care about
   * this kind of event at all: a 75 day old sale means nothing to a restoration
   * company. Showing them would bury the real leads. The count is surfaced so
   * the omission is visible rather than silent.
   */
  suppressed: number;
  /** Set when a live query was attempted and failed, so pages can say why. */
  error: string | null;
}

/** Presentation floor. Scoring itself stays untouched and still returns zeros. */
function withoutZeroScores(leads: LeadView[]): {
  leads: LeadView[];
  suppressed: number;
} {
  const kept = leads.filter((lead) => lead.score > 0);
  return { leads: kept, suppressed: leads.length - kept.length };
}

export async function getLeads(tenant: DesignPartnerTenant): Promise<LeadQueryResult> {
  if (isFixtureMode()) {
    const scoring = toScoringTenant(tenant);
    const ranked = rankForTenant(fixtureEvents(), scoring, new Date());

    const scored = ranked.map(({ event, breakdown }) => {
      const id = leadId(event);
      return { id, score: breakdown.score, status: demoStatus(id), breakdown, event };
    });

    return { fixtureMode: true, error: null, ...withoutZeroScores(scored) };
  }

  return liveLeads(tenant);
}

/**
 * The Supabase path.
 *
 * Unverified: there is no project to point it at yet, so this has never
 * returned a row. It is written out rather than stubbed so the shape is
 * reviewable, and it fails visibly instead of silently falling back to fixtures,
 * because a page quietly showing fixture data while claiming to be live is the
 * worst outcome available here.
 */
async function liveLeads(tenant: DesignPartnerTenant): Promise<LeadQueryResult> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false } },
    );

    const { data, error } = await client
      .from("leads")
      .select("id, score, status, score_breakdown, events(*)")
      .order("score", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const leads = (data ?? []).map((row) => {
      const event = row.events as unknown as Record<string, unknown>;
      return {
        id: String(row.id),
        score: Number(row.score),
        status: row.status as LeadStatus,
        breakdown: row.score_breakdown as unknown as ScoreBreakdown,
        event: {
          fips: String(event.fips ?? ""),
          type: event.type,
          occurredAt: new Date(String(event.occurred_at)),
          externalId: String(event.dedupe_hash ?? ""),
          property: {
            address: (event.property_address as string) ?? undefined,
            city: (event.property_city as string) ?? undefined,
            state: (event.property_state as string) ?? undefined,
            zip: (event.property_zip as string) ?? undefined,
            parcelPin: (event.parcel_pin as string) ?? undefined,
            class: (event.property_class as string) ?? undefined,
          },
          parties: (event.parties as never) ?? [],
          raw: (event.raw as never) ?? {},
        } as PropertyEvent,
      };
    });

    return { fixtureMode: false, error: null, ...withoutZeroScores(leads) };
  } catch (error) {
    return {
      leads: [],
      suppressed: 0,
      fixtureMode: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getLead(
  tenant: DesignPartnerTenant,
  id: string,
): Promise<LeadView | null> {
  const { leads } = await getLeads(tenant);
  return leads.find((lead) => lead.id === id) ?? null;
}
