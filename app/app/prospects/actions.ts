"use server";

import { revalidatePath } from "next/cache";
import { isOperator, operatorClient } from "@/lib/operator";
import { market as findMarket, segment as findSegment } from "@firstknock/worker/prospect/buyers";
import { importSites } from "@firstknock/worker/prospect/import";
import { parseUrls } from "@/lib/parse-urls";
import { appendDraft, mailboxCredentials } from "@firstknock/worker/prospect/mail-draft";
import { segmentStats } from "@firstknock/worker/prospect/market-stats";
import { assemblePitch, draftPitch } from "@firstknock/worker/prospect/pitch";
import { draftableProspects, markDrafted, suppress } from "@firstknock/worker/prospect/store";

export interface DraftResult {
  drafted: number;
  skipped: Array<{ company: string; reason: string }>;
  error: string | null;
}

function sender() {
  const name = process.env.PROSPECT_SENDER_NAME;
  const email = process.env.MAIL_USER ?? process.env.GMAIL_USER;
  const postalAddress = process.env.PROSPECT_POSTAL_ADDRESS;
  if (!name || !email || !postalAddress) return null;
  return { name, email, postalAddress };
}

/**
 * Writes drafts for the next few prospects, from a button.
 *
 * Still drafts, never sends, and that is the point rather than a limitation.
 * The button does the tedious part, the reading and the sending stay with a
 * human, so a bad generation costs a deleted draft instead of a burned sending
 * domain.
 */
export async function draftEmails(count: number): Promise<DraftResult> {
  if (!(await isOperator())) {
    return { drafted: 0, skipped: [], error: "You are not signed in as an operator." };
  }

  const credentials = mailboxCredentials();
  if (!credentials) {
    return {
      drafted: 0,
      skipped: [],
      error: "No mailbox configured. Set MAIL_USER and MAIL_APP_PASSWORD.",
    };
  }

  const from = sender();
  if (!from) {
    return {
      drafted: 0,
      skipped: [],
      error:
        "Set PROSPECT_SENDER_NAME and PROSPECT_POSTAL_ADDRESS. Commercial email needs a real postal address.",
    };
  }

  const client = operatorClient();
  const now = new Date();
  const prospects = await draftableProspects(client, count);

  if (prospects.length === 0) {
    return { drafted: 0, skipped: [], error: "Nothing left to draft. Import more prospects first." };
  }

  const { data: tenantRow } = await client.from("tenants").select("id, plan").limit(1).single();
  const tenant = { id: String(tenantRow?.id), plan: String(tenantRow?.plan ?? "solo") };

  let drafted = 0;
  const skipped: DraftResult["skipped"] = [];

  for (const prospect of prospects) {
    if (!prospect.email || !prospect.fips) {
      skipped.push({ company: prospect.company, reason: "no email or market" });
      continue;
    }

    try {
      const buyer = findSegment(prospect.segment);
      const stats = await segmentStats(client, prospect.fips, buyer, now);
      if (stats.total === 0) {
        skipped.push({ company: prospect.company, reason: "nothing on file for their county" });
        continue;
      }

      const opening = await draftPitch(client, tenant, prospect, stats, buyer, now);
      const body = assemblePitch(prospect, stats, opening, from);

      await appendDraft(
        credentials,
        {
          to: prospect.email,
          subject: opening.subject,
          body,
          fromName: from.name,
          fromEmail: from.email,
        },
        now,
      );

      await markDrafted(client, prospect.id, now);
      drafted += 1;
    } catch (error) {
      // One prospect failing is not the run failing, and the reason is shown
      // rather than swallowed, so a repeated failure is visible.
      skipped.push({
        company: prospect.company,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  revalidatePath("/prospects");
  return { drafted, skipped, error: null };
}

/** Takes someone out of every future campaign, permanently. */
export async function suppressProspect(email: string): Promise<void> {
  if (!(await isOperator())) return;
  await suppress(operatorClient(), email, "suppressed from the app", new Date());
  revalidatePath("/prospects");
}

export interface ImportResult {
  outcomes: Array<{ url: string; status: string; company?: string; email?: string }>;
  error: string | null;
  /** Sites the paste contained beyond the batch cap, so nothing vanishes silently. */
  notAttempted: number;
}

/** How many sites one click will work through. */
const IMPORT_BATCH = 12;


/**
 * Reads each site, verifies what it finds, and stores anything contactable.
 *
 * Slow by nature: every site is several page fetches and a DNS lookup, done one
 * at a time because these are small business servers. A dozen takes a couple of
 * minutes, which is why the batch is capped and the overflow is reported rather
 * than dropped.
 */
export async function importProspects(
  pasted: string,
  fips: string,
  segmentId: string,
): Promise<ImportResult> {
  if (!(await isOperator())) {
    return { outcomes: [], error: "You are not signed in as an operator.", notAttempted: 0 };
  }

  let where;
  try {
    where = findMarket(fips);
    findSegment(segmentId);
  } catch (error) {
    return {
      outcomes: [],
      error: error instanceof Error ? error.message : String(error),
      notAttempted: 0,
    };
  }

  const urls = parseUrls(pasted);
  if (urls.length === 0) {
    return { outcomes: [], error: "No web addresses found in that.", notAttempted: 0 };
  }

  const batch = urls.slice(0, IMPORT_BATCH);
  const outcomes = await importSites(
    operatorClient(),
    batch.map((url) => ({
      url,
      fips,
      city: where.city,
      state: where.state,
      segment: segmentId,
    })),
  );

  revalidatePath("/prospects");
  return {
    outcomes,
    error: null,
    notAttempted: urls.length - batch.length,
  };
}
