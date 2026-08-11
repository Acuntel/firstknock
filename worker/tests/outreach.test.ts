import { describe, expect, it } from "vitest";
import { buildLetter, LETTER_TEMPLATES } from "../src/outreach/letter";
import { buildRouteSheet, doorScript } from "../src/outreach/route-sheet";
import { assembleBody } from "../src/ai/draft-email";
import { costOf, pricingFor, tokensOf } from "../src/ai/pricing";
import { MONTHLY_CAP_DOLLARS } from "../src/ai/usage";
import type { PropertyEvent } from "../src/types";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function event(overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    fips: "17031",
    type: "LIS_PENDENS",
    occurredAt: new Date("2026-08-09T09:00:00.000Z"),
    externalId: "abc",
    property: { address: "18231 PARK AV", city: "HOMEWOOD", state: "IL" },
    parties: [],
    raw: {},
    ...overrides,
  };
}

describe("letters", () => {
  const input = { tenantName: "Vince Investments", ownerName: "Jane Owner", event: event(), now: NOW };

  it("ships a template for every launch vertical", () => {
    expect(Object.keys(LETTER_TEMPLATES).sort()).toEqual([
      "investors",
      "lawfirms",
      "restoration",
      "roofing",
    ]);
  });

  it("prices the letter before anything is sent", () => {
    // BUILD_SPEC section 6: cost shown before confirm. The builder returns a
    // price and never sends, so the price cannot be skipped.
    const letter = buildLetter("investors", input, null);
    expect(letter.costCents).toBeGreaterThan(0);
    expect(letter.costLabel).toMatch(/^\$\d+\.\d{2} to print and mail$/);
  });

  it("refuses to build a law firm letter without the bar disclaimer", () => {
    // REAL Law Group's whole reason for buying is compliance posture. A letter
    // that quietly drops the disclaimer is worse than no letter.
    expect(() => buildLetter("lawfirms", input, null)).toThrow(/compliance footer/);
    expect(() => buildLetter("lawfirms", input, "   ")).toThrow(/compliance footer/);
  });

  it("carries the disclaimer when one is set", () => {
    const letter = buildLetter("lawfirms", input, "Attorney advertising.");
    expect(letter.body).toContain("Attorney advertising.");
  });

  it("lets the other verticals send without a footer, but includes one when set", () => {
    expect(buildLetter("roofing", input, null).body).not.toContain("Attorney");
    expect(buildLetter("roofing", input, "Licensed and insured.").body).toContain(
      "Licensed and insured.",
    );
  });

  it("refuses a vertical it has no template for", () => {
    expect(() => buildLetter("pool-contractors", input, null)).toThrow(/no letter template/i);
  });

  it("writes copy that follows the repo's rules", () => {
    for (const preset of Object.keys(LETTER_TEMPLATES)) {
      const footer = preset === "lawfirms" ? "Attorney advertising." : null;
      const body = buildLetter(preset, input, footer).body;
      expect(body, preset).not.toMatch(/[—–]/);
      expect(body, preset).not.toMatch(/!/);
    }
  });
});

describe("door scripts and the route sheet", () => {
  function lead(score: number, lat?: number, lng?: number) {
    return {
      score,
      event: event({
        property: { address: `${score} TEST ST`, city: "CHICAGO", lat, lng },
      }),
    };
  }

  const area = { lat: 41.8781, lng: -87.6298, radiusMiles: 30 };

  it("writes a script that names the record and does not pitch", () => {
    const script = doorScript(lead(90), "Vince Investments", NOW);
    expect(script).toContain("Vince Investments");
    expect(script).toContain("lis pendens");
    expect(script).toContain("not here to sell you anything");
    expect(script).not.toMatch(/[—–!]/);
  });

  it("orders located stops by drive proximity, not by score", () => {
    // A 70 next door should come before a 90 forty miles away: the operator is
    // driving this, and score order alone produces a route that zigzags.
    const near = lead(70, 41.88, -87.63);
    const far = lead(90, 42.4, -88.4);

    const stops = buildRouteSheet([far, near], "Vince", area, NOW);
    expect(stops[0]?.score).toBe(70);
    expect(stops[1]?.score).toBe(90);
    expect(stops[0]?.legMiles).toBeLessThan(stops[1]?.legMiles as number);
  });

  it("keeps leads with no coordinates in score order at the end", () => {
    // Cook publishes no coordinates on sales or permits, so this is the case
    // that actually runs today.
    const stops = buildRouteSheet([lead(40), lead(80), lead(60, 41.88, -87.63)], "V", area, NOW);
    expect(stops.map((s) => s.score)).toEqual([60, 80, 40]);
    expect(stops[1]?.legMiles).toBeNull();
  });

  it("caps the sheet at the requested number of stops", () => {
    const many = Array.from({ length: 25 }, (_, i) => lead(i));
    expect(buildRouteSheet(many, "V", area, NOW, 10)).toHaveLength(10);
  });

  it("numbers stops from one", () => {
    const stops = buildRouteSheet([lead(10), lead(20)], "V", area, NOW);
    expect(stops.map((s) => s.order)).toEqual([1, 2]);
  });
});

describe("email assembly", () => {
  const tenant = {
    id: "t1",
    plan: "pro",
    name: "Vince Investments",
    leadNoun: "property",
    voiceSample: null,
    signature: "Vince",
    complianceFooter: null,
    postalAddress: "123 Main St, Chicago, IL 60601",
  };

  it("appends CAN-SPAM identity and an unsubscribe line the model cannot omit", () => {
    const body = assembleBody(tenant, { subject: "s", body: "The message." });
    expect(body).toContain("123 Main St, Chicago, IL 60601");
    expect(body).toContain("Reply with the word stop");
    expect(body).toContain("Vince Investments");
  });

  it("includes the compliance footer when the tenant has one", () => {
    const body = assembleBody(
      { ...tenant, complianceFooter: "Attorney advertising." },
      { subject: "s", body: "The message." },
    );
    expect(body).toContain("Attorney advertising.");
  });
});

describe("AI spend metering", () => {
  it("prices Sonnet 5 at intro rates before the cutover and standard after", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const intro = costOf(usage, pricingFor("claude-sonnet-5", new Date("2026-08-10Z")));
    const standard = costOf(usage, pricingFor("claude-sonnet-5", new Date("2026-09-02Z")));

    expect(intro).toBe(12);
    expect(standard).toBe(18);
  });

  it("refuses to price a model nobody recorded rates for", () => {
    expect(() => pricingFor("claude-opus-5", NOW)).toThrow(/No pricing recorded/);
  });

  it("counts cached tokens toward the ledger total", () => {
    expect(
      tokensOf({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 2 }),
    ).toBe(117);
  });

  it("gives every plan a monthly ceiling", () => {
    for (const plan of ["solo", "pro", "team"]) {
      expect(MONTHLY_CAP_DOLLARS[plan], plan).toBeGreaterThan(0);
    }
  });

  it("scales the ceiling with the plan price", () => {
    expect(MONTHLY_CAP_DOLLARS.solo).toBeLessThan(MONTHLY_CAP_DOLLARS.pro as number);
    expect(MONTHLY_CAP_DOLLARS.pro).toBeLessThan(MONTHLY_CAP_DOLLARS.team as number);
  });
});
