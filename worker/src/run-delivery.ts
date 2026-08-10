import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { runDigests } from "./digest/send";
import { runHotPings } from "./digest/hot-ping";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * One delivery pass: hot pings first, then digests.
 *
 * Pings lead because they are the time sensitive half. A lead that just crossed
 * the threshold should reach the operator now, not after the digest for a tenant
 * whose hour happens to sort earlier has finished sending.
 *
 * Safe to run on a tight cron. The schedule decision and the digests table make
 * repeat runs no-ops, and hot_pinged_at does the same for pings.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const client = createWorkerClient();
  const now = new Date();

  const pings = await runHotPings(client, now, { dryRun });
  const digests = await runDigests(client, now, { dryRun });

  const failures = [...pings, ...digests].flatMap((outcome) =>
    outcome.results.filter((result) => result.status === "failed"),
  );

  log.info("delivery pass complete", {
    dryRun,
    tenants: digests.length,
    digestsSent: digests.filter((d) => d.due).length,
    pingsSent: pings.reduce((total, p) => total + p.pinged, 0),
    failures: failures.length,
  });

  for (const failure of failures) {
    log.error("delivery failed", { channel: failure.channel, detail: failure.detail });
  }

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  log.error("delivery pass aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
