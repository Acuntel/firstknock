import { ImapFlow } from "imapflow";

export interface DraftMessage {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
}

export interface MailboxCredentials {
  user: string;
  /** An app specific password, never the account password. */
  appPassword: string;
  host: string;
  port: number;
}

/**
 * IMAP hosts for the providers a person is likely to already have.
 *
 * Guessing from the address domain covers the ordinary case. It cannot cover a
 * custom domain, since hello@lentamente.us on iCloud+ still connects to Apple,
 * so MAIL_IMAP_HOST overrides this whenever it is set.
 */
const PROVIDERS: Record<string, { host: string; port: number }> = {
  "gmail.com": { host: "imap.gmail.com", port: 993 },
  "googlemail.com": { host: "imap.gmail.com", port: 993 },
  "icloud.com": { host: "imap.mail.me.com", port: 993 },
  "me.com": { host: "imap.mail.me.com", port: 993 },
  "mac.com": { host: "imap.mail.me.com", port: 993 },
  "outlook.com": { host: "outlook.office365.com", port: 993 },
  "hotmail.com": { host: "outlook.office365.com", port: 993 },
  "live.com": { host: "outlook.office365.com", port: 993 },
  "yahoo.com": { host: "imap.mail.yahoo.com", port: 993 },
  "aol.com": { host: "imap.aol.com", port: 993 },
};

export function hostForAddress(address: string): { host: string; port: number } | null {
  const domain = address.split("@")[1]?.toLowerCase();
  return domain ? (PROVIDERS[domain] ?? null) : null;
}

/**
 * Whichever mailbox the operator configured.
 *
 * GMAIL_USER and GMAIL_APP_PASSWORD still work, because they were the first
 * names this shipped under and silently ignoring an existing config is worse
 * than carrying two names for a while.
 */
export function mailboxCredentials(): MailboxCredentials | null {
  const user = process.env.MAIL_USER ?? process.env.GMAIL_USER;
  const appPassword = process.env.MAIL_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !appPassword) return null;

  const override = process.env.MAIL_IMAP_HOST;
  const guessed = hostForAddress(user);
  const host = override ?? guessed?.host;
  if (!host) return null;

  return {
    user,
    // Google prints the password in four groups separated by spaces which are
    // not part of it. Apple prints four groups separated by hyphens which are,
    // so only whitespace is removed here.
    appPassword: appPassword.replace(/\s+/g, ""),
    host,
    port: Number(process.env.MAIL_IMAP_PORT) || guessed?.port || 993,
  };
}

export function unknownHostHelp(user: string): string {
  return (
    `Cannot work out the IMAP host for ${user}. If it is a custom domain, set\n` +
    `MAIL_IMAP_HOST. iCloud custom domains use imap.mail.me.com, Google Workspace\n` +
    `uses imap.gmail.com.`
  );
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

/** Folder names to fall back to when the server advertises no special use flag. */
const DRAFT_NAMES = ["[Gmail]/Drafts", "Drafts", "INBOX.Drafts", "Entwürfe", "Brouillons"];

/**
 * Finds the drafts folder rather than assuming what it is called.
 *
 * Gmail calls it [Gmail]/Drafts, iCloud calls it Drafts, and a localised account
 * calls it something else entirely. IMAP servers advertise the folder's purpose
 * with a \Drafts special use flag, which is the same everywhere, so that is what
 * this reads. The name list is only a fallback for servers that do not.
 */
export async function findDraftsFolder(imap: ImapFlow): Promise<string> {
  const boxes = await imap.list();

  const flagged = boxes.find((box) => box.specialUse === "\\Drafts");
  if (flagged) return flagged.path;

  const named = boxes.find((box) => DRAFT_NAMES.includes(box.path));
  if (named) return named.path;

  throw new Error(
    `No drafts folder on this account. Looked for a \\Drafts flag and for ${DRAFT_NAMES.join(", ")}.`,
  );
}

/**
 * Puts a draft in the operator's own mailbox. It never sends.
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
  credentials: MailboxCredentials,
  message: DraftMessage,
  date: Date,
): Promise<void> {
  const imap = new ImapFlow({
    host: credentials.host,
    port: credentials.port,
    secure: true,
    auth: { user: credentials.user, pass: credentials.appPassword },
    logger: false,
    // Fail rather than hang. A rejected password can leave the connection open
    // with no answer, which reads as a stuck process instead of a wrong secret.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  await imap.connect();
  try {
    const drafts = await findDraftsFolder(imap);
    await imap.append(drafts, buildMime(message, date), ["\\Draft"], date);
  } finally {
    await imap.logout();
  }
}
