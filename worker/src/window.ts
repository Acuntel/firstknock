import type { PropertyEvent } from "./types";

/**
 * How far into the future an event may be dated before it is treated as a county
 * typo rather than a fact. Small enough to catch bad data, large enough to
 * tolerate timezone skew and genuinely scheduled items like an auction date.
 */
export const FUTURE_TOLERANCE_DAYS = 2;

/**
 * The polling window, anchored on now rather than on the last successful run.
 *
 * The tempting version of this is a watermark: start from last_success_at and
 * read forward. It does not work here, because `since` filters on the date the
 * event happened, not the date the county published it. Cook posts a sale about
 * 75 days after the closing, so a watermark window would ask for sales dated in
 * the last two days, get nothing, mark the source healthy, and never ingest a
 * single sale.
 *
 * Anchoring on now and reaching back the adapter's declared lag is also self
 * healing: a source that was down for a week catches up on its next run with no
 * backfill logic, and re-reading what is already stored inserts nothing.
 */
export function windowStart(lookbackDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

/**
 * Drops events dated implausibly far ahead.
 *
 * Cook's permit feed carries 18 rows with typo'd years: 2032, 2089, 2104, 2210.
 * They are harmless as data and poisonous as leads. A future date matches every
 * incremental window forever, and the freshness decay in Phase 2 would read them
 * as the newest thing in the county every single morning, so the same handful of
 * junk rows would head every digest for all three Cook tenants.
 *
 * This lives here rather than inside normalize because it needs the clock, and
 * adapters are required to stay pure.
 */
export function withoutFutureDates(
  events: PropertyEvent[],
  now: Date = new Date(),
): { kept: PropertyEvent[]; dropped: number } {
  const cutoff = now.getTime() + FUTURE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
  const kept = events.filter((event) => event.occurredAt.getTime() <= cutoff);
  return { kept, dropped: events.length - kept.length };
}
