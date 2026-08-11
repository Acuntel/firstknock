import type { CountyAdapter } from "./types";
import { cookAdapters } from "./adapters/cook-socrata";
import { wayneDetroitPermitsAdapter } from "./adapters/wayne-detroit";
import { onondagaSyracuseViolationsAdapter } from "./adapters/onondaga-syracuse";
import { milwaukeeAdapters } from "./adapters/milwaukee";

// Every county pack registers here. BUILD_SPEC section 3 keys the registry by
// FIPS because that is what a tenant actually subscribes to: a county, not an
// adapter. One county can have several adapters, one per dataset.
const ALL: readonly CountyAdapter[] = [
  ...cookAdapters,
  wayneDetroitPermitsAdapter,
  onondagaSyracuseViolationsAdapter,
  ...milwaukeeAdapters,
];

const byId = new Map<string, CountyAdapter>();
const byFips = new Map<string, CountyAdapter[]>();

for (const adapter of ALL) {
  if (byId.has(adapter.id)) {
    throw new Error(`Duplicate adapter id in registry: ${adapter.id}`);
  }
  byId.set(adapter.id, adapter);

  const existing = byFips.get(adapter.fips);
  if (existing) existing.push(adapter);
  else byFips.set(adapter.fips, [adapter]);
}

/** Every adapter serving a county, e.g. all Cook datasets for 17031. */
export function adaptersForFips(fips: string): readonly CountyAdapter[] {
  return byFips.get(fips) ?? [];
}

/** Resolves a sources.adapter_id row back to the code that runs it. */
export function adapterById(id: string): CountyAdapter | undefined {
  return byId.get(id);
}

export function allAdapters(): readonly CountyAdapter[] {
  return ALL;
}

export function registeredFips(): readonly string[] {
  return [...byFips.keys()];
}
