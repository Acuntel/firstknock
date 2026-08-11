import type { EventType, PropertyCategory, PropertyEvent, RawRecord } from "../types";
import { squish } from "../lib/parse";

/**
 * A parsed alert email, before it becomes an event.
 *
 * The ingester is deliberately provider agnostic. Paul already pays for a fire
 * alert service, Z may get one for foreclosure filings, and neither vendor is
 * named anywhere in this file. A tenant supplies a config describing where the
 * fields sit in their own emails, and the same parser serves all of them.
 */
export interface AlertMessage {
  from: string;
  subject: string;
  /** Plain text body. HTML-only mail is converted before it reaches here. */
  text: string;
  receivedAt: Date;
  /** Stable per message, from the mail server. */
  messageId: string;
}

export interface FieldRule {
  /**
   * Regular expression with one capture group. Applied to the subject and body
   * together, so a field can live in either.
   */
  pattern: string;
  /** Case insensitive by default, since alert mail is inconsistent. */
  flags?: string;
}

export interface AlertSourceConfig {
  /** Registry id, e.g. il-cook-imap-fire. */
  id: string;
  fips: string;
  eventType: EventType;
  /** Only mail from a matching sender is parsed. */
  fromPattern: string;
  /** Optional extra gate, for a mailbox carrying several alert kinds. */
  subjectPattern?: string;
  fields: {
    address: FieldRule;
    city?: FieldRule;
    state?: FieldRule;
    zip?: FieldRule;
    parcelPin?: FieldRule;
    occurredAt?: FieldRule;
  };
  /** Applied to every event from this source when the mail says nothing. */
  defaultCategory?: PropertyCategory;
}

function capture(text: string, rule: FieldRule | undefined): string | undefined {
  if (!rule) return undefined;
  try {
    const match = new RegExp(rule.pattern, rule.flags ?? "i").exec(text);
    return squish(match?.[1]);
  } catch {
    // A tenant supplied this pattern. A bad one must not take the run down with
    // it, and the field simply goes missing.
    return undefined;
  }
}

export function matchesSource(message: AlertMessage, config: AlertSourceConfig): boolean {
  try {
    if (!new RegExp(config.fromPattern, "i").test(message.from)) return false;
    if (config.subjectPattern && !new RegExp(config.subjectPattern, "i").test(message.subject)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns one alert email into an event.
 *
 * Pure, and the whole reason the ingester is testable without a mailbox: a
 * fixture email in, a normalized event out, exactly like every county adapter.
 *
 * An address is required. An alert with no address cannot be scored, knocked
 * on, or mailed to, so it is discarded rather than stored as a lead nobody can
 * act on.
 */
export function parseAlert(
  message: AlertMessage,
  config: AlertSourceConfig,
): PropertyEvent | null {
  if (!matchesSource(message, config)) return null;

  const haystack = `${message.subject}\n${message.text}`;
  const address = capture(haystack, config.fields.address);
  if (!address) return null;

  // The alert's own timestamp is preferred when the vendor states one. Mail
  // delivery time is the fallback, and it is close enough: these arrive within
  // minutes of the event, which is the entire reason a tenant pays for them.
  const stated = capture(haystack, config.fields.occurredAt);
  const parsedStated = stated ? new Date(stated) : undefined;
  const occurredAt =
    parsedStated && !Number.isNaN(parsedStated.getTime()) ? parsedStated : message.receivedAt;

  const raw: RawRecord = {
    from: message.from,
    subject: message.subject,
    messageId: message.messageId,
    receivedAt: message.receivedAt.toISOString(),
    body: message.text,
  };

  return {
    fips: config.fips,
    type: config.eventType,
    occurredAt,
    // The mail server's own id. Re-reading a mailbox re-ingests nothing.
    externalId: message.messageId,
    property: {
      address,
      city: capture(haystack, config.fields.city),
      state: capture(haystack, config.fields.state),
      zip: capture(haystack, config.fields.zip),
      parcelPin: capture(haystack, config.fields.parcelPin),
      category: config.defaultCategory,
    },
    parties: [],
    raw,
  };
}

/** Parses a whole mailbox against one source config, dropping what does not match. */
export function parseAlerts(
  messages: AlertMessage[],
  config: AlertSourceConfig,
): PropertyEvent[] {
  return messages
    .map((message) => parseAlert(message, config))
    .filter((event): event is PropertyEvent => event !== null);
}
