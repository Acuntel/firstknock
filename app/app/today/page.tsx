import Link from "next/link";
import { Shell } from "@/components/shell";
import { ScoreBadge } from "@/components/score-badge";
import { getLeads } from "@/lib/data";
import { eventPlace, eventTitle, whyLine } from "@/lib/format";
import { href, resolveTenant } from "@/lib/tenant";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);
  const { leads, suppressed, fixtureMode, error } = await getLeads(tenant);
  const now = new Date();

  const hot = leads.filter((lead) => lead.score >= tenant.hotPingThreshold);

  return (
    <Shell tenant={tenant} current="/today" fixtureMode={fixtureMode}>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-sm text-muted">
          {leads.length} scored {leads.length === 1 ? "lead" : "leads"} across{" "}
          {tenant.counties.length}{" "}
          {tenant.counties.length === 1 ? "county" : "counties"}
          {hot.length > 0
            ? `, ${hot.length} at or above the ${tenant.hotPingThreshold} ping threshold`
            : `, none at the ${tenant.hotPingThreshold} ping threshold`}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-bad-bg bg-bad-bg px-4 py-3 text-sm text-bad">
          Could not read leads: {error}
        </p>
      ) : null}

      {leads.length === 0 && !error ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          Nothing scored above zero for this configuration yet.
        </p>
      ) : null}

      {suppressed > 0 ? (
        <p className="mb-3 text-xs text-muted">
          {suppressed} further {suppressed === 1 ? "event" : "events"} scored zero
          for this vertical and {suppressed === 1 ? "is" : "are"} not shown.
        </p>
      ) : null}

      <ol className="space-y-2">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link
              href={href(`/leads/${lead.id}`, tenant.key)}
              className="flex items-start gap-4 rounded-lg border border-line bg-surface px-4 py-3.5 hover:border-line-strong"
            >
              <ScoreBadge score={lead.score} threshold={tenant.hotPingThreshold} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {eventTitle(lead.event)}
                </span>
                <span className="mt-0.5 block text-sm text-muted">
                  {whyLine(lead.event, now)}
                </span>
                {eventPlace(lead.event) ? (
                  <span className="mt-0.5 block text-xs text-muted">
                    {eventPlace(lead.event)}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Shell>
  );
}
