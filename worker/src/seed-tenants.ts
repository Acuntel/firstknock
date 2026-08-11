import { config as loadEnv } from "dotenv";
import { createWorkerClient } from "./db";
import { ALL_TENANTS, type DesignPartnerTenant } from "./tenants";
import { log } from "./lib/log";

loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

function toRow(tenant: DesignPartnerTenant) {
  return {
    fixture_key: tenant.key,
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
    // Routes every seeded tenant to one inbox while testing, which is the only
    // way to exercise the email path without holding real partner addresses in
    // this repo.
    digest_email: process.env.DIGEST_TEST_EMAIL ?? tenant.digestEmail,
    hot_ping_threshold: tenant.hotPingThreshold,
    compliance_footer: tenant.complianceFooter,
  };
}

/**
 * Creates or refreshes the five design partner tenants.
 *
 * Safe to re-run. It matches on fixture_key, so a second run updates the same
 * rows rather than creating a parallel set. Weights are overwritten on purpose:
 * while V1 is being built the fixtures in tenants.ts are the source of truth,
 * not hand edits in the database. That stops being true the moment a real
 * partner tunes their own weights, which is a Phase 6 onboarding concern.
 *
 * Telegram connect codes are deliberately not seeded. They are short lived and
 * single use, minted from the settings page when someone is actually about to
 * connect a chat.
 */
async function main(): Promise<void> {
  const client = createWorkerClient();

  for (const tenant of ALL_TENANTS) {
    const { data: existing, error: readError } = await client
      .from("tenants")
      .select("id")
      .eq("fixture_key", tenant.key)
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

  log.info("tenant seed complete", { tenants: ALL_TENANTS.length });
}

main().catch((error: unknown) => {
  log.error("tenant seed aborted", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
