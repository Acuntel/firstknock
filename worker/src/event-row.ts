import type { EventParty, EventType, PropertyEvent, RawRecord } from "./types";

/**
 * Turns a row from the `events` table back into a PropertyEvent.
 *
 * Shared between the worker and the web app so a lead read from the database
 * cannot be shaped one way for the digest and another way for the page it links
 * to. The column names here are the contract with supabase/migrations.
 */
export function eventFromRow(row: Record<string, unknown>): PropertyEvent {
  return {
    fips: String(row.fips ?? ""),
    type: row.type as EventType,
    occurredAt: new Date(String(row.occurred_at)),
    externalId: String(row.dedupe_hash ?? ""),
    property: {
      address: (row.property_address as string) ?? undefined,
      city: (row.property_city as string) ?? undefined,
      state: (row.property_state as string) ?? undefined,
      zip: (row.property_zip as string) ?? undefined,
      parcelPin: (row.parcel_pin as string) ?? undefined,
      lat: typeof row.lat === "number" ? row.lat : undefined,
      lng: typeof row.lng === "number" ? row.lng : undefined,
      class: (row.property_class as string) ?? undefined,
      category: (row.property_category as PropertyEvent["property"]["category"]) ?? undefined,
    },
    parties: (row.parties as EventParty[]) ?? [],
    raw: (row.raw as RawRecord) ?? {},
  };
}
