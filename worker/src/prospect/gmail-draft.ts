import { ImapFlow } from "imapflow";

export interface DraftMessage {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
}

export interface GmailCredentials {
  user: string;
  /** A Gmail app password, not the account password. */
  appPassword: string;
}

/** Gmail's drafts folder. The localised name varies, the special use flag does not. */
const DRAFTS = "[Gmail]/Drafts";

export function gmailCredentials(): GmailCredentials | null {
  const user = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!user || !appPassword) return null;
  return { user, appPassword };
}

/**
 * RFC 5322 with the header values escaped.
 *
 * A newline inside a subject or a display name would end the header and let the
 * rest be read as more headers, which is header injection. Prospect names come
 * from scraped web pages, so they are exactly the untrusted input that would
 * carry one.
 */
export function buildMime(message: DraftMessage, date: Date): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

  return [
    `From: ${clean(message.fromName)} <${clean(message.fromEmail)}>`,
    `To: ${clean(message.to)}`,
    `Subject: ${clean(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.body,
  ].join("\r\n");
}

/**
 * Puts a draft in the operator's own Gmail. It never sends.
 *
 * This is the whole discipline from EMAIL_BOT_SAUCE.md and it is not squeamish,
 * it is practical. A human reading every message before it goes keeps the
 * quality high, keeps the sending domain's reputation intact, and means a bad
 * generation costs nothing because it gets deleted instead of delivered. An
 * automated sender that gets it wrong burns the domain for every future
 * campaign.
 *
 * Nothing here reads, moves, or deletes existing mail. It appends and quits.
 */
export async function appendDraft(
  credentials: GmailCredentials,
  message: DraftMessage,
  date: Date,
): Promise<void> {
  const imap = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: credentials.user, pass: credentials.appPassword },
    logger: false,
  });

  await imap.connect();
  try {
    await imap.append(DRAFTS, buildMime(message, date), ["\\Draft"], date);
  } finally {
    await imap.logout();
  }
}
