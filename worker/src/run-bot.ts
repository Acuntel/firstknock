import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { createBot } from "./telegram/bot";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

/**
 * Runs the Telegram bot in long polling mode.
 *
 * This is its own process, and only one of it may exist per token. Running this
 * locally while Railway has the same token deployed produces 409 conflicts that
 * do not resolve on their own. Use a separate dev bot token in .env.
 */
async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set. Create a bot with BotFather, see ben/TELEGRAM_SETUP.md.",
    );
  }

  const bot = createBot(token, createWorkerClient());

  const stop = () => {
    log.info("bot stopping");
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  log.info("bot starting in long polling mode");
  await bot.start({
    onStart: (info) => log.info("bot online", { username: info.username }),
  });
}

main().catch((error: unknown) => {
  log.error("bot aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
