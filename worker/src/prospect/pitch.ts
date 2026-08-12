import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJson, type MeteredTenant } from "../ai/client";
import { statsSentence, type MarketStats, type SegmentStats } from "./market-stats";
import type { BuyerSegment } from "./buyers";

export interface Prospect {
  id: string;
  company: string;
  website: string | null;
  city: string | null;
  personName: string | null;
  personRole: string | null;
  email: string | null;
}

export interface PitchOpening {
  subject: string;
  /** Two sentences at most, referencing something real about their business. */
  hook: string;
}

export interface Pitch extends PitchOpening {
  to: string;
  body: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "hook"],
  properties: {
    subject: { type: "string", maxLength: 60 },
    hook: { type: "string", maxLength: 320 },
  },
} as const;

/**
 * The rules that keep every send on message.
 *
 * EMAIL_BOT_SAUCE.md calls this locked structure generation and it is the part
 * worth copying: the model writes exactly two things, a subject and a two
 * sentence opening. The pitch, the numbers, the pricing, the opt out and the
 * signature are all deterministic template below. That is what guarantees no
 * hallucinated claim about coverage or price ever reaches a prospect, because
 * the model is never given the chance to write one.
 */
const SYSTEM = [
  "You write the opening two sentences of a cold business email, nothing else.",
  "The sender sells verified property lead data to house flippers and contractors.",
  "",
  "Rules, all of them absolute:",
  "- Reference only facts given to you about the recipient's business. Invent nothing.",
  "- If you have no real detail about them, write a plain opening about their market instead of guessing.",
  "- Never state a number about the data. Those are inserted after you and you will get them wrong.",
  "- No em dashes, no en dashes, no exclamation marks, no 'Dear', no 'I hope this finds you'.",
  "- No hype adjectives: no 'exciting', 'incredible', 'game changing', 'revolutionary', 'unlock'.",
  "- Subject under 60 characters, lower key than a marketing line, no colon stacking.",
  "- Plain sentences an operator would actually write. Two sentences maximum in the hook.",
  "- Do not make the offer or describe the service. The email does that after you.",
  "- Write as one person, not a company. Never 'we'.",
].join("\n");

function prompt(prospect: Prospect, stats: SegmentStats, segment: BuyerSegment): string {
  const known = [
    `Company: ${prospect.company}`,
    `What they do: ${segment.label}`,
    prospect.personName ? `Person: ${prospect.personName}` : null,
    prospect.personRole ? `Their role: ${prospect.personRole}` : null,
    prospect.city ? `Their city: ${prospect.city}` : null,
    prospect.website ? `Their website: ${prospect.website}` : null,
    `Market being offered: ${stats.county}`,
    `Why this data is worth money to them: ${segment.why}`,
    stats.examples.length > 0
      ? `Real citations from that county, exactly as the city worded them: ${stats.examples.join(" / ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Write the subject and the two sentence opening for an email to this business.",
    "",
    known,
    "",
    "The email offers them the properties in their county that a city has just",
    "cited for the kind of work they do, with the owner's details where the",
    "county publishes them.",
    "",
    "Be specific to their trade. A subject that would suit any contractor in any",
    "city is a failure: it is what every lead vendor sends. Do not state any",
    "number, those are inserted after you.",
  ].join("\n");
}

/**
 * The line that makes this their email rather than anyone's.
 *
 * A county total is true and generic. The count of citations that are this
 * trade's own work is what a landscaper or a hauler actually reacts to, and it
 * is the sentence the whole segment taxonomy exists to produce.
 */
function segmentLine(stats: SegmentStats | MarketStats): string {
  const segmented = stats as SegmentStats;
  if (!segmented.segmentLabel || segmented.segmentCount === undefined) {
    return `I track ${stats.county} and pull the public records that say a property` +
      " is in trouble or about to move. Right now:";
  }

  if (segmented.segmentCount === 0) {
    return `I track ${stats.county} and pull the public records the city files` +
      " against a property. Right now:";
  }

  return (
    `I track what ${stats.county} cites properties for. Of the records I hold,` +
    ` ${segmented.segmentCount.toLocaleString()} are the kind of work you do, and every one` +
    " is an owner the city has already told to fix it."
  );
}

/**
 * The deterministic part, which is most of the email.
 *
 * Everything a prospect could act on or complain about lives here and not in
 * the model: what is being offered, the checkable numbers, the price
 * conversation, and a working opt out. The opt out is honoured for good, and
 * the physical address is required of commercial email in the United States.
 */
export function assemblePitch(
  prospect: Prospect,
  stats: SegmentStats | MarketStats,
  opening: PitchOpening,
  sender: { name: string; email: string; postalAddress: string },
): string {
  const paragraphs = [
    prospect.personName ? `Hi ${prospect.personName.split(" ")[0]},` : "Hi,",
    opening.hook,
    segmentLine(stats),
    statsSentence(stats),
    "Each one is scored, deduplicated, and delivered every morning to your phone or" +
      " inbox. You would get the address, what happened, when, and the owner's" +
      " mailing details where the county publishes them.",
    "If that is worth having, reply and we can set up a short call to work out" +
      " what it is worth to you. If not, no follow up.",
    `${sender.name}\n${sender.email}`,
    `If this is not relevant, reply no and I will not email you again.\n${sender.postalAddress}`,
  ];

  return paragraphs.map((p) => wrap(p)).join("\n\n");
}

/**
 * Wraps plain text to a fixed column.
 *
 * Every paragraph goes through this, including the ones the model wrote and the
 * generated statistics line. The first version only hard wrapped the fixed
 * template, so a long generated sentence sat as one unbroken line next to
 * neatly wrapped ones and the email looked sloppy in exactly the way a cold
 * email cannot afford to.
 *
 * 72 columns is the plain text email convention and it survives being quoted in
 * a reply without re-wrapping into a mess.
 */
export function wrap(text: string, width = 72): string {
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      let current = "";
      for (const word of line.split(/\s+/).filter(Boolean)) {
        if (current === "") current = word;
        else if (current.length + 1 + word.length <= width) current += ` ${word}`;
        else {
          out.push(current);
          current = word;
        }
      }
      if (current !== "") out.push(current);
      return out.join("\n");
    })
    .join("\n");
}

/**
 * Writes the opening for one prospect.
 *
 * Metered like every other Claude call, so a runaway prospecting run shows up
 * in usage_ledger and hits the same monthly cap as everything else.
 */
export async function draftPitch(
  db: SupabaseClient,
  tenant: MeteredTenant,
  prospect: Prospect,
  stats: SegmentStats,
  segment: BuyerSegment,
  now: Date,
): Promise<PitchOpening> {
  const { value } = await generateJson<PitchOpening>(db, {
    tenant,
    op: "prospect_pitch",
    system: SYSTEM,
    prompt: prompt(prospect, stats, segment),
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 400,
    now,
    validate: (raw) => {
      const value = raw as PitchOpening;
      if (typeof value?.subject !== "string" || typeof value?.hook !== "string") {
        throw new Error("Model returned no subject or hook");
      }
      // The style rules are enforced here, not just requested in the prompt. A
      // model that drifts should fail the call rather than quietly send an
      // email that reads like every other piece of cold outreach.
      const text = `${value.subject} ${value.hook}`;
      if (/[—–]/.test(text)) throw new Error("Model used a dash it was told not to");
      if (text.includes("!")) throw new Error("Model used an exclamation mark");
      if (/\bDear\b/i.test(text)) throw new Error("Model opened with Dear");
      if (value.subject.length > 60) throw new Error("Subject too long");
      return value;
    },
  });

  return value;
}

export interface LeadSample {
  /** Street address of the property, which is the whole proof. */
  address: string;
  city: string | null;
  /** What the city cited, in words a contractor recognises. */
  citation: string;
  occurredAt: Date;
  /** Whether the county published who owns it. */
  hasOwner: boolean;
}

/**
 * Strips the house number off an address.
 *
 * "418 Merriman Ave" becomes "Merriman Ave". Enough to prove the record is real
 * and specific, not enough to go and knock on. The whole email turns on the
 * reader believing there is something behind it, and a street name does that
 * without handing over the one thing they are being asked to pay for.
 */
export function streetOnly(address: string): string {
  return address.replace(/^\s*\d+[a-z]?(\s*[-\/]\s*\d+[a-z]?)?\s+/i, "").trim() || address;
}

/**
 * A pitch built around one real property, without giving it away.
 *
 * The earlier version named the full address and offered a free week of the
 * list. That is a sample big enough to be the product: a hauler could work the
 * free week and never come back. This says what was cited, on which street, and
 * how many more there are, then asks for a conversation about price.
 *
 * Proof, not inventory. The specific thing being sold stays behind the call.
 */
export function assembleLeadPitch(
  prospect: Prospect,
  sample: LeadSample,
  stats: SegmentStats,
  opening: PitchOpening,
  sender: {
    name: string;
    email: string;
    postalAddress: string;
    phone?: string;
  },
  now: Date,
): string {
  const days = Math.max(0, Math.round((now.getTime() - sample.occurredAt.getTime()) / 86_400_000));
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  const street = streetOnly(sample.address);
  const where = sample.city ? `${street} in ${sample.city}` : street;

  const others = Math.max(0, stats.segmentCount - 1);

  const reply = sender.phone
    ? `Reply to this or call me on ${sender.phone} and we can work out what the` +
      " list is worth to you."
    : "Reply to this and we can set up a short call to work out what the list is" +
      " worth to you.";

  const paragraphs = [
    prospect.personName ? `Hi ${prospect.personName.split(" ")[0]},` : "Hi,",
    opening.hook,
    `One from ${when}: a property on ${where}, cited for ${sample.citation.toLowerCase()}.` +
      (sample.hasOwner ? " The county publishes the owner's name and mailing address with it." : ""),
    others > 0
      ? `There are ${others.toLocaleString()} more in ${stats.county} that are the same` +
        " kind of work, and the owner of every one has been told by the city to deal" +
        " with it."
      : `I track every citation ${stats.county} files.`,
    "I put the day's list together every morning: the address, what was cited," +
      " when, and the owner's details where the county publishes them. Nobody else" +
      " in your market is working it.",
    reply,
    `${sender.name}\n${sender.email}${sender.phone ? `\n${sender.phone}` : ""}`,
    `If this is not relevant, reply no and I will not email you again.\n${sender.postalAddress}`,
  ];

  return paragraphs.map((p) => wrap(p)).join("\n\n");
}
