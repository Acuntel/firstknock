import { Shell, ScorePill } from "@/components/shell";
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
        <h1 className="mb-3 text-2xl font-semibold">Daily</h1>
        <p className="max-w-prose text-sm text-muted">
          This is the desk for whoever runs FirstKnock. Add your address to
          OPERATOR_EMAILS and sign in.
        </p>
      </Shell>
    );
  }

  const client = operatorClient();
  const now = new Date();

  const prospects = await draftableProspects(client, 500);
  const boards = await allBoards(client, PER_MARKET, prospects);

  const mailable = boards.reduce(
    (total, board) => total + board.leads.reduce((n, lead) => n + lead.buyers.length, 0),
    0,
  );

  return (
    <Shell tenant={tenant} current="/daily" fixtureMode={await isFixtureMode()}>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Today&apos;s best</h1>
          <p className="mt-1 text-sm text-muted">
            The {PER_MARKET} strongest leads in each market, with the companies
            whose trade it is underneath.
          </p>
        </div>
        <p className="tnum text-sm text-muted">
          <span className="font-semibold text-ink">{mailable}</span> ready to mail
        </p>
      </div>

      <div className="space-y-12">
        {boards.map((board) => (
          <section key={board.market.fips}>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-[15px] font-semibold">{board.market.label}</h2>
              <span className="h-px flex-1 bg-line" />
              <span className="tnum text-xs text-muted">
                {board.leads.reduce((n, lead) => n + lead.buyers.length, 0)} to mail
              </span>
            </div>

            {board.leads.length === 0 ? (
              /* Shown rather than hidden. An empty market means a feed has gone
                 quiet, and dropping it silently makes that look like a slow day. */
              <p className="card px-5 py-4 text-sm text-muted">
                Nothing scored here yet. The feed may have gone quiet.
              </p>
            ) : (
              <ul className="space-y-3">
                {board.leads.map((lead) => (
                  <li key={lead.id} className="card card-interactive overflow-hidden">
                    <div className="flex items-start gap-4 px-5 py-4">
                      <ScorePill score={lead.score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">
                          {eventTitle(lead.event)}
                        </p>
                        {lead.citation ? (
                          <p className="mt-0.5 text-sm text-ink">
                            Cited for <span className="font-medium">{lead.citation}</span>
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted">{whyLine(lead.event, now)}</p>
                      </div>
                    </div>

                    {lead.buyers.length === 0 ? (
                      <p className="border-t border-line bg-surface-2/60 px-5 py-3 text-xs text-muted">
                        {lead.segments.length > 0
                          ? `This is ${lead.segments
                              .map((s) => s.label.toLowerCase())
                              .join(" or ")} work. No company on your list does it here yet.`
                          : "No trade matched this citation."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-line border-t border-line bg-surface-2/40">
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
      </div>
    </Shell>
  );
}
