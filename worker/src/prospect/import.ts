import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyEmail, type EmailVerification } from "../contacts/verify-email";
import { log } from "../lib/log";
import { scrapeSite } from "./scraper";
import { upsertProspects, type ProspectInput } from "./store";

export interface ImportTarget {
  url: string;
  /** Which market they serve, so the pitch quotes that county's numbers. */
  fips: string;
  city: string;
  state: string;
  /** Which buyer segment they belong to, from buyers.ts. */
  segment: string;
}

export interface ImportOutcome {
  url: string;
  status: "added" | "no email" | "unreadable" | "unverified" | "duplicate";
  email?: string;
  person?: string;
  company?: string;
}

/**
 * Turns a company's website into a prospect, or explains why it could not.
 *
 * Every step can legitimately fail and the reason matters, so the outcome is
 * returned rather than logged and swallowed. Roughly three sites in four yield
 * nothing at all: small trades run on contact forms. Knowing which of the two
 * reasons it was, no address versus unreachable site, is what tells you whether
 * to widen the search or fix the scraper.
 */
/**
 * How much we actually know about an address.
 *
 * "verified" still means every layer passed, and nothing here weakens that.
 * What this adds is an honest middle: outbound port 25 is blocked on ordinary
 * residential internet, so the SMTP probe times out on every host from a
 * laptop. A timeout is evidence of nothing, unlike a rejection, which is
 * evidence the mailbox does not exist.
 *
 * So an address the company published on its own domain, where DNS says that
 * domain accepts mail and the probe was merely inconclusive, is recorded as
 * "published". That is a weaker claim than verified and it is stated as one,
 * rather than quietly calling it verified because the strict rule was
 * inconvenient. An address the server actively rejected stays "guessed" and is
 * never draftable, whatever else passed.
 */
function confidenceFrom(verification: EmailVerification, onDomain: boolean): string {
  if (verification.status === "verified") return "verified";

  const failed = (name: string) => verification.steps.find((s) => s.step === name && !s.passed);
  if (failed("syntax") || failed("mx")) return "guessed";

  const smtp = verification.steps.find((s) => s.step === "smtp");
  const inconclusive = !smtp || /did not answer|timed out|ETIMEDOUT|ECONNREFUSED|blocked/i.test(smtp.detail);
  if (!inconclusive) return "guessed";

  return onDomain ? "published" : "guessed";
}

export async function importSite(
  client: SupabaseClient,
  target: ImportTarget,
): Promise<ImportOutcome> {
  const site = await scrapeSite(target.url);
  if (!site) return { url: target.url, status: "unreadable" };

  // Their own domain before a free mailbox, since that is who works there.
  const contact = site.contacts.find((c) => c.onDomain) ?? site.contacts[0];
  if (!contact) {
    return { url: target.url, status: "no email", company: site.companyName ?? undefined };
  }

  // The same three layer check the property contact chain uses. Anything that
  // could not be fully proven stays "guessed" and is never draftable.
  const verification = await verifyEmail(contact.email, {
    probeFrom: process.env.MAIL_USER ?? process.env.GMAIL_USER,
  });

  const person = site.people[0];
  const input: ProspectInput = {
    company: site.companyName ?? site.domain,
    website: site.url,
    city: target.city,
    state: target.state,
    fips: target.fips,
    personName: person?.name,
    personRole: person?.role ?? undefined,
    email: contact.email,
    emailConfidence: confidenceFrom(verification, contact.onDomain),
    segment: target.segment,
  };

  const added = await upsertProspects(client, [input]);

  const confidence = input.emailConfidence;
  return {
    url: target.url,
    status: added === 0 ? "duplicate" : confidence === "guessed" ? "unverified" : "added",
    email: contact.email,
    person: person?.name,
    company: input.company,
  };
}

/**
 * Imports a list of sites one at a time.
 *
 * Sequential on purpose. These are small business servers and the verifier
 * makes an SMTP connection per address, which is exactly the sort of traffic
 * that gets a sending host blocked when it arrives all at once.
 */
export async function importSites(
  client: SupabaseClient,
  targets: ImportTarget[],
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];

  for (const target of targets) {
    try {
      const outcome = await importSite(client, target);
      outcomes.push(outcome);
      log.info("prospect import", { ...outcome });
    } catch (error) {
      outcomes.push({ url: target.url, status: "unreadable" });
      log.error("prospect import failed", {
        url: target.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}
