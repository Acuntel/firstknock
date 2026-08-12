import { Shell } from "@/components/shell";
import { DraftButton } from "@/components/draft-button";
import { ImportForm } from "@/components/import-form";
import { isOperator, operatorClient } from "@/lib/operator";
import { isFixtureMode } from "@/lib/data";
import { resolveTenant } from "@/lib/tenant";
import { countyName } from "@/lib/counties";
import { BUYER_SEGMENTS, MARKETS } from "@firstknock/worker/prospect/buyers";

export const runtime = "nodejs";

const SEGMENT_LABELS = new Map(BUYER_SEGMENTS.map((s) => [s.id, s.label]));

const CONFIDENCE_NOTE: Record<string, string> = {
  verified: "Every check passed.",
  published: "They publish it on their own domain and that domain accepts mail.",
  guessed: "Not proven. Never drafted.",
};

interface Row {
  id: string;
  company: string;
  email: string | null;
  city: string | null;
  fips: string | null;
  status: string;
  email_confidence: string;
  notes: { segment?: string } | null;
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);

  if (!(await isOperator())) {
    return (
      <Shell tenant={tenant} current="/prospects" fixtureMode={await isFixtureMode()}>
        <h1 className="mb-3 text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted">
          This is the list of companies FirstKnock sells to, so it is only visible
          to whoever runs it. Add your address to OPERATOR_EMAILS and sign in.
        </p>
      </Shell>
    );
  }

  const { data } = await operatorClient()
    .from("prospects")
    .select("id, company, email, city, fips, status, email_confidence, notes")
    .order("status")
    .order("company");

  const rows = (data ?? []) as unknown as Row[];
  const ready = rows.filter(
    (row) => row.status === "new" && ["verified", "published"].includes(row.email_confidence),
  ).length;

  return (
    <Shell tenant={tenant} current="/prospects" fixtureMode={await isFixtureMode()}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Companies</h1>
          <p className="mt-1 text-sm text-muted">
            Everyone found so far, and who is ready to be written to.
          </p>
        </div>
        <p className="tnum text-sm text-muted">
          <span className="font-semibold text-ink">{ready}</span> of {rows.length} ready
        </p>
      </div>

      <div className="mb-8">
        <DraftButton ready={ready} />
      </div>

      <div className="mb-8">
        <ImportForm
          markets={MARKETS.map((m) => ({ value: m.fips, label: m.label }))}
          segments={BUYER_SEGMENTS.map((s) => ({ value: s.id, label: s.label }))}
        />
      </div>

      {rows.length === 0 ? (
        <p className="card px-5 py-4 text-sm text-muted">
          None yet. Run pnpm --filter worker prospect import to find some.
        </p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="w-56 shrink-0 text-sm font-medium">{row.company}</span>
              <span className="w-64 shrink-0 text-sm text-muted">{row.email ?? "no address"}</span>
              <span className="w-40 shrink-0 text-sm text-muted">
                {row.fips ? countyName(row.fips) : (row.city ?? "")}
              </span>
              <span className="w-44 shrink-0 text-sm text-muted">
                {SEGMENT_LABELS.get(row.notes?.segment ?? "") ?? row.notes?.segment ?? ""}
              </span>
              <span
                className={`text-xs ${
                  row.status === "drafted"
                    ? "text-brand"
                    : row.email_confidence === "guessed"
                      ? "text-idle"
                      : "text-ink"
                }`}
                title={CONFIDENCE_NOTE[row.email_confidence]}
              >
                {row.status === "drafted"
                  ? "drafted"
                  : row.status === "suppressed"
                    ? "will not contact"
                    : row.email_confidence}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        An address is only written to when the company publishes it on their own
        domain and that domain accepts mail. A guess that bounces costs more than
        the lead is worth, so guesses are never drafted.
      </p>
    </Shell>
  );
}
