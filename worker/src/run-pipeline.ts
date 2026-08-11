import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { generateLeads } from "./leads/generate";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Scores stored events into per tenant leads.
 *
 * Runs between ingest and delivery. Kept separate from both so a scoring change
 * can be replayed over existing events without re-polling every county, and so a
 * county being down never blocks leads from events already stored.
 */
async function main(): Promise<void> {
  const results = await generateLeads(createWorkerClient(), new Date());
  for (const result of results) {
    log.info("tenant scored", { ...result });
  }
  log.info("scoring pass complete", {
    tenants: results.length,
    created: results.reduce((total, r) => total + r.created, 0),
  });
}

main().catch((error: unknown) => {
  log.error("scoring pass aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
