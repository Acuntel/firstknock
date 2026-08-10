import { Api } from "grammy";
import { log } from "../lib/log";

let api: Api | null = null;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * The send-only Telegram client.
 *
 * Deliberately an Api rather than a Bot. Constructing a Bot here would be enough
 * to start a second long poller against the same token, and TELEGRAM_SETUP.md is
 * explicit that two pollers on one token throw 409s and fight forever. The bot
 * process owns polling; the digest and ping jobs only ever send.
 */
function client(): Api {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set. Copy env.example to .env.");
  }
  api ??= new Api(token);
  return api;
}

/**
 * Sends one message. Chat ids are text because group ids are negative numbers
 * and large enough to be worth keeping out of a numeric column.
 */
export async function sendTelegram(chatId: string, html: string): Promise<void> {
  await client().sendMessage(chatId, html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/** Sends a digest that may have been split across several messages, in order. */
export async function sendTelegramSequence(
  chatId: string,
  messages: string[],
): Promise<void> {
  for (const message of messages) {
    await sendTelegram(chatId, message);
  }
  if (messages.length > 1) {
    log.info("digest split across messages", { chatId, parts: messages.length });
  }
}
