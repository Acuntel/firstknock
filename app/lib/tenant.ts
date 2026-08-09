import { DESIGN_PARTNERS, designPartner } from "@firstknock/worker/tenants";
import type { DesignPartnerTenant } from "@firstknock/worker/tenants";

export const DEFAULT_TENANT_KEY = "vince";

export function allTenants(): DesignPartnerTenant[] {
  return DESIGN_PARTNERS;
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
