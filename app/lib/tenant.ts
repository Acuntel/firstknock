import { ALL_TENANTS, designPartner } from "@firstknock/worker/tenants";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";

export const DEFAULT_TENANT_KEY = "vince";

export function allTenants(): DesignPartnerTenant[] {
  // Every tenant, not just Brady's five design partners. The switcher listing
  // fewer than exist is how a whole market becomes unreachable in the UI while
  // its leads sit in the database.
  return ALL_TENANTS;
}

export function resolveTenant(key: string | undefined): DesignPartnerTenant {
  if (!key) return designPartner(DEFAULT_TENANT_KEY);
  try {
    return designPartner(key);
  } catch {
    return designPartner(DEFAULT_TENANT_KEY);
  }
}

/** Keeps the selected tenant across navigation. */
export function href(path: string, tenantKey: string): string {
  return `${path}?tenant=${encodeURIComponent(tenantKey)}`;
}
