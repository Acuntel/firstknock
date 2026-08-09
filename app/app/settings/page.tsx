import { Shell } from "@/components/shell";
import { isFixtureMode } from "@/lib/data";
import { resolveTenant } from "@/lib/tenant";
import { loadPreset } from "@firstknock/worker/scoring/presets";
import { countyName } from "@/lib/counties";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="w-56 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);
  const preset = loadPreset(tenant.verticalPresetId);

  const time = `${String(tenant.digestHour).padStart(2, "0")}:${String(
    tenant.digestMinute,
  ).padStart(2, "0")}`;

  // Only the weights this tenant actually changed, so the screen shows the
  // tuning rather than the whole preset repeated back.
  const overrides: Array<[string, string]> = [];
  const base = preset.weights;
  const own = tenant.weights;
  if (own.freshnessHalfLifeHours !== base.freshnessHalfLifeHours) {
    overrides.push([
      "Freshness half life",
      `${own.freshnessHalfLifeHours} hours, preset default is ${base.freshnessHalfLifeHours}`,
    ]);
  }
  if (own.valueGap !== base.valueGap) {
    overrides.push(["Value gap weight", `${own.valueGap}, preset default is ${base.valueGap}`]);
  }
  if ((own.absenteeOwnerBonus ?? 0) !== (base.absenteeOwnerBonus ?? 0)) {
    overrides.push([
      "Absentee owner bonus",
      `${own.absenteeOwnerBonus}, preset default is ${base.absenteeOwnerBonus ?? 0}`,
    ]);
  }
  for (const category of Object.keys(own.propertyClassFit) as Array<
    keyof typeof own.propertyClassFit
  >) {
    const mine = own.propertyClassFit[category];
    const theirs = base.propertyClassFit[category];
    if (mine !== theirs) {
      overrides.push([
        `Class fit, ${category}`,
        `${mine}, preset default is ${theirs}`,
      ]);
    }
  }

  return (
    <Shell tenant={tenant} current="/settings" fixtureMode={isFixtureMode()}>
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>

      <section className="mb-6">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Coverage</h2>
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          <Row label="Plan">{tenant.plan}</Row>
          <Row label="Vertical preset">
            {preset.label} ({preset.id})
          </Row>
          <Row label="Counties">
            {tenant.counties.map(countyName).join(", ")}
          </Row>
          <Row label="Service area">
            {tenant.serviceArea.radiusMiles} mile radius around{" "}
            {tenant.serviceArea.lat.toFixed(3)}, {tenant.serviceArea.lng.toFixed(3)}
          </Row>
          <Row label="Excluded towns">
            {tenant.excludedTowns.length > 0
              ? tenant.excludedTowns.join(", ")
              : "None. Every town in these counties is scored."}
          </Row>
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Delivery</h2>
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          <Row label="Digest">
            {tenant.digestCadence === "weekly_monday" ? "Weekly on Monday" : "Daily"} at{" "}
            {time}
          </Row>
          <Row label="Channels">{tenant.digestChannels.join(" and ")}</Row>
          <Row label="Hot ping threshold">
            {tenant.hotPingThreshold}, preset default is {preset.hotPingDefault}
          </Row>
          <Row label="Leads per digest">{preset.digest.topN}</Row>
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
          Scoring, tuned from the {preset.id} preset
        </h2>
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {overrides.length === 0 ? (
            <Row label="Overrides">
              None. This tenant runs the preset defaults unchanged.
            </Row>
          ) : (
            overrides.map(([label, value]) => (
              <Row key={label} label={label}>
                {value}
              </Row>
            ))
          )}
        </dl>
        <p className="mt-2 text-xs text-muted">
          Weights are copied onto the tenant at onboarding, so later edits to the
          shared preset never change an existing configuration.
        </p>
      </section>

      {tenant.complianceFooter ? (
        <section className="mb-6">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
            Compliance footer
          </h2>
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            {tenant.complianceFooter}
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
          Why this configuration
        </h2>
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
          {tenant.note}
        </p>
      </section>
    </Shell>
  );
}
