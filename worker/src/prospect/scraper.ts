import { log } from "../lib/log";

export interface ScrapedContact {
  email: string;
  /** True when the mailbox is on the company's own domain. */
  onDomain: boolean;
}

export interface ScrapedPerson {
  name: string;
  role: string | null;
}

export interface ScrapedSite {
  url: string;
  domain: string;
  companyName: string | null;
  contacts: ScrapedContact[];
  people: ScrapedPerson[];
  pagesRead: string[];
}

/** Where a business almost always puts a person's name and an address. */
const SUBPAGES = ["", "/contact", "/contact-us", "/about", "/about-us", "/our-team", "/team"];

/**
 * Free mail providers, which are a signal rather than a nuisance.
 *
 * A company running on a free mailbox is usually one person with a phone, and
 * EMAIL_BOT_SAUCE.md is blunt about why that matters: too small to buy anyway.
 * They are collected but marked off domain so the importer can hold them back.
 */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "aol.com", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "comcast.net",
  "verizon.net", "att.net", "sbcglobal.net", "msn.com",
]);

/** Mailboxes nobody reads, or that belong to the site rather than the business. */
const JUNK_LOCAL_PARTS = /^(no-?reply|donotreply|postmaster|abuse|webmaster|hostmaster|privacy|dmarc|mailer-daemon|example|your-?email|email|name|sentry|wordpress|wix)/i;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MAX_BYTES = 600_000;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        // Identifying rather than pretending to be a browser, and a contact
        // address so anyone who objects can say so.
        "User-Agent": "FirstKnockBot/1.0 (business research; contact via site owner)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    const text = await response.text();
    return text.slice(0, MAX_BYTES);
  } catch {
    return null;
  }
}

export function extractEmails(html: string, domain: string): ScrapedContact[] {
  const found = new Map<string, ScrapedContact>();

  for (const match of html.match(EMAIL_PATTERN) ?? []) {
    // mailto: links carry percent encoding, and a "mailto:%20name@host" leaves
    // the %20 stuck to the front of the address. Decoding first, then trimming,
    // is what stops "%20syracuselawn@gmail.com" reaching the database.
    let decoded = match;
    try {
      decoded = decodeURIComponent(match);
    } catch {
      // Malformed encoding, so take it as written.
    }
    const email = decoded.trim().replace(/^[^a-z0-9]+/i, "").toLowerCase();
    const [local, host] = email.split("@");
    if (!local || !host) continue;
    if (JUNK_LOCAL_PARTS.test(local)) continue;
    // Image and asset filenames pick up the pattern surprisingly often.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(host)) continue;

    const onDomain = host === domain || host.endsWith(`.${domain}`);
    if (!onDomain && !FREE_MAIL.has(host)) {
      // Neither theirs nor a free mailbox, so it belongs to their web designer,
      // a directory, or a partner. Not a person at this company.
      continue;
    }

    if (!found.has(email)) found.set(email, { email, onDomain });
  }

  // Their own domain first, since that is who actually works there.
  return [...found.values()].sort((a, b) => Number(b.onDomain) - Number(a.onDomain));
}

const NAME = "[A-Z][a-z]+(?:\\s+[A-Z][a-z'.-]+){1,2}";
const ROLE = "(?:Owner|Founder|Co-?Founder|President|CEO|Principal|Partner|Manager|General Manager|Director|Operations Manager)";

/**
 * Names that appear next to a role, which is the only kind worth having.
 *
 * A bare capitalised phrase on a web page is as likely to be a town or a
 * service as a person. Requiring a role beside it is what keeps "Grand Rapids
 * Michigan" out of the greeting line, and a wrong name in a greeting is worse
 * than no email at all.
 */
export function extractPeople(html: string): ScrapedPerson[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/g, " ")
    .replace(/\s+/g, " ");

  const found = new Map<string, ScrapedPerson>();

  const patterns = [
    new RegExp(`(${NAME})\\s*[,\\-–|]\\s*(${ROLE})`, "g"),
    new RegExp(`(${ROLE})\\s*[:,\\-–|]\\s*(${NAME})`, "g"),
  ];

  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const name = (index === 0 ? match[1] : match[2])?.trim();
      const role = (index === 0 ? match[2] : match[1])?.trim() ?? null;
      if (!name) continue;
      if (!found.has(name)) found.set(name, { name, role });
    }
  }

  return [...found.values()];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&ndash;": "-", "&mdash;": "-",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Titles that name the page rather than the business. */
const USELESS_TITLES = /^(home|homepage|welcome|index|untitled|about|about us|contact|contact us|main)$/i;

/**
 * The business's name, taken from the page title.
 *
 * Cleaned rather than used raw, because this string is handed to the model and
 * can end up in front of a prospect. Left alone it produced "Home" and
 * "Landscape Maintenance &amp; Services", and an email addressed to a company
 * called Home is worse than one addressed to nobody.
 *
 * Returning null is fine. The importer falls back to the domain, which is
 * always at least recognisable as them.
 */
export function scrapeCompanyName(html: string): string | null {
  const title = /<title[^>]*>([\s\S]{1,200}?)<\/title>/i.exec(html)?.[1];
  if (!title) return null;

  // Titles are nearly always "Name | tagline" or "Name - tagline".
  const head = decodeEntities(title).replace(/\s+/g, " ").split(/[|\u2013\u2014]|\s-\s/)[0]?.trim();
  if (!head || USELESS_TITLES.test(head)) return null;

  // A whole sentence is a tagline, not a name.
  if (head.split(/\s+/).length > 6) return null;
  return head;
}

/**
 * Reads a company's site for a person and an address.
 *
 * Homepage plus the handful of pages a business puts its people on. Pages are
 * fetched one at a time rather than in parallel, deliberately: this is somebody
 * else's small business server and there is no reason to hit it with seven
 * simultaneous requests to save four seconds.
 */
export async function scrapeSite(url: string): Promise<ScrapedSite | null> {
  const domain = domainOf(url);
  if (!domain) return null;

  const base = url.replace(/\/+$/, "");
  const contacts = new Map<string, ScrapedContact>();
  const people = new Map<string, ScrapedPerson>();
  const pagesRead: string[] = [];
  let name: string | null = null;

  for (const path of SUBPAGES) {
    const html = await fetchPage(`${base}${path}`);
    if (!html) continue;

    pagesRead.push(path || "/");
    name ??= scrapeCompanyName(html);
    for (const contact of extractEmails(html, domain)) {
      if (!contacts.has(contact.email)) contacts.set(contact.email, contact);
    }
    for (const person of extractPeople(html)) {
      if (!people.has(person.name)) people.set(person.name, person);
    }

    // Enough to write a real email, so stop rather than keep taking pages.
    if (contacts.size > 0 && people.size > 0) break;
  }

  if (pagesRead.length === 0) {
    log.warn("site unreadable", { url });
    return null;
  }

  return {
    url: base,
    domain,
    companyName: name,
    contacts: [...contacts.values()],
    people: [...people.values()],
    pagesRead,
  };
}
