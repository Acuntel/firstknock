import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { generateLeads } from "./leads/generate";
import { runDigests } from "./digest/send";
import { runHotPings } from "./digest/hot-ping";
import { adapterById } from "./registry";
import { insertEvents, loadEnabledSources, recordFailure, recordSuccess } from "./db";
import { windowStart, withoutFutureDates } from "./window";
import { log } from "./lib/log";
import type { PropertyEvent } from "./types";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * The whole loop, on a timer. This is what Railway runs.
 *
 * Ingest, then score, then deliver, in that order every cycle. The order is the
 * point: a lead cannot be delivered before it is scored, and it cannot be scored
 * before the event exists. Running them as one process rather than three cron
 * entries means that ordering cannot drift.
 *
 * Every stage is independently idempotent, so a crash anywhere is recovered by
 * the next tick rather than needing a replay.
 */
const CYCLE_MINUTES = Number(process.env.WORKER_CYCLE_MINUTES ?? 15);

async function cycle(): Promise<void> {
  const client = createWorkerClient();
  const now = new Date();

  const sources = await loadEnabledSources(client);
  for (const source of sources) {
    const adapter = adapterById(source.adapter_id);
    if (!adapter) continue;
    try {
      const raw = await adapter.fetch(windowStart(adapter.lookbackDays, now));
      const normalized: PropertyEvent[] = [];
      for (const record of raw) {
        const event = adapter.normalize(record);
        if (event) normalized.push(event);
      }
      const { kept } = withoutFutureDates(normalized, now);
      const inserted = await insertEvents(client, source.id, kept);
      await recordSuccess(client, source.id);
      log.info("ingested", { adapter: source.adapter_id, fetched: raw.length, inserted });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordFailure(client, source, message);
      log.error("ingest failed", { adapter: source.adapter_id, error: message });
    }
  }

  const scored = await generateLeads(client, now);
  log.info("scored", { created: scored.reduce((t, r) => t + r.created, 0) });

  const pings = await runHotPings(client, now);
  const digests = await runDigests(client, now);

  log.info("cycle complete", {
    sources: sources.length,
    pings: pings.reduce((total, p) => total + p.pinged, 0),
    digests: digests.filter((d) => d.due).length,
  });
}

async function main(): Promise<void> {
  log.info("worker starting", { cycleMinutes: CYCLE_MINUTES });
  for (;;) {
    try {
      await cycle();
    } catch (error) {
      log.error("cycle aborted", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, CYCLE_MINUTES * 60_000));
  }
}

main().catch((error: unknown) => {
  log.error("worker died", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
