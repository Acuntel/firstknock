import type { PropertyEvent } from "./types";

/**
 * A URL safe identifier for a lead that exists only in fixture mode.
 *
 * Real leads carry a database uuid. Fixtures have no database, so the app and
 * the digest preview both need to derive an id from the event, and they must
 * derive the same one: a digest link that does not resolve to the page it points
 * at is worse than no link.
 *
 * County record ids are not usable raw. Cook permit row ids look like
 * "293130000200002026-07-28 00:00:00.000", complete with spaces and colons.
 */
export function fixtureLeadId(event: PropertyEvent): string {
  return `${event.type}-${event.externalId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
