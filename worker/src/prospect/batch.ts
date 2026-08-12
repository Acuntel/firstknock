import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeteredTenant } from "../ai/client";
import { log } from "../lib/log";
import { segment as findSegment } from "./buyers";
import { openMailbox, type MailboxCredentials } from "./mail-draft";
import { segmentStats, type SegmentStats } from "./market-stats";
import { allBoards, bestLeadFor, type MarketBoard } from "./match";
import { assembleLeadPitch, assemblePitch, draftPitch } from "./pitch";
import { draftableProspects, markDrafted, type ProspectRow } from "./store";

export interface Sender {
  name: string;
  email: string;
  postalAddress: string;
  phone?: string;
}

export interface BatchResult {
  drafted: number;
  skipped: Array<{ company: string; reason: string }>;
  /** Seconds the whole run took, so the pace is visible rather than guessed at. */
  seconds: number;
}

/**
 * How many Claude calls are in flight at once.
 *
 * The mailbox append is fast and the model call is not, so a little concurrency
 * turns a two hundred draft run from about twenty minutes into about five.
 * Kept low deliberately: this shares an API key with PartScout, and burying that
 * under a burst of prospecting would be a poor trade.
 */
const CONCURRENCY = 4;

/**
 * Writes a batch of drafts.
 *
 * Built for two hundred rather than five, which is a different job. Drafting one
 * at a time cost a fresh mailbox login and a five thousand row read of the lead
 * table per prospect, so two hundred meant two hundred logins and a million rows
 * read. Now the mailbox is opened once, the market figures are worked out once
 * per market and trade, and the model calls run a few at a time.
 */
export async function draftBatch(
  client: SupabaseClient,
  credentials: MailboxCredentials,
  from: Sender,
  tenant: MeteredTenant,
  limit: number,
  now: Date,
  fips?: string,
): Promise<BatchResult> {
  const startedAt = Date.now();
  const prospects = await draftableProspects(client, limit, fips);
  const skipped: BatchResult["skipped"] = [];

  if (prospects.length === 0) {
    return { drafted: 0, skipped, seconds: 0 };
  }

  // Every market's board once, not once per company.
  const boards: MarketBoard[] = await allBoards(client, 8, await draftableProspects(client, 2000));

  // The same market and trade produce the same figures for every company in
  // them, so a hundred Buffalo landscapers is one calculation rather than a
  // hundred. This is the single biggest saving in the run.
  const statsCache = new Map<string, SegmentStats>();
  async function statsFor(marketFips: string, segmentId: string): Promise<SegmentStats> {
    const key = `${marketFips}:${segmentId}`;
    const cached = statsCache.get(key);
    if (cached) return cached;

    const fresh = await segmentStats(client, marketFips, findSegment(segmentId), now);
    statsCache.set(key, fresh);
    return fresh;
  }

  const mailbox = await openMailbox(credentials);
  let drafted = 0;

  async function writeOne(prospect: ProspectRow): Promise<void> {
    if (!prospect.email || !prospect.fips) {
      skipped.push({ company: prospect.company, reason: "no address or market" });
      return;
    }

    try {
      const buyer = findSegment(prospect.segment);
      const stats = await statsFor(prospect.fips, prospect.segment);
      if (stats.total === 0) {
        skipped.push({ company: prospect.company, reason: "nothing on file for their county" });
        return;
      }

      const opening = await draftPitch(client, tenant, prospect, stats, buyer, now);
      const lead = bestLeadFor(boards, prospect.id);

      const body = lead
        ? assembleLeadPitch(
            prospect,
            {
              address: lead.event.property.address ?? "",
              city: lead.event.property.city ?? null,
              citation: lead.citation || buyer.label,
              occurredAt: lead.event.occurredAt,
              hasOwner: lead.event.parties.length > 0,
            },
            stats,
            opening,
            from,
            now,
          )
        : assemblePitch(prospect, stats, opening, from);

      await mailbox.append(
        {
          to: prospect.email,
          subject: opening.subject,
          body,
          fromName: from.name,
          fromEmail: from.email,
        },
        now,
      );

      await markDrafted(client, prospect.id, now);
      drafted += 1;
    } catch (error) {
      // One company failing is not the run failing. A refusal or a bad
      // generation should cost that draft and nothing else.
      skipped.push({
        company: prospect.company,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    // A fixed pool rather than one promise per prospect, so two hundred
    // prospects never means two hundred simultaneous model calls.
    const queue = [...prospects];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await writeOne(next);
      }
    });
    await Promise.all(workers);
  } finally {
    await mailbox.close();
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  log.info("draft batch complete", { drafted, skipped: skipped.length, seconds });

  return { drafted, skipped, seconds };
}
