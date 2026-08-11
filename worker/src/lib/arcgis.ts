import type { RawRecord } from "../types";
import { log } from "./log";

export interface ArcGisQuery {
  /** Full FeatureServer layer URL, without the /query suffix. */
  layerUrl: string;
  /** Column the incremental window filters and orders on. */
  dateField: string;
  since: Date;
  /** Extra SQL appended with AND, for dropping unusable rows server side. */
  where?: string;
  pageSize?: number;
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;

/** ArcGIS SQL wants a bare date literal for DateOnly columns. */
function dateLiteral(date: Date): string {
  return `DATE '${date.toISOString().slice(0, 10)}'`;
}

/**
 * Reads every page of an ArcGIS FeatureServer layer newer than `since`.
 *
 * The shape mirrors the Socrata helper deliberately: same windowing, same
 * ordered paging, same page cap. Two county platforms with one mental model is
 * worth more than each helper being individually idiomatic.
 *
 * Ordering by the filtered column is what makes offset paging safe. Without it
 * ArcGIS may return rows in a different order per page and silently drop
 * records between pages.
 */
export async function fetchArcGis(query: ArcGisQuery): Promise<RawRecord[]> {
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = query.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: RawRecord[] = [];

  const clauses = [`${query.dateField} >= ${dateLiteral(query.since)}`];
  if (query.where) clauses.push(query.where);

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${query.layerUrl.replace(/\/+$/, "")}/query`);
    url.searchParams.set("where", clauses.join(" AND "));
    url.searchParams.set("outFields", "*");
    url.searchParams.set("orderByFields", `${query.dateField} ASC`);
    url.searchParams.set("resultOffset", String(page * pageSize));
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("f", "json");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`ArcGIS returned ${response.status} for ${query.layerUrl}`);
    }

    const payload = (await response.json()) as {
      features?: Array<{ attributes: RawRecord }>;
      error?: { message?: string };
      exceededTransferLimit?: boolean;
    };

    // ArcGIS reports failures inside a 200 response, so a status check alone
    // would read an error body as an empty result set.
    if (payload.error) {
      throw new Error(
        `ArcGIS error for ${query.layerUrl}: ${payload.error.message ?? "unknown"}`,
      );
    }

    const features = payload.features ?? [];
    rows.push(...features.map((feature) => feature.attributes));
    if (features.length < pageSize) return rows;
  }

  log.warn("arcgis page cap reached, results may be truncated", {
    layerUrl: query.layerUrl,
    maxPages,
    rows: rows.length,
  });
  return rows;
}

/**
 * ArcGIS returns dates two ways depending on the column type: epoch
 * milliseconds for Date, and a plain YYYY-MM-DD string for DateOnly. Both
 * appear across the county layers we read, so both are handled here rather than
 * in each adapter.
 */
export function arcgisDate(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const raw = value.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
