import { sendEmail, resendConfigured } from "../email/resend";
import { sendTelegramSequence, telegramConfigured } from "../telegram/client";

export interface DeliveryTarget {
  tenantName: string;
  channels: string[];
  telegramChatId?: string | null;
  digestEmail?: string | null;
  complianceFooter?: string | null;
}

export interface DeliveryPayload {
  subject: string;
  /** Already split to Telegram's length limit by compose. */
  telegram: string[];
  emailText: string;
  emailHtml: string;
}

export interface DeliveryResult {
  channel: "telegram" | "email";
  status: "sent" | "skipped" | "failed" | "dry-run";
  detail: string;
}

export interface DeliveryOptions {
  /** Renders and reports without sending. Used by the preview command. */
  dryRun?: boolean;
}

/**
 * Sends one payload on every channel a tenant has configured.
 *
 * Channels fail independently on purpose. If Telegram is down, the email digest
 * should still land, and a tenant on both channels should not lose the morning
 * because one transport had a bad minute. Every outcome is reported rather than
 * thrown, so the caller can record partial delivery honestly.
 */
export async function deliver(
  target: DeliveryTarget,
  payload: DeliveryPayload,
  options: DeliveryOptions = {},
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  if (target.channels.includes("telegram")) {
    results.push(await deliverTelegram(target, payload, options));
  }

  if (target.channels.includes("email")) {
    results.push(await deliverEmail(target, payload, options));
  }

  if (results.length === 0) {
    results.push({
      channel: "telegram",
      status: "skipped",
      detail: "This tenant has no delivery channels configured.",
    });
  }

  return results;
}

async function deliverTelegram(
  target: DeliveryTarget,
  payload: DeliveryPayload,
  options: DeliveryOptions,
): Promise<DeliveryResult> {
  if (!target.telegramChatId) {
    return {
      channel: "telegram",
      status: "skipped",
      detail: "No chat connected yet. Send the tenant their connect link from settings.",
    };
  }

  if (options.dryRun) {
    return {
      channel: "telegram",
      status: "dry-run",
      detail: `Would send ${payload.telegram.length} message${payload.telegram.length === 1 ? "" : "s"} to chat ${target.telegramChatId}.`,
    };
  }

  if (!telegramConfigured()) {
    return {
      channel: "telegram",
      status: "skipped",
      detail: "TELEGRAM_BOT_TOKEN is not set.",
    };
  }

  try {
    await sendTelegramSequence(target.telegramChatId, payload.telegram);
    return { channel: "telegram", status: "sent", detail: `Sent to ${target.telegramChatId}.` };
  } catch (error) {
    return {
      channel: "telegram",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverEmail(
  target: DeliveryTarget,
  payload: DeliveryPayload,
  options: DeliveryOptions,
): Promise<DeliveryResult> {
  if (!target.digestEmail) {
    return {
      channel: "email",
      status: "skipped",
      detail: "This tenant has email as a channel but no digest_email set.",
    };
  }

  if (options.dryRun) {
    return {
      channel: "email",
      status: "dry-run",
      detail: `Would email "${payload.subject}" to ${target.digestEmail}.`,
    };
  }

  if (!resendConfigured()) {
    return { channel: "email", status: "skipped", detail: "RESEND_API_KEY is not set." };
  }

  try {
    await sendEmail({
      to: target.digestEmail,
      subject: payload.subject,
      text: payload.emailText,
      html: payload.emailHtml,
      footer: target.complianceFooter,
    });
    return { channel: "email", status: "sent", detail: `Sent to ${target.digestEmail}.` };
  } catch (error) {
    return {
      channel: "email",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
