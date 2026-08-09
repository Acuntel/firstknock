import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { DESIGN_PARTNERS, type DesignPartnerTenant } from "./tenants";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

function toRow(tenant: DesignPartnerTenant) {
  return {
    name: tenant.name,
    plan: tenant.plan,
    vertical_preset_id: tenant.verticalPresetId,
    score_weights: tenant.weights,
    counties: tenant.counties,
    excluded_towns: tenant.excludedTowns,
    service_area_lat: tenant.serviceArea.lat,
    service_area_lng: tenant.serviceArea.lng,
    service_area_radius_miles: tenant.serviceArea.radiusMiles,
    digest_hour: tenant.digestHour,
    digest_minute: tenant.digestMinute,
    digest_cadence: tenant.digestCadence,
    digest_channels: tenant.digestChannels,
    hot_ping_threshold: tenant.hotPingThreshold,
    compliance_footer: tenant.complianceFooter,
    // Stable per tenant so re-seeding does not invalidate a Telegram connect
    // link someone already followed. Phase 3 consumes this in /start <code>.
    telegram_connect_code: `fk-${tenant.key}`,
  };
}

/**
 * Creates or refreshes the five design partner tenants.
 *
 * Safe to re-run. It matches on telegram_connect_code, which is derived from the
 * fixture key, so a second run updates the same rows rather than creating a
 * parallel set. Weights are overwritten on purpose: while V1 is being built the
 * fixtures in tenants.ts are the source of truth, not hand edits in the
 * database. That stops being true the moment a real partner tunes their own
 * weights, which is a Phase 6 onboarding concern.
 */
async function main(): Promise<void> {
  const client = createWorkerClient();

  for (const tenant of DESIGN_PARTNERS) {
    const code = `fk-${tenant.key}`;
    const { data: existing, error: readError } = await client
      .from("tenants")
      .select("id")
      .eq("telegram_connect_code", code)
      .maybeSingle();

    if (readError) throw new Error(`Failed to read tenants: ${readError.message}`);

    if (existing) {
      const { error } = await client
        .from("tenants")
        .update(toRow(tenant))
        .eq("id", existing.id);
      if (error) throw new Error(`Failed to update ${tenant.name}: ${error.message}`);
      log.info("tenant synced", { tenant: tenant.name, counties: tenant.counties });
      continue;
    }

    const { error } = await client.from("tenants").insert(toRow(tenant));
    if (error) throw new Error(`Failed to insert ${tenant.name}: ${error.message}`);
    log.info("tenant created", {
      tenant: tenant.name,
      preset: tenant.verticalPresetId,
      counties: tenant.counties,
    });
  }

  log.info("tenant seed complete", { tenants: DESIGN_PARTNERS.length });
}

main().catch((error: unknown) => {
  log.error("tenant seed aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
