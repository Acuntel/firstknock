import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPreset } from "../scoring/presets";
import { log } from "../lib/log";
import { composeDigest } from "./compose";
import { deliver, type DeliveryResult } from "./deliver";
import {
  lastDigestDate,
  loadTenants,
  loadTopLeads,
  recordDigest,
  type DeliverableTenant,
} from "./queries";
import { digestDue } from "./schedule";

export interface DigestOutcome {
  tenant: string;
  due: boolean;
  reason: string;
  forDate: string;
  leadCount: number;
  results: DeliveryResult[];
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3100";
}

function scheduleConfig(tenant: DeliverableTenant) {
  return {
    digestHour: tenant.digest_hour,
    digestMinute: tenant.digest_minute,
    digestTimezone: tenant.digest_timezone,
    digestCadence: tenant.digest_cadence,
    digestPausedUntil: tenant.digest_paused_until
      ? new Date(tenant.digest_paused_until)
      : null,
  };
}

/**
 * Sends the digest to every tenant that is due one right now.
 *
 * Called on a cron far more often than any tenant's digest hour. The schedule
 * decision and the digests table between them make that safe: a tenant is due at
 * most once per local day, and the row written afterwards is what stops the next
 * cycle ten minutes later from sending it again.
 */
export async function runDigests(
  client: SupabaseClient,
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<DigestOutcome[]> {
  const tenants = await loadTenants(client);
  const outcomes: DigestOutcome[] = [];

  for (const tenant of tenants) {
    const lastSent = await lastDigestDate(client, tenant.id);
    const decision = digestDue(scheduleConfig(tenant), now, lastSent);

    if (!decision.due) {
      outcomes.push({
        tenant: tenant.name,
        due: false,
        reason: decision.reason,
        forDate: decision.forDate,
        leadCount: 0,
        results: [],
      });
      continue;
    }

    const preset = loadPreset(tenant.vertical_preset_id);
    const leads = await loadTopLeads(client, tenant.id, preset.digest.topN);

    const content = composeDigest({
      tenantName: tenant.name,
      counties: tenant.counties,
      leadNoun: preset.digest.leadNoun,
      subjectTemplate: preset.digest.subject,
      leads,
      appUrl: appUrl(),
      tenantKey: tenant.fixture_key ?? tenant.id,
      now,
    });

    const results = await deliver(
      {
        tenantName: tenant.name,
        channels: tenant.digest_channels,
        telegramChatId: tenant.telegram_chat_id,
        digestEmail: tenant.digest_email,
        complianceFooter: tenant.compliance_footer,
      },
      content,
      options,
    );

    if (!options.dryRun) {
      const delivered = results.filter((r) => r.status === "sent").map((r) => r.channel);
      await recordDigest(
        client,
        tenant.id,
        decision.forDate,
        leads.map((lead) => lead.id),
        delivered,
      );
    }

    outcomes.push({
      tenant: tenant.name,
      due: true,
      reason: decision.reason,
      forDate: decision.forDate,
      leadCount: leads.length,
      results,
    });

    log.info("digest processed", {
      tenant: tenant.name,
      forDate: decision.forDate,
      leads: leads.length,
      results: results.map((r) => `${r.channel}:${r.status}`),
    });
  }

  return outcomes;
}
