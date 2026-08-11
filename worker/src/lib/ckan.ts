import type { RawRecord } from "../types";
import { log } from "./log";

export interface CkanQuery {
  /** Host of the CKAN portal, e.g. https://data.milwaukee.gov */
  host: string;
  /** The datastore resource id, which is the uuid in the download URL. */
  resourceId: string;
  /**
   * Column the incremental window filters and orders on.
   *
   * Omit it for a snapshot table. Some of the most useful files a city
   * publishes, delinquent tax being the obvious one, carry no event date at
   * all: they are a list of who is currently in trouble, republished whole.
   * Those have to be read in full and deduped downstream rather than windowed.
   */
  dateField?: string;
  since: Date;
  /** Extra SQL appended with AND, for dropping unusable rows server side. */
  where?: string;
  pageSize?: number;
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 40;

/** CKAN's datastore is Postgres, so identifiers are double quoted. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Reads every page of a CKAN datastore resource.
 *
 * The shape mirrors the Socrata and ArcGIS helpers deliberately: same
 * windowing, same ordered paging, same page cap. Three county platforms with
 * one mental model is worth more than each helper being individually idiomatic.
 *
 * It goes through datastore_search_sql rather than the file download because
 * the published files are CSV and XLSX behind a signed S3 redirect, and parsing
 * a spreadsheet would mean a new dependency to read data the portal is already
 * willing to hand over as JSON.
 */
export async function fetchCkan(query: CkanQuery): Promise<RawRecord[]> {
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = query.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: RawRecord[] = [];

  const clauses: string[] = [];
  if (query.dateField) {
    clauses.push(`${ident(query.dateField)} >= '${query.since.toISOString().slice(0, 10)}'`);
  }
  if (query.where) clauses.push(query.where);

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  // Ordering is what makes offset paging safe. Without it Postgres may return
  // rows in a different order per page and silently drop records between pages.
  // A snapshot table has no date to sort on, so it falls back to the datastore's
  // own row id, which is stable for the life of one published file.
  const order = ` ORDER BY ${ident(query.dateField ?? "_id")} ASC`;

  for (let page = 0; page < maxPages; page += 1) {
    const sql =
      `SELECT * FROM ${ident(query.resourceId)}${where}${order}` +
      ` LIMIT ${pageSize} OFFSET ${page * pageSize}`;

    const url = new URL("/api/3/action/datastore_search_sql", query.host);
    url.searchParams.set("sql", sql);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`CKAN returned ${response.status} for ${query.resourceId}`);
    }

    const body = (await response.json()) as {
      success?: boolean;
      error?: { message?: string };
      result?: { records?: RawRecord[] };
    };

    if (!body.success) {
      throw new Error(
        `CKAN rejected the query for ${query.resourceId}: ${
          body.error?.message ?? "no reason given"
        }`,
      );
    }

    const records = body.result?.records ?? [];
    rows.push(...records);

    if (records.length < pageSize) return rows;
  }

  // Hitting the cap means the window was wider than one run can drain, which is
  // a real gap in coverage rather than a slow day. It is logged rather than
  // thrown so the run still records what it did fetch.
  log.warn("ckan page cap reached, some rows were not read", {
    resourceId: query.resourceId,
    fetched: rows.length,
    maxPages,
  });
  return rows;
}

/**
 * CKAN hands dates back as "2026-08-03 00:00:00" rather than ISO.
 *
 * Treated as a calendar date in local county terms and pinned to UTC midnight,
 * which is the same thing the Socrata helper does, so an event does not shift a
 * day depending on which adapter read it.
 */
export function ckanDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
