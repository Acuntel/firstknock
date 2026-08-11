import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "../lib/log";
import { costOf, pricingFor } from "./pricing";
import { release, reserve, settle } from "./usage";

/**
 * The model of record, from ben/AGENT_DIRECTIVE.md. Changing it is a spec
 * change, not a config tweak: pricing, caps, and the request shape all follow
 * from it.
 */
export const MODEL = "claude-sonnet-5";

let anthropic: Anthropic | null = null;

/**
 * The only place in the codebase that talks to Anthropic.
 *
 * BUILD_SPEC section 4 and the agent directive both require this: one
 * server-side module, keys never client side, every call metered per tenant.
 * The Next.js app imports nothing from here.
 */
function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. It is server side only.");
  }
  anthropic ??= new Anthropic({ apiKey });
  return anthropic;
}

export interface MeteredTenant {
  id: string;
  plan: string;
}

export interface JsonRequest<T> {
  tenant: MeteredTenant;
  /** Recorded in usage_ledger.op so spend can be attributed to a feature. */
  op: string;
  system: string;
  prompt: string;
  /** JSON Schema the response is constrained to. */
  schema: Record<string, unknown>;
  maxTokens: number;
  now: Date;
  /** Narrows the parsed value. Throwing here fails the call loudly. */
  validate: (value: unknown) => T;
}

export interface JsonResult<T> {
  value: T;
  dollars: number;
  inputTokens: number;
  outputTokens: number;
}

export class ClaudeRefusal extends Error {
  constructor(readonly category: string | null) {
    super(
      `Claude declined this request${category ? ` (${category})` : ""}. Nothing was generated.`,
    );
    this.name = "ClaudeRefusal";
  }
}

/**
 * Conservative pre-call estimate, used only to claim budget.
 *
 * Deliberately pessimistic: it assumes the full output allowance is used. Over
 * reserving briefly is harmless because settle replaces the figure with the
 * real one, whereas under reserving lets a tenant slip past their cap.
 */
function estimateDollars(request: JsonRequest<unknown>, now: Date): number {
  const inputTokens = Math.ceil((request.system.length + request.prompt.length) / 4);
  return costOf(
    { inputTokens, outputTokens: request.maxTokens },
    pricingFor(MODEL, now),
  );
}

/**
 * Generates structured JSON, metered end to end.
 *
 * Structured outputs rather than asking for JSON in the prompt: the response is
 * constrained to the schema, so there is no parse-and-retry loop and no prompt
 * text begging for valid JSON.
 *
 * No sampling parameters are set. Claude Sonnet 5 rejects non-default
 * temperature, top_p, and top_k outright, and steering belongs in the prompt.
 */
export async function generateJson<T>(
  db: SupabaseClient,
  request: JsonRequest<T>,
): Promise<JsonResult<T>> {
  const reservationId = await reserve(
    db,
    request.tenant,
    request.op,
    estimateDollars(request, request.now),
    request.now,
  );

  let response;
  try {
    response = await client().messages.create({
      model: MODEL,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      thinking: { type: "adaptive" },
      output_config: {
        // Drafting from a filled-in brief is not a reasoning heavy task, and
        // every tenant has a hard monthly ceiling. Low effort keeps both the
        // latency and the ledger down.
        effort: "low",
        format: { type: "json_schema", schema: request.schema },
      },
    });
  } catch (error) {
    // The call never reached Anthropic, so the reservation is refunded rather
    // than settled at zero, which would leave a phantom row against the cap.
    await release(db, reservationId);
    throw error;
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const dollars = await settle(db, reservationId, MODEL, usage, request.now);

  // Checked before reading content. A refusal returns a normal 200 with empty
  // or partial content, so indexing straight into content[0] would throw.
  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusal(response.stop_details?.category ?? null);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Response hit the ${request.maxTokens} token ceiling before finishing. Raise maxTokens for ${request.op}.`,
    );
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`Claude returned no text for ${request.op}.`);
  }

  log.info("ai call complete", {
    op: request.op,
    tenant: request.tenant.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    dollars,
  });

  return {
    value: request.validate(JSON.parse(text.text)),
    dollars,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
