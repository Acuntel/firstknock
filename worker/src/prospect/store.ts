import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prospect } from "./pitch";

export interface ProspectRow extends Prospect {
  fips: string | null;
  emailConfidence: string;
  status: string;
  doNotContact: boolean;
}

function toProspect(row: Record<string, unknown>): ProspectRow {
  return {
    id: String(row.id),
    company: String(row.company),
    website: (row.website as string) ?? null,
    city: (row.city as string) ?? null,
    fips: (row.fips as string) ?? null,
    personName: (row.person_name as string) ?? null,
    personRole: (row.person_role as string) ?? null,
    email: (row.email as string) ?? null,
    emailConfidence: String(row.email_confidence ?? "guessed"),
    status: String(row.status ?? "new"),
    doNotContact: Boolean(row.do_not_contact),
  };
}

/**
 * Prospects that may be written to right now.
 *
 * Four conditions, and all of them have to hold. A verified address, because a
 * guess that bounces costs the sending domain more than the lead is worth. A
 * named person, because addressing a generic inbox by a researched name reads
 * worse than not writing at all. Not already drafted, because one address is
 * only ever written to once in a campaign. Not suppressed, because someone who
 * said no said it permanently.
 */
export async function draftableProspects(
  client: SupabaseClient,
  limit: number,
  fips?: string,
): Promise<ProspectRow[]> {
  let query = client
    .from("prospects")
    .select("*")
    .eq("email_confidence", "verified")
    .eq("do_not_contact", false)
    .eq("status", "new")
    .not("email", "is", null)
    .not("person_name", "is", null)
    .limit(limit);

  if (fips) query = query.eq("fips", fips);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load prospects: ${error.message}`);
  return (data ?? []).map((row) => toProspect(row as Record<string, unknown>));
}

export async function markDrafted(
  client: SupabaseClient,
  id: string,
  now: Date,
): Promise<void> {
  const { error } = await client
    .from("prospects")
    .update({ status: "drafted", drafted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to mark drafted: ${error.message}`);
}

/**
 * Takes someone out of every future campaign.
 *
 * Permanent by design and it applies to the address rather than the row, so
 * re-importing the same company from a later discovery run cannot resurrect
 * them. A reply of "no" is the only opt out this system offers, so it has to
 * actually work.
 */
export async function suppress(
  client: SupabaseClient,
  email: string,
  reason: string,
  now: Date,
): Promise<void> {
  const { error } = await client
    .from("prospects")
    .update({
      do_not_contact: true,
      suppressed_reason: reason,
      status: "suppressed",
      updated_at: now.toISOString(),
    })
    .ilike("email", email);
  if (error) throw new Error(`Failed to suppress ${email}: ${error.message}`);
}

export interface ProspectInput {
  company: string;
  website?: string;
  city?: string;
  state?: string;
  fips?: string;
  personName?: string;
  personRole?: string;
  email?: string;
  emailConfidence?: string;
}

/**
 * Adds prospects, ignoring any address already known.
 *
 * The unique index on the address does the deduplication, so a second discovery
 * run over the same city is a no-op rather than a source of duplicate emails to
 * the same person.
 */
export async function upsertProspects(
  client: SupabaseClient,
  inputs: ProspectInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;

  const rows = inputs.map((input) => ({
    company: input.company,
    website: input.website ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    fips: input.fips ?? null,
    person_name: input.personName ?? null,
    person_role: input.personRole ?? null,
    email: input.email?.toLowerCase() ?? null,
    email_confidence: input.emailConfidence ?? "guessed",
  }));

  const { data, error } = await client
    .from("prospects")
    .upsert(rows, { onConflict: "email", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Failed to add prospects: ${error.message}`);
  return (data ?? []).length;
}
