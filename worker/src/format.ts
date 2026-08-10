import { countyName } from "./counties";
import type { PropertyEvent } from "./types";

/**
 * How a lead is described, everywhere.
 *
 * Shared with the web app rather than duplicated so a lead cannot read one way
 * in the morning digest and another way on the page the digest links to.
 */

export function eventTitle(event: PropertyEvent): string {
  if (event.property.address) return event.property.address;
  if (event.property.parcelPin) return `Parcel ${event.property.parcelPin}`;
  return "Unidentified property";
}

/** The most specific location the record supports, falling back to the county. */
export function eventPlace(event: PropertyEvent): string {
  const parts = [event.property.city, event.property.state, event.property.zip]
    .filter(Boolean)
    .join(", ");
  return event.property.city ? parts : countyName(event.fips);
}

export function typeLabel(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
}

export function ageLabel(occurredAt: Date, now: Date): string {
  const hours = Math.max(0, (now.getTime() - occurredAt.getTime()) / 3_600_000);
  if (hours < 1) return "just filed";
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** The one line reason a lead is where it is. */
export function whyLine(event: PropertyEvent, now: Date): string {
  const place = event.property.city
    ? ` in ${event.property.city}`
    : ` in ${countyName(event.fips)}`;
  const category = event.property.category ? `${event.property.category} ` : "";
  return `${category}${typeLabel(event.type)}${place}, ${ageLabel(event.occurredAt, now)}`;
}
