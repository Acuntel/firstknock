import type { SupabaseClient } from "@supabase/supabase-js";
import { eventFromRow } from "../event-row";
import type { PropertyEvent } from "../types";
import { BUYER_SEGMENTS, MARKETS, matchesSegment, type BuyerSegment, type Market } from "./buyers";
import { citationLabel, citationText } from "./market-stats";
import type { ProspectRow } from "./store";

export interface LeadBuyer {
  prospect: ProspectRow;
  segment: BuyerSegment;
  /** False once this company has already been written to about this lead. */
  mailable: boolean;
}

export interface MatchedLead {
  id: string;
  score: number;
  event: PropertyEvent;
  /** What the city actually cited, in words a contractor recognises. */
  citation: string;
  /** The trades this citation is work for. */
  segments: BuyerSegment[];
  buyers: LeadBuyer[];
}

export interface MarketBoard {
  market: Market;
  leads: MatchedLead[];
}

/**
 * The day's best leads in one market, each with the companies that would buy it.
 *
 * This is the join the whole thing was missing. A lead and a prospect list are
 * separately useless: what sells is "123 Main Street was cited for overgrowth on
 * Tuesday, and here are the four landscapers within ten miles who would want to
 * know". The citation text is what connects them, because it names the trade.
 */
export async function marketBoard(
  client: SupabaseClient,
  market: Market,
  limit: number,
  prospects: ProspectRow[],
): Promise<MarketBoard> {
  // A wide pool, narrowed below to the leads that can actually be acted on.
  // Taking the top five by score alone produced five cards in a row reading
  // "no company on the list does this here yet", which is a true statement and
  // a useless screen.
  const POOL = 400;
  const { data, error } = await client
    .from("leads")
    .select("id, score, events!inner(*)")
    .eq("events.fips", market.fips)
    .gt("score", 0)
    .order("score", { ascending: false })
    .limit(POOL);

  if (error) throw new Error(`Failed to load leads for ${market.label}: ${error.message}`);

  const inMarket = prospects.filter((p) => p.fips === market.fips);

  const leads = (data ?? []).map((row) => {
    const raw = row.events as unknown as Record<string, unknown>;
    const event = eventFromRow(raw);
    const text = citationText(raw.raw);

    const segments = BUYER_SEGMENTS.filter(
      (segment) =>
        segment.eventTypes.includes(event.type) &&
        (segment.citationKeywords ? matchesSegment(segment, text) : true),
    );

    const segmentIds = new Set(segments.map((s) => s.id));
    const buyers: LeadBuyer[] = inMarket
      .filter((prospect) => segmentIds.has(prospect.segment))
      .map((prospect) => ({
        prospect,
        segment: segments.find((s) => s.id === prospect.segment) as BuyerSegment,
        // Suppressed people are already filtered out upstream. This is about
        // not pitching the same company the same property twice.
        mailable: !prospect.doNotContact,
      }));

    return {
      id: String(row.id),
      score: Number(row.score),
      event,
      citation: citationLabel(raw.raw),
      segments,
      buyers,
    };
  });

  // One card per property. A house cited for roofs, exterior walls and interior
  // surfaces is three rows in the database and one job to a contractor, and
  // filling a five lead board with the same address three times wastes it.
  const byProperty = new Map<string, MatchedLead>();
  for (const lead of leads) {
    // Parcel first, address second, and the lead id last so a record with
    // neither still gets its own card instead of colliding with every other
    // addressless one.
    const key = (
      lead.event.property.parcelPin ??
      lead.event.property.address ??
      lead.id
    ).toUpperCase();
    const seen = byProperty.get(key);
    if (!seen) {
      byProperty.set(key, lead);
      continue;
    }

    // Keep whichever citation actually has a buyer, and among equals the one
    // that scores highest.
    const sellable = lead.buyers.length > 0;
    const seenSellable = seen.buyers.length > 0;
    if (sellable !== seenSellable ? sellable : lead.score > seen.score) {
      byProperty.set(key, lead);
    }
  }

  // Leads someone can be emailed about come first, best score among them at the
  // top. The rest fill any remaining space, because a market with buyers for
  // nothing should still show what it has rather than sit empty.
  const unique = [...byProperty.values()];
  const withBuyers = unique.filter((lead) => lead.buyers.length > 0).sort((a, b) => b.score - a.score);
  const withoutBuyers = unique.filter((lead) => lead.buyers.length === 0).sort((a, b) => b.score - a.score);

  return { market, leads: [...withBuyers, ...withoutBuyers].slice(0, limit) };
}

/**
 * Every market's board at once.
 *
 * Markets with no leads are still returned rather than hidden, because an empty
 * Detroit is information: it means that feed has gone quiet, and silently
 * dropping it would make a broken pipeline look like a slow day.
 */
export async function allBoards(
  client: SupabaseClient,
  limit: number,
  prospects: ProspectRow[],
): Promise<MarketBoard[]> {
  const boards: MarketBoard[] = [];
  for (const market of MARKETS) {
    boards.push(await marketBoard(client, market, limit, prospects));
  }
  return boards;
}

/**
 * The strongest lead a given company could be written to about.
 *
 * Batch drafting used the market wide pitch, which asks a contractor to believe
 * a number, while the button on the daily desk used a specific property. There
 * is no reason for the batch to send the weaker email, so both go through this.
 *
 * Null means nothing in their market is their kind of work today, which is a
 * real answer: the market pitch is the fallback, not a failure.
 */
export function bestLeadFor(boards: MarketBoard[], prospectId: string): MatchedLead | null {
  for (const board of boards) {
    for (const lead of board.leads) {
      if (lead.buyers.some((buyer) => buyer.prospect.id === prospectId)) return lead;
    }
  }
  return null;
}
