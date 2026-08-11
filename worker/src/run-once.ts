import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  createWorkerClient,
  insertEvents,
  loadEnabledSources,
  recordFailure,
  recordSuccess,
  type SourceRow,
} from "./db";
import { adapterById } from "./registry";
import { log } from "./lib/log";
import { windowStart, withoutFutureDates } from "./window";
import type { PropertyEvent } from "./types";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

interface SourceResult {
  fetched: number;
  normalized: number;
  futureDropped: number;
  inserted: number;
}

async function runSource(
  client: ReturnType<typeof createWorkerClient>,
  source: SourceRow,
): Promise<SourceResult> {
  const adapter = adapterById(source.adapter_id);
  if (!adapter) {
    throw new Error(
      `No adapter registered for ${source.adapter_id}. Check worker/src/registry.ts.`,
    );
  }

  const raw = await adapter.fetch(windowStart(adapter.lookbackDays));

  const normalized: PropertyEvent[] = [];
  for (const record of raw) {
    const event = adapter.normalize(record);
    if (event) normalized.push(event);
  }

  const { kept, dropped } = withoutFutureDates(normalized);
  const inserted = await insertEvents(client, source.id, kept);

  return {
    fetched: raw.length,
    normalized: normalized.length,
    futureDropped: dropped,
    inserted,
  };
}

async function main(): Promise<void> {
  const client = createWorkerClient();
  const sources = await loadEnabledSources(client);

  if (sources.length === 0) {
    log.warn("no enabled sources, nothing to poll", {
      hint: "run pnpm worker:seed-sources first",
    });
    return;
  }

  let totalInserted = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      const result = await runSource(client, source);
      await recordSuccess(client, source.id);
      totalInserted += result.inserted;
      log.info("source polled", { adapter: source.adapter_id, ...result });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await recordFailure(client, source, message);
      log.error("source failed", { adapter: source.adapter_id, error: message });
    }
  }

  log.info("run complete", {
    sources: sources.length,
    failed,
    inserted: totalInserted,
  });

  writeReceipt({
    at: new Date().toISOString(),
    sources: sources.length,
    failed,
    inserted: totalInserted,
    // Which packs actually ran, so the cockpit can tell "this county is live"
    // from "this county exists in the registry". A pack that is coded but not
    // seeded, or seeded but failing, is absent here.
    ran: sources.map((source) => source.adapter_id).sort(),
  });

  // A failed county should not read as a green run in Railway's logs.
  if (failed > 0) process.exitCode = 1;
}

/**
 * Leaves proof on disk that a real run against a real database happened.
 *
 * The cockpit has no database credentials and no dependencies by design, so
 * "events land from a live worker run" is otherwise something a human has to
 * assert. A receipt the runner writes is a derived fact instead of a claim,
 * and a failed run writes one too, so a red run cannot read as green.
 */
function writeReceipt(receipt: Record<string, unknown>): void {
  try {
    const dir = new URL("../../.cockpit/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL("last-run.json", dir), `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    // A receipt is reporting, not the job. Never fail a good run over it.
    log.warn("could not write run receipt", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

main().catch((error: unknown) => {
  log.error("worker run aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
