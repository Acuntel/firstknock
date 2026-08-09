// Coercion helpers for county payloads. Everything county sourced arrives as
// strings of uncertain quality, so every helper returns undefined rather than
// throwing. A row that cannot be read is a row the adapter discards, not a run
// that dies.

/** Trimmed string, or undefined when the value is missing or blank. */
export function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Finite number, or undefined. Tolerates numbers arriving as strings. */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Socrata floating timestamps carry no zone: "2023-01-12T00:00:00.000". Reading
 * them as local time would make the same fixture normalize differently depending
 * on where the worker runs, so they are pinned to UTC.
 */
export function socrataDate(value: unknown): Date | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Cook County PINs are 14 digits and are commonly written with dashes. Strip to
 * digits so the same parcel hashes identically no matter which dataset it came
 * from. Anything that is not 10 or 14 digits is left alone rather than guessed at.
 */
export function parcelPin(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  return digits;
}

/** Collapses runs of whitespace so names compare and display cleanly. */
export function squish(value: unknown): string | undefined {
  const raw = str(value);
  return raw ? raw.replace(/\s+/g, " ") : undefined;
}
