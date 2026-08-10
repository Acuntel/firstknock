import { readFileSync } from "node:fs";
import { cookPermitsAdapter, cookSalesAdapter } from "./adapters/cook-socrata";
import type { CountyAdapter, PropertyEvent, RawRecord } from "./types";

function fixture(name: string): RawRecord[] {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as RawRecord[];
}

function normalizeAll(adapter: CountyAdapter, rows: RawRecord[]): PropertyEvent[] {
  return rows
    .map((row) => adapter.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

/**
 * The saved Cook County records, normalized.
 *
 * Shared by the digest preview and the Telegram send test so both exercise the
 * same events. These are real API responses, not invented rows.
 */
export function fixtureEvents(): PropertyEvent[] {
  return [
    ...normalizeAll(cookSalesAdapter, fixture("cook-sales.json")),
    ...normalizeAll(cookPermitsAdapter, fixture("cook-permits.json")),
  ];
}
