import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Api } from "grammy";
import { composeDigest, composeHotPing } from "./digest/compose";
import { fabricatedHotEvent } from "./digest/fabricated";
import { fixtureEvents } from "./fixture-events";
import { fixtureLeadId } from "./lead-id";
import { loadPreset } from "./scoring/presets";
import { rankForTenant, scoreEvent } from "./scoring/score";
import { designPartner, toScoringTenant } from "./tenants";

const ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));
loadEnv({ path: ENV_PATH, quiet: true });

/**
 * Everything after "BotFather gave me a token", in one command.
 *
 * Validates the token, saves it, waits for you to say hello to your own bot,
 * then sends a real digest and a hot ping built from the Cook County fixtures.
 *
 *   pnpm telegram:setup 1234567890:AAH...
 *
 * Written as one command on purpose. The four step version was a token, an env
 * file edit, a chat id lookup, and a send, and every one of those is a place to
 * get stuck for someone who has not used Telegram before.
 */
const out = (line = "") => process.stdout.write(`${line}\n`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replaces the token line in .env, leaving every other line untouched. */
function saveToken(token: string): void {
  let contents = "";
  try {
    contents = readFileSync(ENV_PATH, "utf8");
  } catch {
    contents = "TELEGRAM_BOT_TOKEN=\n";
  }

  const line = `TELEGRAM_BOT_TOKEN=${token}`;
  contents = /^TELEGRAM_BOT_TOKEN=.*$/m.test(contents)
    ? contents.replace(/^TELEGRAM_BOT_TOKEN=.*$/m, line)
    : `${contents.replace(/\n*$/, "\n")}${line}\n`;

  writeFileSync(ENV_PATH, contents);
}

interface FoundChat {
  id: string;
  label: string;
}

async function findChat(api: Api): Promise<FoundChat | null> {
  interface ChatLike {
    id: number;
    type: string;
    title?: string;
    first_name?: string;
  }

  const updates = await api.getUpdates({ limit: 100, timeout: 0 });
  for (const update of updates) {
    const chat = (update.message?.chat ?? update.channel_post?.chat) as
      | ChatLike
      | undefined;
    if (!chat) continue;
    return {
      id: String(chat.id),
      label: chat.title ?? chat.first_name ?? chat.type,
    };
  }
  return null;
}

async function main(): Promise<void> {
  const token = process.argv[2];
  if (!token) {
    out("Usage: pnpm telegram:setup <token>");
    out("");
    out("The token comes from @BotFather in Telegram and looks like");
    out("1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    process.exitCode = 1;
    return;
  }

  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    out("That does not look like a bot token.");
    out("BotFather's tokens are digits, a colon, then a long string of letters.");
    process.exitCode = 1;
    return;
  }

  const api = new Api(token);
  const me = await api.getMe();
  out(`Token works. This is @${me.username}.`);

  saveToken(token);
  out(`Saved to .env, which is gitignored and will not be committed.`);

  const webhook = await api.getWebhookInfo();
  if (webhook.url) {
    await api.deleteWebhook();
    out("Cleared a leftover webhook that would have stopped polling from working.");
  }

  let chat = await findChat(api);
  if (!chat) {
    out("");
    out(`Now open Telegram and send @${me.username} any message. Just "hi" is fine.`);
    out("Bots are not allowed to message you first, so it has to hear from you once.");
    out("");
    out("Waiting up to two minutes.");

    for (let attempt = 0; attempt < 40 && !chat; attempt += 1) {
      await wait(3000);
      chat = await findChat(api);
    }
  }

  if (!chat) {
    out("");
    out("Did not hear anything. Send your bot a message, then run this again.");
    out("The token is already saved, so it will pick up from here.");
    process.exitCode = 1;
    return;
  }

  out("");
  out(`Found you: ${chat.label}, chat id ${chat.id}.`);

  const now = new Date();
  const partner = designPartner(process.argv[3] ?? "mike");
  const preset = loadPreset(partner.verticalPresetId);
  const scoring = toScoringTenant(partner);

  const leads = rankForTenant(fixtureEvents(), scoring, now)
    .filter((row) => row.breakdown.score > 0)
    .slice(0, preset.digest.topN)
    .map((row) => ({
      id: fixtureLeadId(row.event),
      score: row.breakdown.score,
      event: row.event,
    }));

  const composeInput = {
    tenantName: partner.name,
    counties: partner.counties,
    leadNoun: preset.digest.leadNoun,
    subjectTemplate: preset.digest.subject,
    leads,
    appUrl: process.env.APP_URL ?? "http://localhost:3100",
    tenantKey: partner.key,
    now,
  };

  const content = composeDigest(composeInput);
  for (const message of content.telegram) {
    await api.sendMessage(chat.id, message, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  }
  out(`Sent ${partner.name}'s digest: ${leads.length} leads from the Cook fixtures.`);

  const hotEvent = fabricatedHotEvent(partner.weights, now);
  const breakdown = scoreEvent(hotEvent, scoring, now);
  const ping = composeHotPing(
    composeInput,
    { id: "fabricated-hot-lead", score: breakdown.score, event: hotEvent },
    partner.hotPingThreshold,
  );

  await api.sendMessage(chat.id, ping.telegram, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  out(`Sent a hot ping: fabricated lead scored ${breakdown.score}.`);

  out("");
  out("Check Telegram. Both should be there.");
  out("That is both Phase 3 acceptance criteria met.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nSetup failed: ${message}\n`);
  if (message.includes("401")) {
    process.stderr.write("A 401 means the token is wrong. Copy it from BotFather again.\n");
  }
  if (message.includes("409")) {
    process.stderr.write("A 409 means the bot is already running. Stop it and retry.\n");
  }
  process.exitCode = 1;
});
