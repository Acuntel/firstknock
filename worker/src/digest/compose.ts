import { countiesLabel } from "../counties";
import { eventPlace, eventTitle, whyLine } from "../format";
import { countOf, plural } from "../plural";
import type { PropertyEvent } from "../types";

/** Telegram rejects anything longer. Messages are split on lead boundaries. */
const TELEGRAM_LIMIT = 4096;

export interface ComposableLead {
  id: string;
  score: number;
  event: PropertyEvent;
}

export interface ComposeInput {
  tenantName: string;
  counties: string[];
  /** From the vertical preset: "loss", "property", "job", "filing". */
  leadNoun: string;
  /** From the vertical preset, may contain {county}. */
  subjectTemplate: string;
  leads: ComposableLead[];
  appUrl: string;
  tenantKey: string;
  now: Date;
}

export interface DigestContent {
  subject: string;
  /** One or more Telegram messages, each within the length limit. */
  telegram: string[];
  emailText: string;
  emailHtml: string;
}

/**
 * Telegram HTML mode only allows a small tag set, and an unescaped ampersand in
 * a street name is enough to make it reject the whole message. County data is
 * full of them.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function leadUrl(input: ComposeInput, lead: ComposableLead): string {
  const base = input.appUrl.replace(/\/+$/, "");
  return `${base}/leads/${encodeURIComponent(lead.id)}?tenant=${encodeURIComponent(input.tenantKey)}`;
}

export function digestSubject(input: ComposeInput): string {
  return input.subjectTemplate.replace("{county}", countiesLabel(input.counties));
}


/**
 * Splits rendered lead blocks into messages that fit Telegram's limit.
 *
 * Split points are always between leads. Cutting mid lead would strand a score
 * from its address, and a single lead never approaches 4096 characters.
 */
function packMessages(header: string, blocks: string[], footer: string): string[] {
  const messages: string[] = [];
  let current = header;

  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    // The footer only lands on the final message, so every message has to leave
    // room for it in case it turns out to be the last one.
    const overflows = candidate.length + footer.length + 2 > TELEGRAM_LIMIT;

    if (overflows && current !== header) {
      messages.push(current);
      // Continuations start with the lead itself. Repeating the header would
      // read as a second digest rather than the rest of this one.
      current = block;
    } else {
      current = candidate;
    }
  }

  messages.push(footer ? `${current}\n\n${footer}` : current);
  return messages;
}

export function composeDigest(input: ComposeInput): DigestContent {
  const subject = digestSubject(input);
  const count = input.leads.length;
  const where = countiesLabel(input.counties);

  const headline =
    count === 0
      ? `No new ${plural(input.leadNoun, 2)} in ${where} this morning.`
      : `${countOf(input.leadNoun, count)} in ${where}, ranked.`;

  const telegramHeader = `<b>${escapeHtml(subject)}</b>\n${escapeHtml(headline)}`;

  const telegramBlocks = input.leads.map((lead, index) => {
    const title = escapeHtml(eventTitle(lead.event));
    const why = escapeHtml(whyLine(lead.event, input.now));
    const place = escapeHtml(eventPlace(lead.event));
    return [
      `${index + 1}. <b>${lead.score}</b> ${title}`,
      `${why}`,
      `${place}`,
      `<a href="${escapeHtml(leadUrl(input, lead))}">Open this ${escapeHtml(input.leadNoun)}</a>`,
    ].join("\n");
  });

  const telegramFooter =
    count > 0 ? escapeHtml("Reply /leads any time for today's top five.") : "";

  const textBlocks = input.leads.map((lead, index) =>
    [
      `${index + 1}. ${lead.score}  ${eventTitle(lead.event)}`,
      `   ${whyLine(lead.event, input.now)}`,
      `   ${eventPlace(lead.event)}`,
      `   ${leadUrl(input, lead)}`,
    ].join("\n"),
  );

  const emailText = [subject, "", headline, "", ...textBlocks].join("\n");

  const emailHtml = [
    `<h2 style="font:600 18px system-ui,sans-serif;margin:0 0 4px">${escapeHtml(subject)}</h2>`,
    `<p style="font:14px system-ui,sans-serif;color:#5c626d;margin:0 0 16px">${escapeHtml(headline)}</p>`,
    ...input.leads.map(
      (lead, index) => `
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:10px">
        <tr>
          <td style="font:600 14px system-ui,sans-serif;padding:10px 12px;border:1px solid #e3e3e0;border-radius:6px">
            ${index + 1}. ${lead.score} &nbsp; ${escapeHtml(eventTitle(lead.event))}<br />
            <span style="font-weight:400;color:#5c626d">${escapeHtml(whyLine(lead.event, input.now))}</span><br />
            <span style="font-weight:400;color:#5c626d">${escapeHtml(eventPlace(lead.event))}</span><br />
            <a href="${escapeHtml(leadUrl(input, lead))}" style="color:#1f5c9e">Open this ${escapeHtml(input.leadNoun)}</a>
          </td>
        </tr>
      </table>`,
    ),
  ].join("\n");

  return {
    subject,
    telegram: packMessages(telegramHeader, telegramBlocks, telegramFooter),
    emailText,
    emailHtml,
  };
}

/**
 * A hot ping is one lead, sent the moment it crosses the threshold, so it stays
 * short enough to read on a lock screen.
 */
export function composeHotPing(
  input: ComposeInput,
  lead: ComposableLead,
  threshold: number,
): { telegram: string; subject: string; emailText: string; emailHtml: string } {
  const title = eventTitle(lead.event);
  const why = whyLine(lead.event, input.now);
  const place = eventPlace(lead.event);
  const url = leadUrl(input, lead);
  const subject = `${lead.score}: ${title}`;

  return {
    subject,
    telegram: [
      `<b>Hot ${escapeHtml(input.leadNoun)}, ${lead.score}</b>`,
      `${escapeHtml(title)}`,
      `${escapeHtml(why)}`,
      `${escapeHtml(place)}`,
      `<a href="${escapeHtml(url)}">Open it</a>`,
      escapeHtml(`Above your ${threshold} ping threshold.`),
    ].join("\n"),
    emailText: [subject, why, place, url, `Above your ${threshold} ping threshold.`].join(
      "\n",
    ),
    emailHtml: [
      `<h2 style="font:600 18px system-ui,sans-serif;margin:0 0 4px">Hot ${escapeHtml(input.leadNoun)}, ${lead.score}</h2>`,
      `<p style="font:14px system-ui,sans-serif;margin:0 0 2px">${escapeHtml(title)}</p>`,
      `<p style="font:14px system-ui,sans-serif;color:#5c626d;margin:0 0 2px">${escapeHtml(why)}</p>`,
      `<p style="font:14px system-ui,sans-serif;color:#5c626d;margin:0 0 12px">${escapeHtml(place)}</p>`,
      `<a href="${escapeHtml(url)}" style="color:#1f5c9e">Open it</a>`,
    ].join("\n"),
  };
}

/** The /leads command reply: today's top five, no links to keep it scannable. */
export function composeLeadsReply(input: ComposeInput): string {
  if (input.leads.length === 0) {
    return `Nothing scored above zero in ${countiesLabel(input.counties)} yet today.`;
  }

  const top = input.leads.slice(0, 5);
  return [
    `<b>Top ${top.length} in ${escapeHtml(countiesLabel(input.counties))}</b>`,
    ...top.map(
      (lead, index) =>
        `${index + 1}. <b>${lead.score}</b> ${escapeHtml(eventTitle(lead.event))}\n${escapeHtml(whyLine(lead.event, input.now))}\n<a href="${escapeHtml(leadUrl(input, lead))}">Open</a>`,
    ),
  ].join("\n\n");
}
