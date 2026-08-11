import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { log } from "../lib/log";
import type { AlertMessage } from "./imap-alerts";

export interface MailboxConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
  mailbox?: string;
}

/**
 * Reads alert mail from a tenant's own mailbox.
 *
 * Read only: nothing is deleted, moved, or marked seen. The mailbox belongs to
 * the tenant and may be one they also read themselves, so this leaves no trace.
 * Re-reading the same window is free because the message id is the dedupe key.
 */
export async function readMailbox(
  config: MailboxConfig,
  since: Date,
  limit = 500,
): Promise<AlertMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port ?? 993,
    secure: config.secure ?? true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  const messages: AlertMessage[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock(config.mailbox ?? "INBOX");
    try {
      for await (const message of client.fetch(
        { since },
        { source: true, envelope: true },
      )) {
        if (messages.length >= limit) break;
        if (!message.source) continue;

        const parsed = await simpleParser(message.source);
        const text =
          parsed.text ??
          // Some vendors send HTML only. Tags are stripped rather than rendered:
          // the regex config is written against words, not markup.
          (parsed.html ? parsed.html.replace(/<[^>]+>/g, " ") : "");

        messages.push({
          from: parsed.from?.text ?? message.envelope?.from?.[0]?.address ?? "",
          subject: parsed.subject ?? message.envelope?.subject ?? "",
          text,
          receivedAt: parsed.date ?? message.envelope?.date ?? new Date(),
          messageId: parsed.messageId ?? `uid-${message.uid}`,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  log.info("mailbox read", { user: config.user, messages: messages.length });
  return messages;
}
