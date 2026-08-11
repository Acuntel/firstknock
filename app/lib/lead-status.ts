/**
 * The lead pipeline stages.
 *
 * Deliberately its own module with no imports. The board is a client component
 * and needs these values, while lib/data.ts reaches for cookies and the
 * database, which a client bundle cannot contain. Keeping the shared constant
 * separate is what lets both sides use it.
 */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "responded",
  "won",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
