/**
 * Claude pricing, in dollars per million tokens.
 *
 * Kept here rather than inline so the usage_ledger records a real dollar figure
 * instead of a token count someone has to price later. BUILD_SPEC section 8
 * caps AI spend per tenant per month, and a cap enforced against tokens rather
 * than dollars silently changes meaning whenever pricing does.
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cache reads are about a tenth of input. */
  cacheReadPerMillion: number;
  /** Cache writes carry a premium over plain input. */
  cacheWritePerMillion: number;
}

/**
 * Claude Sonnet 5 launched with introductory pricing that ends after
 * 2026-08-31. Both rates are encoded rather than one, because a ledger written
 * at intro rates and read back after the change would otherwise misreport what
 * a tenant actually cost.
 */
const SONNET_5_INTRO_ENDS = Date.parse("2026-09-01T00:00:00Z");

const SONNET_5_INTRO: ModelPricing = {
  inputPerMillion: 2.0,
  outputPerMillion: 10.0,
  cacheReadPerMillion: 0.2,
  cacheWritePerMillion: 2.5,
};

const SONNET_5_STANDARD: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
  cacheReadPerMillion: 0.3,
  cacheWritePerMillion: 3.75,
};

export function pricingFor(model: string, at: Date): ModelPricing {
  if (model === "claude-sonnet-5") {
    return at.getTime() < SONNET_5_INTRO_ENDS ? SONNET_5_INTRO : SONNET_5_STANDARD;
  }
  throw new Error(
    `No pricing recorded for ${model}. Add it to worker/src/ai/pricing.ts before using it.`,
  );
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Dollars for one call, rounded to the ledger's four decimal places. */
export function costOf(usage: TokenUsage, pricing: ModelPricing): number {
  const dollars =
    (usage.inputTokens * pricing.inputPerMillion +
      usage.outputTokens * pricing.outputPerMillion +
      (usage.cacheReadTokens ?? 0) * pricing.cacheReadPerMillion +
      (usage.cacheWriteTokens ?? 0) * pricing.cacheWritePerMillion) /
    1_000_000;

  return Math.round(dollars * 10_000) / 10_000;
}

/** Total tokens billed, for the ledger's tokens column. */
export function tokensOf(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}
