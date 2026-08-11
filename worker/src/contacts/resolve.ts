import { squish, str } from "../lib/parse";
import type { PropertyEvent } from "../types";
import { verifyEmail, type EmailVerification, type VerifyOptions } from "./verify-email";

export interface TrailStep {
  step: "county_record" | "reverse_lookup" | "verification";
  outcome: "found" | "nothing" | "unavailable";
  detail: string;
  at: string;
}

export interface ResolvedContact {
  name: string | null;
  mailingAddress: string | null;
  emails: EmailVerification[];
  phones: string[];
  /** Every step attempted, in order. Never empty. */
  resolutionTrail: TrailStep[];
}

/**
 * A source of email and phone candidates for an owner.
 *
 * Left as a seam rather than an implementation. BUILD_SPEC section 5 calls for
 * "free reverse-lookup passes", and there is no free source worth wiring in
 * blind: picking one is a decision with legal and data-quality consequences,
 * and inventing a provider here would produce a chain that looks complete and
 * finds nothing. With no provider the step records itself as unavailable, which
 * is visible in the UI, rather than silently absent.
 */
export interface ReverseLookup {
  name: string;
  find(input: {
    ownerName: string;
    mailingAddress: string | null;
    propertyAddress: string | null;
  }): Promise<{ emails: string[]; phones: string[] }>;
}

/**
 * Pulls whatever the county already told us.
 *
 * Free, instant, and the most trustworthy source in the chain: it is the
 * public record itself rather than an inference about it.
 */
function fromCountyRecord(event: PropertyEvent): {
  name: string | null;
  mailingAddress: string | null;
} {
  const owner =
    event.parties.find((party) => party.role === "owner") ??
    event.parties.find((party) => party.role === "applicant") ??
    event.parties.find((party) => party.role === "seller") ??
    null;

  // Cook's permit feed carries the owner's mailing address in the raw record
  // even though the normalized event has nowhere to put it.
  const mailing =
    owner?.address ??
    squish(event.raw["mailing_address"]) ??
    squish(event.raw["appellant_address"]) ??
    null;

  return { name: owner?.name ?? str(event.raw["applicant_name"]) ?? null, mailingAddress: mailing };
}

export interface ResolveOptions {
  reverseLookup?: ReverseLookup;
  verify?: VerifyOptions;
}

/**
 * Resolves a contact for one event.
 *
 * Stops on first success in the sense the spec means: it does not run a paid or
 * slower source once a cheaper one has answered. Every step is recorded whether
 * it succeeded or not, because the acceptance criterion is that no contact row
 * exists without a trail, and a trail that only lists wins cannot explain a
 * blank contact card.
 */
export async function resolveContact(
  event: PropertyEvent,
  options: ResolveOptions = {},
): Promise<ResolvedContact> {
  const trail: TrailStep[] = [];
  const stamp = () => new Date().toISOString();

  const county = fromCountyRecord(event);
  trail.push({
    step: "county_record",
    outcome: county.name ? "found" : "nothing",
    detail: county.name
      ? `County record names ${county.name}${county.mailingAddress ? " with a mailing address" : " with no mailing address"}.`
      : "The county record names no party for this event.",
    at: stamp(),
  });

  let emails: string[] = [];
  let phones: string[] = [];

  if (!options.reverseLookup) {
    trail.push({
      step: "reverse_lookup",
      outcome: "unavailable",
      detail: "No reverse lookup provider is configured, so no contact details were sought.",
      at: stamp(),
    });
  } else if (!county.name) {
    trail.push({
      step: "reverse_lookup",
      outcome: "nothing",
      detail: "Skipped: there is no owner name to look up.",
      at: stamp(),
    });
  } else {
    try {
      const found = await options.reverseLookup.find({
        ownerName: county.name,
        mailingAddress: county.mailingAddress,
        propertyAddress: event.property.address ?? null,
      });
      emails = found.emails;
      phones = found.phones;
      trail.push({
        step: "reverse_lookup",
        outcome: emails.length + phones.length > 0 ? "found" : "nothing",
        detail: `${options.reverseLookup.name} returned ${emails.length} email candidates and ${phones.length} phone candidates.`,
        at: stamp(),
      });
    } catch (error) {
      trail.push({
        step: "reverse_lookup",
        outcome: "unavailable",
        detail: `${options.reverseLookup.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        at: stamp(),
      });
    }
  }

  const verified: EmailVerification[] = [];
  for (const candidate of emails) {
    verified.push(await verifyEmail(candidate, options.verify));
  }

  trail.push({
    step: "verification",
    outcome: emails.length === 0 ? "nothing" : "found",
    detail:
      emails.length === 0
        ? "No email candidates to verify."
        : `${verified.filter((e) => e.status === "verified").length} of ${verified.length} candidates verified.`,
    at: stamp(),
  });

  return {
    name: county.name,
    mailingAddress: county.mailingAddress,
    emails: verified,
    phones,
    resolutionTrail: trail,
  };
}

/** The addresses safe to draft an email to. Guessed addresses are excluded. */
export function verifiedEmails(contact: ResolvedContact): string[] {
  return contact.emails
    .filter((email) => email.status === "verified")
    .map((email) => email.address);
}
