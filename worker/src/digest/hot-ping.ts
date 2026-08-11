import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPreset } from "../scoring/presets";
import { log } from "../lib/log";
import { composeHotPing } from "./compose";
import { deliver, type DeliveryResult } from "./deliver";
import {
  loadPendingHotPings,
  loadTenants,
  markHotPinged,
  retireStaleHotPings,
} from "./queries";
import { appUrl } from "./send";

export interface HotPingOutcome {
  tenant: string;
  pinged: number;
  skipped: string | null;
  results: DeliveryResult[];
}

/**
 * Fires a ping for every lead that has crossed the tenant's threshold and has
 * not pinged before.
 *
 * Runs on the same cycle as ingest, which is what "within one worker cycle"
 * means in the acceptance criteria. Two things keep it from becoming a nuisance:
 * hot_pinged_at is stamped after a successful send so a lead pings once, and a
 * paused tenant is skipped entirely rather than having pings queue up behind the
 * pause and arrive in a burst when it lifts.
 */
export async function runHotPings(
  client: SupabaseClient,
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<HotPingOutcome[]> {
  const tenants = await loadTenants(client);
  const outcomes: HotPingOutcome[] = [];

  for (const tenant of tenants) {
    const threshold = tenant.hot_ping_threshold;
    if (threshold === null) {
      outcomes.push({
        tenant: tenant.name,
        pinged: 0,
        skipped: "No hot ping threshold set.",
        results: [],
      });
      continue;
    }

    const pausedUntil = tenant.digest_paused_until
      ? new Date(tenant.digest_paused_until)
      : null;
    if (pausedUntil && pausedUntil.getTime() > now.getTime()) {
      outcomes.push({
        tenant: tenant.name,
        pinged: 0,
        skipped: `Paused until ${pausedUntil.toISOString().slice(0, 10)}.`,
        results: [],
      });
      continue;
    }

    // Anything above threshold but too old to be "hot" is retired quietly. It
    // still reaches the operator in the digest, which is the right channel for
    // something that happened last month.
    const retired = await retireStaleHotPings(client, tenant.id, threshold, now);
    if (retired > 0) {
      log.info("stale hot pings retired to the digest", { tenant: tenant.name, retired });
    }

    const pending = await loadPendingHotPings(client, tenant.id, threshold, now);
    if (pending.length === 0) {
      outcomes.push({
        tenant: tenant.name,
        pinged: 0,
        skipped: `Nothing new at or above ${threshold}.`,
        results: [],
      });
      continue;
    }

    const preset = loadPreset(tenant.vertical_preset_id);
    const results: DeliveryResult[] = [];
    const sentIds: string[] = [];

    for (const lead of pending) {
      const ping = composeHotPing(
        {
          tenantName: tenant.name,
          counties: tenant.counties,
          leadNoun: preset.digest.leadNoun,
          subjectTemplate: preset.digest.subject,
          leads: [lead],
          appUrl: appUrl(),
          tenantKey: tenant.fixture_key ?? tenant.id,
          now,
        },
        lead,
        threshold,
      );

      const leadResults = await deliver(
        {
          tenantName: tenant.name,
          channels: tenant.digest_channels,
          telegramChatId: tenant.telegram_chat_id,
          digestEmail: tenant.digest_email,
          complianceFooter: tenant.compliance_footer,
        },
        {
          subject: ping.subject,
          telegram: [ping.telegram],
          emailText: ping.emailText,
          emailHtml: ping.emailHtml,
        },
        options,
      );

      results.push(...leadResults);

      // Marked only when something actually left the building. A lead whose
      // channels all failed stays pending and pings on the next cycle rather
      // than being silently written off.
      if (!options.dryRun && leadResults.some((r) => r.status === "sent")) {
        sentIds.push(lead.id);
      }
    }

    await markHotPinged(client, sentIds);

    outcomes.push({
      tenant: tenant.name,
      pinged: options.dryRun ? pending.length : sentIds.length,
      skipped: null,
      results,
    });

    log.info("hot pings processed", {
      tenant: tenant.name,
      threshold,
      candidates: pending.length,
      sent: sentIds.length,
    });
  }

  return outcomes;
}
