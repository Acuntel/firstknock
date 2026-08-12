import Link from "next/link";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";
import { allTenants, href } from "@/lib/tenant";

/**
 * Two kinds of screen, kept visually apart.
 *
 * The desk pages are cross market and belong to whoever runs FirstKnock. The
 * customer pages show one tenant's own county. Putting an eight tenant switcher
 * above both was the single biggest thing making this look like a build tool
 * rather than a product, because on the desk pages it means nothing at all.
 */
const DESK = [
  { path: "/daily", label: "Daily" },
  { path: "/prospects", label: "Companies" },
];

const TENANT_PAGES = [
  { path: "/today", label: "Today" },
  { path: "/board", label: "Board" },
  { path: "/sources", label: "Sources" },
  { path: "/settings", label: "Settings" },
];

function isDesk(path: string): boolean {
  return DESK.some((item) => item.path === path);
}

export function Shell({
  tenant,
  current,
  fixtureMode,
  children,
}: {
  tenant: DesignPartnerTenant;
  current: string;
  fixtureMode: boolean;
  children: React.ReactNode;
}) {
  const desk = isDesk(current);
  const nav = desk ? DESK : TENANT_PAGES;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <Link href="/daily" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-[13px] font-bold text-white"
            >
              FK
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FirstKnock</span>
          </Link>

          <nav className="flex items-center gap-1">
            {[...DESK, ...TENANT_PAGES].map((item) => (
              <Link
                key={item.path}
                href={desk && isDesk(item.path) ? item.path : href(item.path, tenant.key)}
                className={`rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                  current === item.path
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-28">
        {/* Only where it changes what you are looking at. On the desk pages every
            market is already on screen, so a tenant picker would be noise. */}
        {!desk ? (
          <div className="flex flex-wrap items-center gap-1.5 py-4">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted">
              Viewing as
            </span>
            {allTenants().map((option) => (
              <Link
                key={option.key}
                href={href(current, option.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  option.key === tenant.key
                    ? "bg-brand text-white"
                    : "border border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {option.name}
              </Link>
            ))}
          </div>
        ) : null}

        {fixtureMode ? (
          <p className="mt-5 rounded-xl border border-warn-bg bg-warn-bg px-4 py-3 text-sm text-warn">
            Fixture data. No Supabase project is connected yet, so these leads are
            saved Cook County records scored live by the real engine.
          </p>
        ) : null}

        <main className={desk ? "pt-8" : "pt-4"}>{children}</main>
      </div>
    </div>
  );
}

/** The score, weighted so the eye lands on the best row first. */
export function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-accent text-white"
      : score >= 60
        ? "bg-accent-soft text-accent"
        : "bg-surface-2 text-muted";

  return (
    <span
      className={`tnum grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[15px] font-semibold ${tone}`}
    >
      {score}
    </span>
  );
}
