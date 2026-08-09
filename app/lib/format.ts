import type { PropertyEvent } from "@firstknock/worker/types";
import { countyName } from "./counties";

export function eventTitle(event: PropertyEvent): string {
  const address = event.property.address;
  if (address) return address;
  if (event.property.parcelPin) return `Parcel ${event.property.parcelPin}`;
  return "Unidentified property";
}

/**
 * Where the property is, in the most specific terms the record supports.
 *
 * Cook's sales feed carries a parcel number and nothing else, no street, city,
 * or zip. Falling back to the county keeps the line meaningful instead of
 * printing a bare state code.
 */
export function eventPlace(event: PropertyEvent): string {
  const parts = [event.property.city, event.property.state, event.property.zip]
    .filter(Boolean)
    .join(", ");
  return event.property.city ? parts : countyName(event.fips);
}

export function typeLabel(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
}

export function ageLabel(occurredAt: Date, now: Date = new Date()): string {
  const hours = Math.max(0, (now.getTime() - occurredAt.getTime()) / 3_600_000);
  if (hours < 1) return "just filed";
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** The one line reason a lead is where it is, for the today view. */
export function whyLine(event: PropertyEvent, now: Date = new Date()): string {
  const place = event.property.city
    ? ` in ${event.property.city}`
    : ` in ${countyName(event.fips)}`;
  const category = event.property.category ? `${event.property.category} ` : "";
  return `${category}${typeLabel(event.type)}${place}, ${ageLabel(event.occurredAt, now)}`;
}
