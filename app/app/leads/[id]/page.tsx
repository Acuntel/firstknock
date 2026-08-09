import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { ScoreBadge } from "@/components/score-badge";
import { getLead, isFixtureMode } from "@/lib/data";
import { eventPlace, eventTitle, typeLabel } from "@/lib/format";
import { href, resolveTenant } from "@/lib/tenant";
import type { ScoreComponent } from "@firstknock/worker/scoring/types";

const COMPONENT_LABELS: Record<string, string> = {
  severity: "Event severity",
  freshness: "Freshness",
  propertyClass: "Property class fit",
  distance: "Distance from service area",
  foreclosureStage: "Foreclosure stage",
  absenteeOwner: "Absentee owner",
  valueGap: "Value gap",
};

function componentEffect(component: ScoreComponent): string {
  if (component.kind === "base") return `${component.value} points`;
  if (component.kind === "bonus") return `plus ${component.value.toFixed(1)} points`;
  return `${component.value.toFixed(2)} multiplier`;
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const [{ id }, { tenant: key }] = await Promise.all([params, searchParams]);
  const tenant = resolveTenant(key);
  const lead = await getLead(tenant, id);

  if (!lead) notFound();

  const entries = Object.entries(lead.breakdown.components);

  return (
    <Shell tenant={tenant} current="/today" fixtureMode={isFixtureMode()}>
      <Link href={href("/today", tenant.key)} className="text-sm text-brand">
        Back to today
      </Link>

      <div className="mt-4 flex items-start gap-4">
        <ScoreBadge score={lead.score} threshold={tenant.hotPingThreshold} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{eventTitle(lead.event)}</h1>
          <p className="text-sm text-muted">
            {typeLabel(lead.event.type)}
            {eventPlace(lead.event) ? `, ${eventPlace(lead.event)}` : ""}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-wide text-muted">
          Why this scored {lead.score}
        </h2>

        {/* BUILD_SPEC section 4 requires a stored breakdown so the UI can
            explain every score. Components that had no data are shown as such
            rather than hidden, so an unexplained score is impossible. */}
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {entries.map(([name, component]) => (
            <li key={name} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
              <span className="w-52 shrink-0 text-sm font-medium">
                {COMPONENT_LABELS[name] ?? name}
              </span>
              <span
                className={`w-40 shrink-0 text-sm tabular-nums ${
                  component.available ? "text-ink" : "text-idle"
                }`}
              >
                {componentEffect(component)}
              </span>
              {/* The explanation already says when a term had nothing to work
                  with, so the greyed value carries that on its own. */}
              <span className="min-w-0 flex-1 text-sm text-muted">
                {component.explanation}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-muted">
          Scored at {lead.breakdown.scoredAt} against the {lead.breakdown.presetId}{" "}
          preset as tuned for {tenant.name}. The same event and the same weights
          always produce this number.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-wide text-muted">Record</h2>
        <dl className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {[
            ["County FIPS", lead.event.fips],
            ["Parcel", lead.event.property.parcelPin ?? "not stated"],
            ["Use type", lead.event.property.category ?? "not stated"],
            ["Class code", lead.event.property.class ?? "not stated"],
            ["Occurred", lead.event.occurredAt.toISOString().slice(0, 10)],
            [
              "Parties",
              lead.event.parties.length > 0
                ? lead.event.parties.map((p) => `${p.role}: ${p.name}`).join("; ")
                : "none on this record",
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-4 px-4 py-2.5">
              <dt className="w-52 shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 flex-1 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Shell>
  );
}
