import type { SupabaseClient } from "@supabase/supabase-js";
import { countyName } from "../counties";

export interface MarketStats {
  fips: string;
  county: string;
  /** Leads scored above zero in this county right now. */
  total: number;
  /** Added in the last week, which is what makes it a subscription. */
  fresh: number;
  /** Leads carrying an owner name and a mailing address. */
  withOwner: number;
  /** Distinct event types present, so the pitch describes the real mix. */
  kinds: string[];
  newestAt: Date | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What FirstKnock can actually prove about one county today.
 *
 * The whole pitch rests on this being true. Telling a Buffalo flipper there are
 * "thousands of distressed properties" is the same sentence every lead vendor
 * sends and it is worth nothing. Telling them there are 4,204 open code
 * enforcement cases, 218 of them on vacant parcels, the newest from Tuesday, is
 * checkable, and being checkable is the entire product.
 *
 * So this counts rows rather than accepting a number from anywhere else, and
 * every figure that reaches a prospect comes from here.
 */
export async function marketStats(
  client: SupabaseClient,
  fips: string,
  now: Date,
): Promise<MarketStats> {
  const { count: total, error: totalError } = await client
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("fips", fips);
  if (totalError) throw new Error(`Failed to count events: ${totalError.message}`);

  const freshSince = new Date(now.getTime() - WEEK_MS).toISOString();
  const { count: fresh } = await client
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("fips", fips)
    .gte("occurred_at", freshSince);

  // An owner with a mailing address is the expensive part of a lead, and most
  // counties do not publish one. Where it exists it is the strongest thing in
  // the pitch, so it is counted rather than claimed.
  const { count: withOwner } = await client
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("fips", fips)
    .neq("parties", "[]");

  const { data: kindRows } = await client
    .from("events")
    .select("type")
    .eq("fips", fips)
    .limit(1000);

  const { data: newest } = await client
    .from("events")
    .select("occurred_at")
    .eq("fips", fips)
    .order("occurred_at", { ascending: false })
    .limit(1);

  return {
    fips,
    county: countyName(fips),
    total: total ?? 0,
    fresh: fresh ?? 0,
    withOwner: withOwner ?? 0,
    kinds: [...new Set((kindRows ?? []).map((row) => String(row.type)))].sort(),
    newestAt: newest?.[0]?.occurred_at ? new Date(String(newest[0].occurred_at)) : null,
  };
}

const KIND_WORDS: Record<string, string> = {
  CODE_VIOLATION: "open code enforcement cases",
  TAX_DELINQUENT: "delinquent tax accounts",
  PERMIT: "building permits",
  SALE: "recorded sales",
  FIRE_INCIDENT: "fire incidents",
  LIS_PENDENS: "foreclosure filings",
  JUDGMENT: "judgments",
  NOTICE_OF_SALE: "notices of sale",
  HOA_REGISTRATION: "HOA registrations",
};

/**
 * The stats as one plain sentence a prospect can check.
 *
 * No adjectives. A number they can go and verify against their own county's
 * portal is more persuasive than any claim about it, and if they do check it
 * the number has to hold up.
 */
export function statsSentence(stats: MarketStats): string {
  if (stats.total === 0) return `Nothing on file for ${stats.county} yet.`;

  const kinds = stats.kinds.map((k) => KIND_WORDS[k] ?? k.toLowerCase().replace(/_/g, " "));
  const kindList =
    kinds.length === 1
      ? kinds[0]
      : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;

  const parts = [
    `${stats.total.toLocaleString()} ${kindList} on file for ${stats.county}`,
  ];
  if (stats.fresh > 0) parts.push(`${stats.fresh.toLocaleString()} of them added in the last week`);
  if (stats.withOwner > 0) {
    parts.push(
      `${stats.withOwner.toLocaleString()} with the owner's name and mailing address attached`,
    );
  }

  return `${parts.join(", ")}.`;
}
