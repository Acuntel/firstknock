import { config as loadEnv } from "dotenv";
import { Api } from "grammy";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Confirms a bot token works and finds the chat ids that have messaged it.
 *
 * This replaces the two curl commands in ben/TELEGRAM_SETUP.md step 2. Finding
 * your own chat id is the fiddliest part of the whole setup, and it is needed
 * before anything can be sent anywhere.
 *
 * Do not run this while the bot is polling. getUpdates is the same endpoint the
 * poller uses, and two readers on one token produce the 409 conflicts the setup
 * doc warns about.
 */
const out = (line = "") => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    out("TELEGRAM_BOT_TOKEN is not set.");
    out("");
    out("Create a bot with @BotFather in Telegram, then put the token in .env:");
    out("  TELEGRAM_BOT_TOKEN=1234567890:AAH...");
    out("");
    out("Full walkthrough is in ben/TELEGRAM_SETUP.md.");
    process.exitCode = 1;
    return;
  }

  const api = new Api(token);

  const me = await api.getMe();
  out(`Token works. Bot is @${me.username} (${me.first_name}).`);

  // A webhook left over from earlier experimentation silently stops polling,
  // and the symptom is a bot that looks alive and answers nothing.
  const webhook = await api.getWebhookInfo();
  if (webhook.url) {
    out("");
    out(`A webhook is set to ${webhook.url}, which stops long polling from working.`);
    out("Clear it once with:");
    out(`  curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`);
  }

  // Private chats and channel posts carry different chat shapes, and the two
  // unions have nothing in common as far as the compiler is concerned. Only
  // these four fields are read.
  interface ChatLike {
    id: number;
    type: string;
    title?: string;
    first_name?: string;
    last_name?: string;
  }

  const updates = await api.getUpdates({ limit: 100, timeout: 0 });
  const chats = new Map<string, string>();
  for (const update of updates) {
    const chat = (update.message?.chat ?? update.channel_post?.chat) as
      | ChatLike
      | undefined;
    if (!chat) continue;
    const label =
      chat.type === "private"
        ? `${chat.first_name ?? ""} ${chat.last_name ?? ""}`.trim() || "private chat"
        : (chat.title ?? chat.type);
    chats.set(String(chat.id), `${label} (${chat.type})`);
  }

  out("");
  if (chats.size === 0) {
    out("No chats have messaged this bot yet.");
    out("");
    out("Bots cannot message you first. Open Telegram, find your bot, and send it");
    out("anything. Then run this again and your chat id will appear here.");
    return;
  }

  out(`${chats.size} chat${chats.size === 1 ? "" : "s"} have messaged this bot:`);
  for (const [id, label] of chats) {
    out(`  ${id.padEnd(16)} ${label}`);
  }
  out("");
  out("Send yourself a real FirstKnock digest with:");
  out(`  pnpm digest:send-test --chat ${[...chats.keys()][0]}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Telegram check failed: ${message}\n`);
  if (message.includes("401")) {
    process.stderr.write("A 401 means the token is wrong. Copy it again from BotFather.\n");
  }
  if (message.includes("409")) {
    process.stderr.write(
      "A 409 means something else is polling this token. Stop the bot process first.\n",
    );
  }
  process.exitCode = 1;
});
