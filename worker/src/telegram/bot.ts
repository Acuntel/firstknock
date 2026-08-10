import { Bot } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";
import { composeLeadsReply } from "../digest/compose";
import { loadTopLeads } from "../digest/queries";
import { appUrl } from "../digest/send";
import { loadPreset } from "../scoring/presets";
import { log } from "../lib/log";
import { HELP_TEXT, parseConnectCode, parsePause } from "./commands";
import { connectChat } from "./connect";

/**
 * The long polling bot.
 *
 * Exactly one instance of this may run against a given token. TELEGRAM_SETUP.md
 * is blunt about it: two pollers on one token throw 409s and fight forever, and
 * it happens the first time local dev runs while Railway is deployed. Use the dev
 * bot token locally. Nothing else in the worker constructs a Bot, only an Api,
 * so the digest and ping jobs cannot start a second poller by accident.
 */
export function createBot(token: string, client: SupabaseClient): Bot {
  const bot = new Bot(token);

  async function tenantForChat(chatId: string) {
    const { data, error } = await client
      .from("tenants")
      .select("id, name, fixture_key, counties, vertical_preset_id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();
    if (error) throw new Error(`Failed to look up chat: ${error.message}`);
    return data;
  }

  async function setPause(chatId: string, until: Date | null): Promise<boolean> {
    const tenant = await tenantForChat(chatId);
    if (!tenant) return false;
    const { error } = await client
      .from("tenants")
      .update({ digest_paused_until: until?.toISOString() ?? null })
      .eq("id", tenant.id);
    if (error) throw new Error(`Failed to set pause: ${error.message}`);
    return true;
  }

  // Deep link connect. The payload arrives as the argument to /start, which is
  // what makes the whole flow a single tap from the settings page.
  bot.command("start", async (ctx) => {
    const code = parseConnectCode(ctx.match);
    if (!code) {
      await ctx.reply(
        "Welcome to FirstKnock. Open your settings page and tap Connect Telegram to link this chat.",
      );
      return;
    }

    const result = await connectChat(client, code, String(ctx.chat.id), new Date());
    await ctx.reply(result.message);
    if (result.ok) {
      log.info("chat connected", { tenant: result.tenantName, chatType: ctx.chat.type });
    }
  });

  // Group chats cannot use a deep link, so they type the code instead.
  bot.command("connect", async (ctx) => {
    const code = parseConnectCode(ctx.match);
    if (!code) {
      await ctx.reply("Send /connect followed by the code from your settings page.");
      return;
    }

    const result = await connectChat(client, code, String(ctx.chat.id), new Date());
    await ctx.reply(result.message);
  });

  bot.command("leads", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const tenant = await tenantForChat(chatId);
    if (!tenant) {
      await ctx.reply("This chat is not connected yet. Send /start with your connect code.");
      return;
    }

    const preset = loadPreset(String(tenant.vertical_preset_id));
    const leads = await loadTopLeads(client, String(tenant.id), 5);

    await ctx.reply(
      composeLeadsReply({
        tenantName: String(tenant.name),
        counties: (tenant.counties as string[]) ?? [],
        leadNoun: preset.digest.leadNoun,
        subjectTemplate: preset.digest.subject,
        leads,
        appUrl: appUrl(),
        tenantKey: String(tenant.fixture_key ?? tenant.id),
        now: new Date(),
      }),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("pause", async (ctx) => {
    const request = parsePause(ctx.match, new Date());
    if (!request.ok || !request.until) {
      await ctx.reply(request.message);
      return;
    }

    const connected = await setPause(String(ctx.chat.id), request.until);
    await ctx.reply(
      connected
        ? request.message
        : "This chat is not connected yet, so there is nothing to pause.",
    );
  });

  bot.command("resume", async (ctx) => {
    const connected = await setPause(String(ctx.chat.id), null);
    await ctx.reply(
      connected
        ? "Digests and pings are back on."
        : "This chat is not connected yet, so there is nothing to resume.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.catch((error) => {
    // Never let a bad update kill the poller. A token is deliberately not logged
    // anywhere, including here.
    log.error("bot update failed", {
      error: error.error instanceof Error ? error.error.message : String(error.error),
    });
  });

  return bot;
}
