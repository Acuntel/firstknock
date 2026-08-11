import {
  cookPermitsAdapter,
  cookSalesAdapter,
} from "@firstknock/worker/adapters/cook-socrata";
import salesFixture from "@firstknock/worker/fixtures/cook-sales.json";
import permitsFixture from "@firstknock/worker/fixtures/cook-permits.json";
import { rankForTenant } from "@firstknock/worker/scoring";
import { toScoringTenant } from "@firstknock/worker/tenants";
import { eventFromRow } from "@firstknock/worker/event-row";
import { currentUser, sessionClient } from "./session";
// The digest derives lead ids the same way, so a deep link from a morning
// message resolves to the page it promises.
import { fixtureLeadId } from "@firstknock/worker/lead-id";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";
import type { ScoreBreakdown } from "@firstknock/worker/scoring/types";
import type { CountyAdapter, PropertyEvent, RawRecord } from "@firstknock/worker/types";

import { LEAD_STATUSES, type LeadStatus } from "./lead-status";

export { LEAD_STATUSES };
export type { LeadStatus };

export interface LeadView {
  id: string;
  score: number;
  status: LeadStatus;
  breakdown: ScoreBreakdown;
  event: PropertyEvent;
}

/**
 * True when this request cannot read real leads.
 *
 * Two ways that happens: there is no Supabase project configured, or nobody is
 * signed in. The second matters as much as the first, because RLS scopes leads
 * to a user's tenant membership, so an anonymous request correctly returns
 * nothing rather than someone else's pipeline.
 *
 * In either case the app serves leads computed from the saved Cook County
 * fixtures through the real scoring engine, and says so on every page rather
 * than letting fixture rows pass for a live pipeline.
 */
export async function isFixtureMode(): Promise<boolean> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return true;
  return (await currentUser()) === null;
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
  if (await isFixtureMode()) {
    const scoring = toScoringTenant(tenant);
    const ranked = rankForTenant(fixtureEvents(), scoring, new Date());

    const scored = ranked.map(({ event, breakdown }) => {
      const id = fixtureLeadId(event);
      return { id, score: breakdown.score, status: demoStatus(id), breakdown, event };
    });

    return { fixtureMode: true, error: null, ...withoutZeroScores(scored) };
  }

  return liveLeads(tenant);
}

/**
 * The Supabase path.
 *
 * Scoped entirely by RLS. It fails visibly rather than silently falling back to
 * fixtures, because a page quietly showing fixture data while claiming to be live
 * is the worst outcome available here.
 */
async function liveLeads(tenant: DesignPartnerTenant): Promise<LeadQueryResult> {
  try {
    // The session client, not the service role one. RLS is what scopes these
    // rows to the signed in user's tenant, so a bug here cannot serve one
    // tenant another tenant's pipeline.
    const client = await sessionClient();

    // The switcher selects by fixture key. Resolving it through RLS means a user
    // who picks a tenant they do not belong to simply gets no rows, rather than
    // the app having to police it.
    const { data: match } = await client
      .from("tenants")
      .select("id")
      .eq("fixture_key", tenant.key)
      .maybeSingle();

    if (!match) {
      return {
        leads: [],
        suppressed: 0,
        fixtureMode: false,
        error: `You do not have access to ${tenant.name}, or it has not been created yet.`,
      };
    }

    const { data, error } = await client
      .from("leads")
      .select("id, score, status, score_breakdown, events(*)")
      .eq("tenant_id", match.id)
      .order("score", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const leads = (data ?? []).map((row) => ({
      id: String(row.id),
      score: Number(row.score),
      status: row.status as LeadStatus,
      breakdown: row.score_breakdown as unknown as ScoreBreakdown,
      event: eventFromRow(row.events as unknown as Record<string, unknown>),
    }));

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
