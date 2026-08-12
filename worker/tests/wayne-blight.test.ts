import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blightCategory,
  fineAmount,
  wayneBlightTicketsAdapter as blight,
} from "../src/adapters/wayne-blight";
import type { PropertyEvent, RawRecord } from "../src/types";

// Real tickets from Detroit's docket, saved live and spread across ordinance
// kinds so the trade matching is actually exercised.
const rows = JSON.parse(
  readFileSync(new URL("../fixtures/wayne-detroit-blight.json", import.meta.url), "utf8"),
) as RawRecord[];

function events(): PropertyEvent[] {
  return rows
    .map((row) => blight.normalize(row))
    .filter((event): event is PropertyEvent => event !== null);
}

describe("Detroit blight tickets", () => {
  it("normalizes every fixture row", () => {
    expect(events()).toHaveLength(rows.length);
  });

  it("carries the owner and where to post a letter", () => {
    // This is why the docket is worth more than Detroit's permit feed. Contact
    // resolution is normally the expensive half of a lead and the city has
    // already done it.
    const withOwner = events().filter((e) => e.parties[0]?.address);
    expect(withOwner.length).toBeGreaterThan(rows.length * 0.8);
    for (const event of withOwner) {
      expect(event.parties[0]?.role).toBe("owner");
    }
  });

  it("says what is wrong in words that name a trade", () => {
    // The permits only ever say "Alteration". These say excessive weeds, bulk
    // solid waste, failure to register a vacant building.
    const described = rows.filter((row) => String(row["ordinance_description"] ?? "").length > 10);
    expect(described.length).toBe(rows.length);
  });

  it("reads the dwelling type out of the ordinance text", () => {
    expect(blightCategory({ ordinance_description: "Excessive weeds one- or two-family dwelling" })).toBe("residential");
    expect(blightCategory({ ordinance_description: "Failure to maintain a vacant lot" })).toBe("vacant");
    expect(blightCategory({ ordinance_description: "Certificate of compliance commercial building" })).toBe("commercial");
    expect(blightCategory({})).toBeUndefined();
  });

  it("strips Detroit's trailing dot off a parcel", () => {
    const event = blight.normalize({
      ticket_id: "1",
      address: "6100 IRONWOOD",
      ticket_issued_date: "2026-08-01",
      parcel_id: "16011692.",
    });
    expect(event?.property.parcelPin).toBe("16011692");
  });

  it("bounds the window at both ends", () => {
    // The docket contains tickets dated 3016, the same typed-year rubbish Cook
    // County ships, and an unbounded descending window fills its first page
    // with them.
    expect(blight.fetch.toString()).toContain("CURRENT_TIMESTAMP");
  });

  it("reads the fine", () => {
    const fines = rows.map(fineAmount).filter((n): n is number => n !== undefined);
    expect(fines.length).toBeGreaterThan(0);
  });
});
