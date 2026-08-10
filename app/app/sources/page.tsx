import { Shell } from "@/components/shell";
import { getSources } from "@/lib/sources";
import { resolveTenant } from "@/lib/tenant";
import { allTenants } from "@/lib/tenant";
import { nextDigestTime } from "@firstknock/worker/digest/schedule";

const HEALTH_TONE: Record<string, string> = {
  healthy: "bg-ok-bg text-ok",
  degraded: "bg-warn-bg text-warn",
  failing: "bg-bad-bg text-bad",
  unknown: "bg-idle-bg text-idle",
};

/**
 * Turns the cron a source polls on into something readable. Only the daily shape
 * every adapter currently uses is translated; anything else shows the raw
 * expression rather than being described wrongly.
 */
function cadenceLabel(cron: string): string {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(cron.trim());
  if (!match) return `on ${cron}`;
  const [, minute, hour] = match;
  return `daily at ${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")} UTC`;
}

function when(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);
  const { sources, fixtureMode, error } = await getSources();
  const now = new Date();

  return (
    <Shell tenant={tenant} current="/sources" fixtureMode={fixtureMode}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Sources</h1>
        <p className="text-sm text-muted">
          Every county adapter registered in code, and what happened the last time
          it ran.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-bad-bg bg-bad-bg px-4 py-3 text-sm text-bad">
          Could not read source health: {error}
        </p>
      ) : null}

      <ul className="mb-8 divide-y divide-line rounded-lg border border-line bg-surface">
        {sources.map((source) => (
          <li key={source.adapterId} className="flex flex-wrap gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{source.county}</p>
              <p className="text-sm text-muted">
                {source.adapterId}, {source.eventTypes.join(" and ").toLowerCase()}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Polls {cadenceLabel(source.cadence)}, reaching back{" "}
                {source.lookbackDays} days.
                Last run {when(source.lastRunAt)}.
                {source.consecutiveFailures > 0
                  ? ` ${source.consecutiveFailures} consecutive failures.`
                  : ""}
              </p>
              {source.lastError ? (
                <p className="mt-1 text-xs text-bad">{source.lastError}</p>
              ) : null}
            </div>
            <span
              className={`h-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                HEALTH_TONE[source.health] ?? HEALTH_TONE.unknown
              }`}
            >
              {fixtureMode ? "not run yet" : source.health}
            </span>
          </li>
        ))}
      </ul>

      {/* Delivery health belongs here too. A source can be perfectly healthy
          while nobody is receiving anything, which is the failure that would
          take longest to notice. */}
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
        Next digest per tenant
      </h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {allTenants().map((partner) => {
          const next = nextDigestTime(
            {
              digestHour: partner.digestHour,
              digestMinute: partner.digestMinute,
              digestTimezone: "America/Chicago",
              digestCadence: partner.digestCadence,
            },
            now,
          );

          return (
            <li key={partner.key} className="flex flex-wrap gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{partner.name}</p>
                <p className="text-sm text-muted">
                  {partner.digestCadence === "weekly_monday"
                    ? "Weekly on Monday"
                    : "Daily"}{" "}
                  at {String(partner.digestHour).padStart(2, "0")}:
                  {String(partner.digestMinute).padStart(2, "0")} Central, via{" "}
                  {partner.digestChannels.join(" and ")}
                </p>
              </div>
              <span className="h-fit shrink-0 text-xs text-muted">
                {next.toISOString().replace("T", " ").slice(0, 16)} UTC
              </span>
            </li>
          );
        })}
      </ul>

      {fixtureMode ? (
        <p className="mt-4 text-xs text-muted">
          No worker has run against a database yet, so there is no run history to
          show. The adapters and schedules above are read from code and are real.
        </p>
      ) : null}
    </Shell>
  );
}
