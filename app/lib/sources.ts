import { allAdapters } from "@firstknock/worker/registry";
import { countyName } from "@firstknock/worker/counties";
import { isFixtureMode } from "./data";
import { sessionClient } from "./session";

export interface SourceHealth {
  adapterId: string;
  county: string;
  eventTypes: string[];
  cadence: string;
  lookbackDays: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  health: "healthy" | "degraded" | "failing" | "unknown";
  lastError: string | null;
}

export interface SourcesResult {
  sources: SourceHealth[];
  fixtureMode: boolean;
  error: string | null;
}

/**
 * Health for every registered adapter.
 *
 * The registry is the list of record, not the sources table. A pack that exists
 * in code but was never seeded into the database is exactly the failure this
 * page should show, and reading only the table would hide it.
 */
export async function getSources(): Promise<SourcesResult> {
  const registered = allAdapters().map((adapter) => ({
    adapterId: adapter.id,
    county: countyName(adapter.fips),
    eventTypes: [...adapter.eventTypes],
    cadence: adapter.cadence,
    lookbackDays: adapter.lookbackDays,
    enabled: true,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    health: "unknown" as const,
    lastError: null,
  }));

  if (await isFixtureMode()) {
    return { sources: registered, fixtureMode: true, error: null };
  }

  try {
    // Sources are global facts with no tenant column, so any signed in user may
    // read them. The session client still carries the auth RLS needs.
    const client = await sessionClient();

    const { data, error } = await client
      .from("sources")
      .select(
        "adapter_id, enabled, last_run_at, last_success_at, consecutive_failures, health, last_error",
      );

    if (error) throw new Error(error.message);

    const byId = new Map(
      (data ?? []).map((row) => [String(row.adapter_id), row as Record<string, unknown>]),
    );

    const sources = registered.map((source) => {
      const row = byId.get(source.adapterId);
      if (!row) return source;
      return {
        ...source,
        enabled: Boolean(row.enabled),
        lastRunAt: (row.last_run_at as string) ?? null,
        lastSuccessAt: (row.last_success_at as string) ?? null,
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
        health: (row.health as SourceHealth["health"]) ?? "unknown",
        lastError: (row.last_error as string) ?? null,
      };
    });

    return { sources, fixtureMode: false, error: null };
  } catch (error) {
    return {
      sources: registered,
      fixtureMode: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
