import { config as loadEnv } from "dotenv";
import { Api } from "grammy";
import { createWorkerClient } from "./db";
import { CONNECT_CODE_TTL_MINUTES, issueConnectCode } from "./telegram/connect";
import { ALL_TENANTS } from "./tenants";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Hands a partner a link that connects their Telegram to their tenant.
 *
 * issueConnectCode existed with nothing calling it, so the connect flow was
 * unreachable and every tenant had a null chat id, which means no digest and no
 * hot ping could be delivered to anyone. This is the missing half.
 *
 * A command rather than a settings screen because five design partners are
 * onboarded by hand. When someone signs up without Ben in the room, the same
 * function belongs behind a button.
 *
 *   pnpm --filter worker connect vince
 *   pnpm --filter worker connect all
 */
function usage(message: string): never {
  process.stderr.write(
    `${message}\n\n` +
      `Usage: pnpm --filter worker connect <tenant-key|all> [--force]\n` +
      `  --force disconnects an existing chat first, which is how you undo a test connect.\n` +
      `Tenants: ${ALL_TENANTS.map((t) => t.key).join(", ")}\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const [keysArg] = argv.filter((a) => a !== "--force");
  if (!keysArg) usage("Say which tenant to connect.");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) usage("TELEGRAM_BOT_TOKEN is not set. Run pnpm telegram:setup first.");

  const wanted =
    keysArg === "all"
      ? ALL_TENANTS.map((t) => t.key)
      : keysArg.split(",").map((k) => k.trim()).filter(Boolean);

  const unknown = wanted.filter((k) => !ALL_TENANTS.some((t) => t.key === k));
  if (unknown.length > 0) usage(`Unknown tenant: ${unknown.join(", ")}`);

  // The link needs the bot's own username, and asking Telegram is more reliable
  // than another environment variable someone has to keep in sync with the token.
  const me = await new Api(token).getMe();

  const client = createWorkerClient();
  const { data: tenants, error } = await client
    .from("tenants")
    .select("id, name, fixture_key, telegram_chat_id")
    .in("fixture_key", wanted);
  if (error) throw new Error(`Could not read tenants: ${error.message}`);

  const now = new Date();

  for (const key of wanted) {
    const tenant = (tenants ?? []).find((t) => t.fixture_key === key);
    if (!tenant) {
      process.stdout.write(`${key}: not in the database, run seed-tenants first\n\n`);
      continue;
    }

    if (tenant.telegram_chat_id && !force) {
      process.stdout.write(
        `${tenant.name}: already connected to chat ${tenant.telegram_chat_id}.\n` +
          `  Sending a new link would move their digest to whoever opens it.\n` +
          `  Pass --force to hand it to someone else, which is how you undo a test connect.\n\n`,
      );
      continue;
    }

    if (tenant.telegram_chat_id) {
      // Clearing first means a --force that then fails leaves nobody connected
      // rather than leaving the old chat still receiving someone else's leads.
      const { error: clearError } = await client
        .from("tenants")
        .update({ telegram_chat_id: null })
        .eq("id", tenant.id);
      if (clearError) throw new Error(`Could not disconnect ${tenant.name}: ${clearError.message}`);
      process.stdout.write(`${tenant.name}: disconnected chat ${tenant.telegram_chat_id}\n`);
    }

    const code = await issueConnectCode(client, String(tenant.id), now);
    process.stdout.write(
      `${tenant.name}\n` +
        `  https://t.me/${me.username}?start=${code}\n` +
        `  Single use, expires in ${CONNECT_CODE_TTL_MINUTES} minutes. Send it to them, they tap Start.\n\n`,
    );
  }

  process.stdout.write(
    `The bot has to be running to answer: pnpm --filter worker bot\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
