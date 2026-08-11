import type { RawRecord } from "../types";
import { log } from "./log";

export interface SocrataQuery {
  /** e.g. datacatalog.cookcountyil.gov */
  domain: string;
  /** Socrata four by four, e.g. wvhk-k5uv */
  datasetId: string;
  /**
   * Column the incremental window filters and orders on. Ordering still needs
   * it even when there is no date window, because offset paging without a sort
   * can silently drop rows between pages.
   */
  dateField: string;
  /**
   * Omit for datasets whose key column is not a timestamp. Cook's assessment
   * roll keys on a numeric year, which no date comparison will match, so it
   * narrows with `where` instead.
   */
  since?: Date;
  /** Extra SoQL appended with AND, for narrowing server side. */
  where?: string;
  pageSize?: number;
  /** Backstop so one very stale `since` cannot pull a whole dataset. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;

/**
 * Socrata compares timestamps as floating local values, so the filter string
 * must not carry a zone suffix or the endpoint returns nothing.
 */
function socrataTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

/**
 * Reads every page of a dataset newer than `since`.
 *
 * Ordering by the same column the window filters on is what makes offset paging
 * safe here. Without it Socrata may return rows in a different order per page and
 * silently drop records between pages.
 */
export async function fetchSocrata(query: SocrataQuery): Promise<RawRecord[]> {
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = query.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: RawRecord[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(
      `https://${query.domain}/resource/${query.datasetId}.json`,
    );
    const clauses: string[] = [];
    if (query.since) {
      clauses.push(`${query.dateField} >= '${socrataTimestamp(query.since)}'`);
    }
    if (query.where) clauses.push(query.where);
    if (clauses.length === 0) {
      throw new Error(
        `Socrata query for ${query.datasetId} has neither a date window nor a where clause, which would pull the whole dataset.`,
      );
    }
    url.searchParams.set("$where", clauses.join(" AND "));
    url.searchParams.set("$order", `${query.dateField} ASC`);
    url.searchParams.set("$limit", String(pageSize));
    url.searchParams.set("$offset", String(page * pageSize));

    const headers: Record<string, string> = { Accept: "application/json" };
    const token = process.env.SOCRATA_APP_TOKEN;
    if (token) headers["X-App-Token"] = token;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Socrata ${query.datasetId} returned ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error(`Socrata ${query.datasetId} returned a non array payload`);
    }

    rows.push(...(batch as RawRecord[]));
    if (batch.length < pageSize) return rows;
  }

  log.warn("socrata page cap reached, results may be truncated", {
    datasetId: query.datasetId,
    maxPages,
    rows: rows.length,
  });
  return rows;
}
