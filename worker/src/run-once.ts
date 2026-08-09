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

  // A failed county should not read as a green run in Railway's logs.
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  log.error("worker run aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
