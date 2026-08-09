import { Shell } from "@/components/shell";
import { Board, type BoardCard } from "@/components/board";
import { getLeads } from "@/lib/data";
import { eventTitle, whyLine } from "@/lib/format";
import { resolveTenant } from "@/lib/tenant";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: key } = await searchParams;
  const tenant = resolveTenant(key);
  const { leads, fixtureMode } = await getLeads(tenant);
  const now = new Date();

  const cards: BoardCard[] = leads.map((lead) => ({
    id: lead.id,
    title: eventTitle(lead.event),
    subtitle: whyLine(lead.event, now),
    score: lead.score,
    status: lead.status,
  }));

  return (
    <Shell tenant={tenant} current="/board" fixtureMode={fixtureMode}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Board</h1>
        <p className="text-sm text-muted">
          Drag a lead between columns to move it through the pipeline.
        </p>
      </div>

      <Board cards={cards} tenantKey={tenant.key} fixtureMode={fixtureMode} />
    </Shell>
  );
}
