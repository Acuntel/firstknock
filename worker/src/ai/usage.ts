import type { SupabaseClient } from "@supabase/supabase-js";
import { costOf, pricingFor, tokensOf, type TokenUsage } from "./pricing";

/**
 * Monthly AI spend ceiling per plan, in dollars.
 *
 * These are a starting point, not a decision: they are roughly five percent of
 * each tier's price, which keeps AI from eating the margin without cutting a
 * normal month short. Brady owns the real numbers, and it is question 12 in
 * docs/OPEN_QUESTIONS.md.
 */
export const MONTHLY_CAP_DOLLARS: Record<string, number> = {
  solo: 7.5,
  pro: 15,
  team: 25,
};

export class UsageCapReached extends Error {
  constructor(
    readonly tenantId: string,
    readonly spent: number,
    readonly cap: number,
  ) {
    super(
      `This tenant has used $${spent.toFixed(2)} of its $${cap.toFixed(2)} monthly AI allowance.`,
    );
    this.name = "UsageCapReached";
  }
}

function startOfMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * What a tenant has committed this month.
 *
 * Counts reserved rows as well as settled ones. A job that crashed between the
 * call and the settle leaves a reservation behind, and treating that as free
 * would let a crash loop spend without limit.
 */
export async function monthlySpend(
  client: SupabaseClient,
  tenantId: string,
  now: Date,
): Promise<number> {
  const { data, error } = await client
    .from("usage_ledger")
    .select("dollars")
    .eq("tenant_id", tenantId)
    .gte("reserved_at", startOfMonth(now));

  if (error) throw new Error(`Failed to read usage: ${error.message}`);
  return (data ?? []).reduce((total, row) => total + Number(row.dollars), 0);
}

/**
 * Claims budget before the call is made.
 *
 * Reserve first, spend second, settle third. The alternative, writing the
 * ledger after the response arrives, means a tenant at their cap can still
 * issue unlimited concurrent calls: every one of them reads a spend figure that
 * does not yet include the others.
 */
export async function reserve(
  client: SupabaseClient,
  tenant: { id: string; plan: string },
  op: string,
  estimateDollars: number,
  now: Date,
): Promise<string> {
  const cap = MONTHLY_CAP_DOLLARS[tenant.plan];
  if (cap === undefined) {
    throw new Error(`No monthly AI cap configured for plan "${tenant.plan}".`);
  }

  const spent = await monthlySpend(client, tenant.id, now);
  if (spent + estimateDollars > cap) {
    throw new UsageCapReached(tenant.id, spent, cap);
  }

  const { data, error } = await client
    .from("usage_ledger")
    .insert({
      tenant_id: tenant.id,
      op,
      tokens: 0,
      dollars: estimateDollars,
      reserved_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to reserve usage: ${error.message}`);
  return String(data.id);
}

/** Replaces the estimate with what the call actually cost. */
export async function settle(
  client: SupabaseClient,
  reservationId: string,
  model: string,
  usage: TokenUsage,
  now: Date,
): Promise<number> {
  const dollars = costOf(usage, pricingFor(model, now));

  const { error } = await client
    .from("usage_ledger")
    .update({
      tokens: tokensOf(usage),
      dollars,
      settled_at: now.toISOString(),
    })
    .eq("id", reservationId);

  if (error) throw new Error(`Failed to settle usage: ${error.message}`);
  return dollars;
}

/**
 * Releases a reservation for a call that never happened.
 *
 * Distinct from settling at zero: a released row is deleted, so it stops
 * counting against the cap entirely. Only safe when the request definitely did
 * not reach Anthropic.
 */
export async function release(
  client: SupabaseClient,
  reservationId: string,
): Promise<void> {
  const { error } = await client.from("usage_ledger").delete().eq("id", reservationId);
  if (error) throw new Error(`Failed to release usage reservation: ${error.message}`);
}
