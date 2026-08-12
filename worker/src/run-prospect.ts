import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { log } from "./lib/log";
import { appendDraft, mailboxCredentials, unknownHostHelp } from "./prospect/mail-draft";
import { marketStats, statsSentence } from "./prospect/market-stats";
import { assemblePitch, draftPitch } from "./prospect/pitch";
import { draftableProspects, markDrafted, suppress } from "./prospect/store";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * The outreach run. It writes drafts to your own mailbox and never sends.
 *
 *   pnpm --filter worker prospect stats            what every market can prove
 *   pnpm --filter worker prospect draft 10         draft up to 10, then review them
 *   pnpm --filter worker prospect draft 10 36029   only the Buffalo market
 *   pnpm --filter worker prospect suppress a@b.com they asked to be left alone
 */
const MARKETS = ["55079", "36067", "36029", "26163"];

function sender() {
  const name = process.env.PROSPECT_SENDER_NAME;
  const email = process.env.MAIL_USER ?? process.env.GMAIL_USER;
  const postalAddress = process.env.PROSPECT_POSTAL_ADDRESS;
  if (!name || !email || !postalAddress) return null;
  return { name, email, postalAddress };
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

  const prospects = await draftableProspects(client, limit, fips);
  if (prospects.length === 0) {
    process.stdout.write(
      "Nothing draftable. A prospect needs a verified address, a named person,\n" +
        "and no previous draft. Add some with the importer first.\n",
    );
    return;
  }

  // Metered against a tenant so prospecting spend lands in usage_ledger with
  // everything else rather than being an untracked side channel.
  const { data: tenantRow } = await client.from("tenants").select("id, plan").limit(1).single();
  const tenant = { id: String(tenantRow?.id), plan: String(tenantRow?.plan ?? "solo") };

  let drafted = 0;
  for (const prospect of prospects) {
    if (!prospect.email || !prospect.fips) continue;

    try {
      const stats = await marketStats(client, prospect.fips, now);
      if (stats.total === 0) {
        log.warn("skipping, nothing to sell them", {
          company: prospect.company,
          fips: prospect.fips,
        });
        continue;
      }

      const opening = await draftPitch(client, tenant, prospect, stats, now);
      const body = assemblePitch(prospect, stats, opening, from);

      await appendDraft(
        credentials,
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
      log.info("draft created", { company: prospect.company, subject: opening.subject });
    } catch (error) {
      // One prospect failing is not the run failing. A refusal or a bad
      // generation should cost that draft and nothing else.
      log.error("draft failed", {
        company: prospect.company,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  process.stdout.write(
    `\n${drafted} draft${drafted === 1 ? "" : "s"} waiting in your Drafts folder. Read\n` +
      "every one before sending. Nothing has been sent.\n",
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "stats") return showStats();
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
