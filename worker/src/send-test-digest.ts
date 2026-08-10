import { config as loadEnv } from "dotenv";
import { composeDigest, composeHotPing } from "./digest/compose";
import { fabricatedHotEvent } from "./digest/fabricated";
import { fixtureEvents } from "./fixture-events";
import { fixtureLeadId } from "./lead-id";
import { loadPreset } from "./scoring/presets";
import { rankForTenant, scoreEvent } from "./scoring/score";
import { sendTelegram, sendTelegramSequence } from "./telegram/client";
import { DESIGN_PARTNERS, designPartner, toScoringTenant } from "./tenants";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Sends a real digest to a real chat, built from the saved Cook County fixtures.
 *
 * This is the Phase 3 acceptance criteria, exactly as written: "a seeded tenant
 * receives a real Telegram digest from fixture data" and "a fabricated 95-score
 * event pings inside one cycle". Neither needs a database, which is why this
 * exists separately from the worker: the Telegram half can be proven the moment
 * a bot token exists, without waiting on Supabase.
 *
 *   pnpm digest:send-test --chat 123456789
 *   pnpm digest:send-test --chat 123456789 --tenant mike --ping
 */
const out = (line = "") => process.stdout.write(`${line}\n`);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const chatId = arg("chat");
  if (!chatId) {
    out("Usage: pnpm digest:send-test --chat <chat_id> [--tenant <key>] [--ping]");
    out("");
    out(`Tenants: ${DESIGN_PARTNERS.map((t) => t.key).join(", ")}`);
    out("Find your chat id with: pnpm telegram:check");
    process.exitCode = 1;
    return;
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    out("TELEGRAM_BOT_TOKEN is not set. See ben/TELEGRAM_SETUP.md.");
    process.exitCode = 1;
    return;
  }

  const now = arg("at") ? new Date(arg("at") as string) : new Date();
  const partner = designPartner(arg("tenant") ?? "paul");
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
  await sendTelegramSequence(chatId, content.telegram);
  out(
    `Sent ${partner.name}'s digest to chat ${chatId}: ${leads.length} leads across ${content.telegram.length} message${content.telegram.length === 1 ? "" : "s"}.`,
  );

  if (!process.argv.includes("--ping")) {
    out("Add --ping to also send a fabricated hot lead.");
    return;
  }

  const hotEvent = fabricatedHotEvent(partner.weights, now);
  const breakdown = scoreEvent(hotEvent, scoring, now);
  const hotLead = { id: "fabricated-hot-lead", score: breakdown.score, event: hotEvent };

  if (breakdown.score < partner.hotPingThreshold) {
    out(
      `The fabricated lead scored ${breakdown.score}, below ${partner.name}'s ${partner.hotPingThreshold} threshold, so no ping was sent.`,
    );
    out("That is a real result, not a test problem. The weighting would not ping here.");
    return;
  }

  const ping = composeHotPing(composeInput, hotLead, partner.hotPingThreshold);
  await sendTelegram(chatId, ping.telegram);
  out(
    `Sent a hot ping: a fabricated ${hotEvent.property.category} ${hotEvent.type.toLowerCase().replace(/_/g, " ")} scored ${breakdown.score}, above ${partner.name}'s ${partner.hotPingThreshold} threshold.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Send failed: ${message}\n`);
  if (message.includes("chat not found")) {
    process.stderr.write(
      "Telegram says that chat does not exist. Message the bot once first, then run pnpm telegram:check.\n",
    );
  }
  process.exitCode = 1;
});
