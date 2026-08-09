import { createHash } from "node:crypto";
import type { PropertyEvent } from "./types";

/**
 * The natural key of a public record event, hashed.
 *
 * Adapters never compute this themselves. Keeping the rule in one function is
 * what makes "run the worker twice, insert zero duplicates" hold across every
 * county pack, including the ones not written yet.
 *
 * The parcel is part of the key on purpose: Cook publishes multi parcel sales as
 * one document number repeated per PIN, and those are genuinely distinct events.
 */
export function dedupeHash(event: PropertyEvent): string {
  const parts = [
    event.fips,
    event.type,
    event.occurredAt.toISOString(),
    event.property.parcelPin ?? "",
    event.externalId,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
