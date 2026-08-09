import Link from "next/link";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";
import { allTenants, href } from "@/lib/tenant";

const NAV = [
  { path: "/today", label: "Today" },
  { path: "/board", label: "Board" },
  { path: "/settings", label: "Settings" },
];

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
  return (
    <div className="mx-auto max-w-5xl px-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <div>
          <Link href={href("/today", tenant.key)} className="text-lg font-semibold">
            FirstKnock
          </Link>
          <p className="mt-0.5 text-sm text-muted">
            {tenant.name}, {tenant.verticalPresetId} preset
          </p>
        </div>

        <nav className="flex gap-1">
          {NAV.map((item) => (
            <Link
              key={item.path}
              href={href(item.path, tenant.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                current === item.path
                  ? "bg-brand text-canvas"
                  : "text-muted hover:bg-surface-2"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* The tenant switcher is a build time affordance, not a product feature.
          It exists so the same county events can be shown through all five
          partner configurations in one sitting, which is the pitch. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
        <span className="text-xs uppercase tracking-wide text-muted">Viewing as</span>
        {allTenants().map((option) => (
          <Link
            key={option.key}
            href={href(current, option.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              option.key === tenant.key
                ? "border-brand text-brand"
                : "border-line text-muted hover:border-line-strong"
            }`}
          >
            {option.name}
          </Link>
        ))}
      </div>

      {fixtureMode ? (
        <p className="mt-5 rounded-lg border border-warn-bg bg-warn-bg px-4 py-3 text-sm text-warn">
          Fixture data. No Supabase project is connected yet, so these leads are
          saved Cook County records scored live by the real engine. Statuses on
          the board are illustrative.
        </p>
      ) : null}

      <main className="pt-6">{children}</main>
    </div>
  );
}
