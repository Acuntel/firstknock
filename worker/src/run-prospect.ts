import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";

import { mailboxCredentials, unknownHostHelp } from "./prospect/mail-draft";
import { marketStats, statsSentence } from "./prospect/market-stats";


import { suppress } from "./prospect/store";
import { importSites, type ImportTarget } from "./prospect/import";
import { draftBatch } from "./prospect/batch";

import { readFileSync } from "node:fs";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * The outreach run. It writes drafts to your own mailbox and never sends.
 *
 *   pnpm --filter worker prospect stats            what every market can prove
 *   pnpm --filter worker prospect draft 10         draft up to 10, then review them
 *   pnpm --filter worker prospect draft 10 36029   only the Buffalo market
 *   pnpm --filter worker prospect suppress a@b.com they asked to be left alone
 *   pnpm --filter worker prospect import <file.json>  scrape, verify, store
 */
const MARKETS = ["55079", "36067", "36029", "26163"];

function sender() {
  const name = process.env.PROSPECT_SENDER_NAME;
  const email = process.env.MAIL_USER ?? process.env.GMAIL_USER;
  const postalAddress = process.env.PROSPECT_POSTAL_ADDRESS;
  if (!name || !email || !postalAddress) return null;
  return { name, email, postalAddress, phone: process.env.PROSPECT_PHONE || undefined };
}

async function showStats(): Promise<void> {
  const client = createWorkerClient();
  const now = new Date();
  for (const fips of MARKETS) {
    const stats = await marketStats(client, fips, now);
    process.stdout.write(`${statsSentence(stats)}\n`);
  }
}

async function draft(limit: number, fips?: string): Promise<void> {
  const client = createWorkerClient();
  const now = new Date();

  const credentials = mailboxCredentials();
  if (!credentials) {
    const user = process.env.MAIL_USER ?? process.env.GMAIL_USER;
    process.stderr.write(
      user
        ? `${unknownHostHelp(user)}\n`
        : "MAIL_USER and MAIL_APP_PASSWORD are not set. Use an app specific\n" +
          "password, never the account password. iCloud issues them at\n" +
          "appleid.apple.com, Google at myaccount.google.com/apppasswords.\n",
    );
    process.exit(1);
  }

  const from = sender();
  if (!from) {
    process.stderr.write(
      "PROSPECT_SENDER_NAME and PROSPECT_POSTAL_ADDRESS must be set. Commercial\n" +
        "email in the United States has to carry a real postal address.\n",
    );
    process.exit(1);
  }

  const { data: tenantRow } = await client.from("tenants").select("id, plan").limit(1).single();
  const tenant = { id: String(tenantRow?.id), plan: String(tenantRow?.plan ?? "solo") };

  const result = await draftBatch(client, credentials, from, tenant, limit, now, fips);

  if (result.drafted === 0 && result.skipped.length === 0) {
    process.stdout.write(
      "Nothing draftable. A company needs a contactable address and no previous\n" +
        "draft. Add more with prospect import.\n",
    );
    return;
  }

  for (const item of result.skipped.slice(0, 10)) {
    process.stdout.write(`  skipped ${item.company}: ${item.reason}\n`);
  }
  if (result.skipped.length > 10) {
    process.stdout.write(`  and ${result.skipped.length - 10} more skipped\n`);
  }

  process.stdout.write(
    `\n${result.drafted} draft${result.drafted === 1 ? "" : "s"} waiting in your Drafts\n` +
      `folder, written in ${result.seconds}s. Read every one before sending.\n` +
      "Nothing has been sent.\n",
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "stats") return showStats();
  if (command === "import") {
    const file = rest[0] ?? "prospects.seed.json";
    const targets = JSON.parse(readFileSync(file, "utf8")) as ImportTarget[];
    const outcomes = await importSites(createWorkerClient(), targets);

    const tally = new Map<string, number>();
    for (const o of outcomes) tally.set(o.status, (tally.get(o.status) ?? 0) + 1);
    process.stdout.write("\n");
    for (const [status, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(n).padStart(3)}  ${status}\n`);
    }
    // Naming what was dropped and why, because a run that quietly returns three
    // prospects from fourteen sites looks broken rather than normal.
    process.stdout.write(
      `\n${outcomes.filter((o) => o.status === "added").length} of ${outcomes.length} sites` +
        ` produced a contactable prospect. Most small trades run on a contact\n` +
`form rather than a published address, so this ratio is expected.\n`,
    );
    return;
  }
  if (command === "draft") return draft(Number(rest[0] ?? 10), rest[1]);
  if (command === "suppress") {
    const email = rest[0];
    if (!email) throw new Error("Give the address to suppress.");
    await suppress(createWorkerClient(), email, rest[1] ?? "replied no", new Date());
    process.stdout.write(`${email} will never be contacted again.\n`);
    return;
  }

  process.stderr.write(
    "Usage:\n" +
      "  pnpm --filter worker prospect stats\n" +
      "  pnpm --filter worker prospect draft <count> [fips]\n" +
      "  pnpm --filter worker prospect suppress <email> [reason]\n",
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
