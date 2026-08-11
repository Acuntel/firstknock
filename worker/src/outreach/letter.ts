import { eventTitle, typeLabel } from "../format";
import type { PropertyEvent } from "../types";

/**
 * Per vertical letter templates, with the cost of sending one.
 *
 * Cost is in cents and is an estimate of Lob's price for a standard letter at
 * the time of writing. It is shown to the operator before they confirm, which
 * BUILD_SPEC section 6 requires, and it is stored on the outreach row so a
 * later invoice can be reconciled against what was quoted.
 */
export interface LetterTemplate {
  id: string;
  label: string;
  /** Lob standard letter, colour, first class. */
  costCents: number;
  /** True when the tenant's compliance footer must appear on the letter. */
  requiresComplianceFooter: boolean;
  body: (input: LetterInput) => string;
}

export interface LetterInput {
  tenantName: string;
  ownerName: string | null;
  event: PropertyEvent;
  now: Date;
}

const STANDARD_LETTER_CENTS = 108;

function greeting(input: LetterInput): string {
  return input.ownerName ? `Dear ${input.ownerName},` : "Hello,";
}

export const LETTER_TEMPLATES: Record<string, LetterTemplate> = {
  restoration: {
    id: "restoration_letter_v1",
    label: "Restoration outreach",
    costCents: STANDARD_LETTER_CENTS,
    requiresComplianceFooter: false,
    body: (input) =>
      [
        greeting(input),
        "",
        `A ${typeLabel(input.event.type)} was filed for ${eventTitle(input.event)}, which is how this letter found you.`,
        "",
        `${input.tenantName} handles repair and restoration work in your area. If you are dealing with damage at this property, we can walk the site and tell you what the work involves before you commit to anything.`,
        "",
        "If this does not apply to you, please ignore this letter.",
      ].join("\n"),
  },

  investors: {
    id: "investors_letter_v1",
    label: "Investor outreach",
    costCents: STANDARD_LETTER_CENTS,
    requiresComplianceFooter: false,
    body: (input) =>
      [
        greeting(input),
        "",
        `A ${typeLabel(input.event.type)} was filed for ${eventTitle(input.event)}. Public records are how this letter found you, and nobody gave us your name.`,
        "",
        `${input.tenantName} buys property in this area. If selling is something you are considering, we can make an offer and close on your timeline. If it is not, no reply is needed.`,
      ].join("\n"),
  },

  roofing: {
    id: "roofing_letter_v1",
    label: "Roofing outreach",
    costCents: STANDARD_LETTER_CENTS,
    requiresComplianceFooter: false,
    body: (input) =>
      [
        greeting(input),
        "",
        `A ${typeLabel(input.event.type)} was filed for ${eventTitle(input.event)}.`,
        "",
        `${input.tenantName} does roofing work nearby. If you want a second opinion on the condition of your roof, we will look at it and tell you honestly whether it needs anything.`,
      ].join("\n"),
  },

  lawfirms: {
    id: "lawfirms_letter_v1",
    label: "Law firm intake",
    costCents: STANDARD_LETTER_CENTS,
    // REAL Law Group's bar advertising disclaimer is not optional, and the
    // builder refuses to produce this template without it.
    requiresComplianceFooter: true,
    body: (input) =>
      [
        greeting(input),
        "",
        `A ${typeLabel(input.event.type)} was filed regarding ${eventTitle(input.event)}. This is a matter of public record.`,
        "",
        `${input.tenantName} represents property owners in matters of this kind. If you would like to discuss your options, you can call us. You are under no obligation, and you may already have counsel.`,
      ].join("\n"),
  },
};

export interface BuiltLetter {
  templateId: string;
  body: string;
  costCents: number;
  /** Shown before the operator confirms. */
  costLabel: string;
}

/**
 * Renders a letter and prices it. Sends nothing.
 *
 * Cost is returned rather than logged so the caller has to put it in front of a
 * person: the spec requires the price to be visible before confirmation, and a
 * function that both prices and sends would make that easy to skip.
 */
export function buildLetter(
  presetId: string,
  input: LetterInput,
  complianceFooter: string | null,
): BuiltLetter {
  const template = LETTER_TEMPLATES[presetId];
  if (!template) {
    throw new Error(`No letter template for the "${presetId}" vertical.`);
  }

  if (template.requiresComplianceFooter && !complianceFooter?.trim()) {
    throw new Error(
      `The ${template.label} template requires a compliance footer and this tenant has none set. No letter was built.`,
    );
  }

  const parts = [template.body(input)];
  if (complianceFooter?.trim()) parts.push("", complianceFooter.trim());

  return {
    templateId: template.id,
    body: parts.join("\n"),
    costCents: template.costCents,
    costLabel: `$${(template.costCents / 100).toFixed(2)} to print and mail`,
  };
}
