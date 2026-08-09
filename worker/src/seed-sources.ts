import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { allAdapters } from "./registry";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Gives every registered adapter a row in `sources` so the worker has something
 * to poll. Safe to re-run: it matches on adapter_id and leaves enabled, health,
 * and the watermark columns alone on rows that already exist.
 */
async function main(): Promise<void> {
  const client = createWorkerClient();
  const adapters = allAdapters();

  for (const adapter of adapters) {
    const { data: existing, error: readError } = await client
      .from("sources")
      .select("id")
      .eq("adapter_id", adapter.id)
      .maybeSingle();

    if (readError) throw new Error(`Failed to read sources: ${readError.message}`);

    if (existing) {
      // Cadence and event types live in code, so they are the ones worth syncing.
      const { error } = await client
        .from("sources")
        .update({ cadence: adapter.cadence, event_types: adapter.eventTypes })
        .eq("id", existing.id);
      if (error) throw new Error(`Failed to update source: ${error.message}`);
      log.info("source synced", { adapter: adapter.id });
      continue;
    }

    const { error } = await client.from("sources").insert({
      adapter_id: adapter.id,
      fips: adapter.fips,
      event_types: adapter.eventTypes,
      cadence: adapter.cadence,
      enabled: true,
    });
    if (error) throw new Error(`Failed to insert source: ${error.message}`);
    log.info("source created", { adapter: adapter.id, fips: adapter.fips });
  }

  log.info("seed complete", { adapters: adapters.length });
}

main().catch((error: unknown) => {
  log.error("seed aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
