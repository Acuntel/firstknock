import { Shell } from "@/components/shell";
import { MailLeadButton } from "@/components/mail-lead-button";
import { isOperator, operatorClient } from "@/lib/operator";
import { isFixtureMode } from "@/lib/data";
import { resolveTenant } from "@/lib/tenant";
import { eventTitle, whyLine } from "@firstknock/worker/format";
import { allBoards } from "@firstknock/worker/prospect/match";
import { draftableProspects } from "@firstknock/worker/prospect/store";

export const runtime = "nodejs";

/** How many leads a person can actually work through in a morning. */
const PER_MARKET = 5;

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);

  if (!(await isOperator())) {
    return (
      <Shell tenant={tenant} current="/daily" fixtureMode={await isFixtureMode()}>
        <h1 className="mb-3 text-xl font-semibold">Daily</h1>
        <p className="text-sm text-muted">
          This is the desk for whoever runs FirstKnock. Add your address to
          OPERATOR_EMAILS and sign in.
        </p>
      </Shell>
    );
  }

  const client = operatorClient();
  const now = new Date();

  // Everyone still contactable, fetched once and matched against every lead,
  // rather than a query per lead.
  const prospects = await draftableProspects(client, 500);
  const boards = await allBoards(client, PER_MARKET, prospects);

  return (
    <Shell tenant={tenant} current="/daily" fixtureMode={await isFixtureMode()}>
      <h1 className="mb-1 text-xl font-semibold">Today&apos;s best, by market</h1>
      <p className="mb-8 text-sm text-muted">
        The {PER_MARKET} highest scoring leads in each market, and under each one
        the companies whose trade it is. Mail sends a draft about that exact
        property to your own mailbox.
      </p>

      {boards.map((board) => (
        <section key={board.market.fips} className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
            {board.market.label}
          </h2>

          {board.leads.length === 0 ? (
            /* Shown rather than hidden. An empty market means the feed has gone
               quiet, and dropping it silently makes that look like a slow day. */
            <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
              Nothing scored here yet. The feed may have gone quiet.
            </p>
          ) : (
            <ul className="space-y-4">
              {board.leads.map((lead) => (
                <li key={lead.id} className="rounded-lg border border-line bg-surface">
                  <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-3">
                    <span className="text-lg font-semibold tabular-nums">{lead.score}</span>
                    <span className="text-sm font-medium">{eventTitle(lead.event)}</span>
                    {lead.citation ? (
                      <span className="text-sm text-muted">cited for {lead.citation}</span>
                    ) : null}
                    <span className="text-xs text-muted">{whyLine(lead.event, now)}</span>
                  </div>

                  {lead.buyers.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-muted">
                      {lead.segments.length > 0
                        ? `This is ${lead.segments
                            .map((s) => s.label.toLowerCase())
                            .join(" or ")} work, but no company on the list does it here yet.`
                        : "No trade matched this citation."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {lead.buyers.map((buyer) => (
                        <MailLeadButton
                          key={buyer.prospect.id}
                          prospectId={buyer.prospect.id}
                          leadId={lead.id}
                          company={buyer.prospect.company}
                          email={buyer.prospect.email ?? ""}
                          trade={buyer.segment.label}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </Shell>
  );
}
