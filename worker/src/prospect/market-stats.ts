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

export interface SegmentStats extends MarketStats {
  segmentLabel: string;
  /** Citations in this county that are this trade's kind of work. */
  segmentCount: number;
  /** A few real citation texts, so the pitch can quote what was actually cited. */
  examples: string[];
}

/**
 * Fields a county might put the citation text in, best first.
 *
 * The first populated one wins rather than all of them joined. Joining produced
 * "Trash & Debris Rental Registry", which is two unrelated fields stuck
 * together and reads as gibberish to the one person who would recognise it.
 */
const CITATION_FIELDS = [
  "violation",
  "complaint_type_name",
  "case_type",
  "description",
  // Permits describe the work rather than a breach, and Detroit's whole feed is
  // permits. Without these a roofer matched nothing in Detroit, because the
  // keyword test ran against an empty string and quietly failed.
  "permit_type",
  "bld_permit_type",
  "current_use_type",
];

/** Everything a citation says, for keyword matching where more text is better. */
export function citationText(raw: unknown): string {
  const record = (raw ?? {}) as Record<string, unknown>;
  return CITATION_FIELDS.map((field) => String(record[field] ?? "")).join(" ").trim();
}

/**
 * The single cleanest description, for quoting back to a prospect.
 *
 * Counties write citations as "ordinance - section - what is actually wrong",
 * and only the last part means anything to a contractor. Splitting on a dash
 * that has whitespace beside it keeps section numbers like 27-72 intact while
 * dropping the legal preamble nobody reads.
 *
 * Labels that describe nothing are rejected outright. Buffalo files most of its
 * cases as GENERAL, and quoting "cited as GENERAL" back at a prospect is worse
 * than quoting nothing.
 */
const USELESS_LABELS = /^(general|rr-?general|other|misc|miscellaneous|n\/?a|none|unknown)$/i;

export function citationLabel(raw: unknown): string {
  const record = (raw ?? {}) as Record<string, unknown>;
  for (const field of CITATION_FIELDS) {
    const value = String(record[field] ?? "").replace(/\s+/g, " ").trim();
    if (value.length <= 3) continue;

    const tail = value.split(/\s+-\s*|\s*-\s+/).pop()?.trim() ?? value;

    // Only a genuinely parenthesised marker like "(e)" is dropped. An earlier
    // version stripped any leading few characters and turned "Accumulation"
    // into "mulation" and "Overgrowth" into "growth".
    const label = tail
      .replace(/^\([a-z0-9]{1,3}\)\s*/i, "")
      .replace(/^[\s\-–,;:.]+|[\s\-–,;:.]+$/g, "")
      .trim();

    if (label.length > 3 && !USELESS_LABELS.test(label)) return label;
  }
  return "";
}


/**
 * What one county holds for one trade.
 *
 * The county wide number is true but generic, and generic is what makes a cold
 * email indistinguishable from every other lead vendor. A landscaper does not
 * care that there are 4,204 open cases in Erie County. They care that 134 of
 * them are overgrowth, which is a job they do, on a property whose owner has
 * been ordered to deal with it.
 *
 * Counted rather than estimated, and the examples are real citation lines, so
 * the claim survives the prospect checking it.
 */
export async function segmentStats(
  client: SupabaseClient,
  fips: string,
  segment: { label: string; citationKeywords?: string[] },
  now: Date,
  sampleCap = 5000,
): Promise<SegmentStats> {
  const base = await marketStats(client, fips, now);

  const { data } = await client
    .from("events")
    .select("raw")
    .eq("fips", fips)
    .order("occurred_at", { ascending: false })
    .limit(sampleCap);

  const keywords = segment.citationKeywords;
  const kept = (data ?? []).filter((row) => {
    if (!keywords) return true;
    const lower = citationText(row.raw).toLowerCase();
    return keywords.some((word) => lower.includes(word));
  });
  const matches = kept;
  const labels = kept.map((row) => citationLabel(row.raw));

  // Deduplicated, because a county cites the same section hundreds of times and
  // three identical examples read as one example.
  const examples = [...new Set(labels)]
    .filter((m) => m.length > 3 && m.length < 60)
    .slice(0, 3);

  return {
    ...base,
    segmentLabel: segment.label,
    segmentCount: matches.length,
    examples,
  };
}
