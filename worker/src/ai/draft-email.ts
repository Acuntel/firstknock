import type { SupabaseClient } from "@supabase/supabase-js";
import { eventPlace, eventTitle, typeLabel, whyLine } from "../format";
import { generateJson, type MeteredTenant } from "./client";
import type { PropertyEvent } from "../types";

export interface DraftTenant extends MeteredTenant {
  name: string;
  leadNoun: string;
  voiceSample: string | null;
  signature: string | null;
  complianceFooter: string | null;
  postalAddress: string | null;
}

export interface DraftRecipient {
  name: string | null;
  /** Only ever a verified address. Guessed addresses are not drafted to. */
  email: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Under 60 characters. No greeting, no company name padding.",
    },
    body: {
      type: "string",
      description:
        "The message body only. No signature, no footer, no unsubscribe line: those are appended afterwards.",
    },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

function validate(value: unknown): EmailDraft {
  const draft = value as Partial<EmailDraft>;
  if (typeof draft.subject !== "string" || typeof draft.body !== "string") {
    throw new Error("Claude returned a draft missing its subject or body.");
  }
  if (draft.subject.trim().length === 0 || draft.body.trim().length === 0) {
    throw new Error("Claude returned an empty draft.");
  }
  return { subject: draft.subject.trim(), body: draft.body.trim() };
}

/**
 * The system prompt.
 *
 * Written for a current model, which means stating the goal and the constraints
 * rather than choreographing steps. The copy rules are the repo's own, from
 * README.md: no dashes, full sentences, no hype.
 */
function systemPrompt(tenant: DraftTenant): string {
  const lines = [
    `You write short outreach emails for ${tenant.name}.`,
    "",
    "The recipient is a property owner who does not know this company. They have",
    "not asked to be contacted. Write like a local operator who noticed something",
    "specific and thought it was worth a note, not like a marketing campaign.",
    "",
    "Reference the specific public record event by name and location. That",
    "specificity is the whole reason the email is worth sending, and a generic",
    "note is worse than none.",
    "",
    "Rules:",
    "Keep the body under 120 words.",
    "Open with the reason you are writing, not a greeting about the weather.",
    "Do not use em dashes or en dashes. Use periods, commas, and colons.",
    "Write full sentences. No bullet points, no headers.",
    "No hype adjectives, no urgency, no scarcity, no exclamation marks.",
    "Do not claim to know anything the record does not say.",
    "Do not promise a price, a timeline, or an outcome.",
    "Close by asking whether they would like to talk. Never assume the sale.",
    "Write the body only. The signature, address, and unsubscribe line are",
    "appended afterwards, so do not write them yourself.",
  ];

  if (tenant.voiceSample) {
    lines.push(
      "",
      "Match the tone of this writing from the sender. Match the register and",
      "rhythm, do not reuse its sentences:",
      "",
      tenant.voiceSample,
    );
  }

  return lines.join("\n");
}

function userPrompt(
  tenant: DraftTenant,
  event: PropertyEvent,
  recipient: DraftRecipient,
  now: Date,
): string {
  return [
    `Recipient: ${recipient.name ?? "owner name not known"}`,
    `Property: ${eventTitle(event)}`,
    `Location: ${eventPlace(event)}`,
    `Public record: ${typeLabel(event.type)}`,
    `Context: ${whyLine(event, now)}`,
    `The sender describes what they surface as a "${tenant.leadNoun}".`,
    "",
    "Write the subject and body.",
  ].join("\n");
}

/**
 * Assembles the parts a human must not be able to omit.
 *
 * BUILD_SPEC section 6 requires CAN-SPAM identity and an unsubscribe line on
 * every outreach email. Appending them here rather than asking the model for
 * them means no prompt change and no refusal can produce a draft without them.
 */
export function assembleBody(tenant: DraftTenant, draft: EmailDraft): string {
  const parts = [draft.body];

  if (tenant.signature) parts.push("", tenant.signature);
  parts.push("", tenant.name, tenant.postalAddress as string);
  if (tenant.complianceFooter) parts.push("", tenant.complianceFooter);

  parts.push(
    "",
    "You received this because a public record for this property was filed in your county.",
    "Reply with the word stop and you will not be contacted again.",
  );

  return parts.join("\n");
}

/**
 * Drafts one email. Never sends.
 *
 * V1 is draft-first everywhere: this returns text for a person to read, edit,
 * and send themselves. There is no send path in this module to misuse.
 */
export async function draftEmail(
  db: SupabaseClient,
  tenant: DraftTenant,
  event: PropertyEvent,
  recipient: DraftRecipient,
  now: Date,
): Promise<EmailDraft> {
  if (!tenant.postalAddress) {
    throw new Error(
      `${tenant.name} has no postal_address set. CAN-SPAM requires a physical address on outreach email, so no draft was generated.`,
    );
  }

  const result = await generateJson<EmailDraft>(db, {
    tenant,
    op: "email_draft",
    system: systemPrompt(tenant),
    prompt: userPrompt(tenant, event, recipient, now),
    schema: SCHEMA,
    maxTokens: 2000,
    now,
    validate,
  });

  return { subject: result.value.subject, body: assembleBody(tenant, result.value) };
}
