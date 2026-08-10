import { describe, expect, it } from "vitest";
import {
  composeDigest,
  composeHotPing,
  composeLeadsReply,
  escapeHtml,
} from "../src/digest/compose";
import { plural } from "../src/plural";
import { countiesLabel } from "../src/counties";
import type { ComposableLead, ComposeInput } from "../src/digest/compose";
import type { PropertyEvent } from "../src/types";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const TELEGRAM_LIMIT = 4096;

function event(overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    fips: "17031",
    type: "PERMIT",
    occurredAt: new Date("2026-08-09T09:00:00.000Z"),
    externalId: "abc",
    property: { address: "18231 PARK AV", city: "HOMEWOOD", state: "IL", zip: "60430" },
    parties: [],
    raw: {},
    ...overrides,
  };
}

function lead(n: number, overrides: Partial<PropertyEvent> = {}): ComposableLead {
  return {
    id: `lead-${n}`,
    score: 90 - n,
    event: event({ externalId: `ext-${n}`, ...overrides }),
  };
}

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    tenantName: "Paul Restoration",
    counties: ["17031"],
    leadNoun: "loss",
    subjectTemplate: "Your {county} losses this morning",
    leads: [lead(1)],
    appUrl: "https://app.firstknock.example",
    tenantKey: "paul",
    now: NOW,
    ...overrides,
  };
}

describe("pluralising lead nouns", () => {
  it("handles every noun the launch presets use", () => {
    // The naive version of this put "5 losss" in a paying customer's inbox.
    expect(plural("loss", 5)).toBe("losses");
    expect(plural("property", 10)).toBe("properties");
    expect(plural("job", 3)).toBe("jobs");
    expect(plural("filing", 2)).toBe("filings");
  });

  it("leaves a single item alone", () => {
    expect(plural("loss", 1)).toBe("loss");
    expect(plural("property", 1)).toBe("property");
  });

  it("says it in the headline", () => {
    expect(composeDigest(input({ leads: [lead(1)] })).telegram[0]).toContain("1 loss in");
    expect(composeDigest(input({ leads: [lead(1), lead(2)] })).telegram[0]).toContain(
      "2 losses in",
    );
  });
});

describe("county phrasing", () => {
  it("names one county with its state", () => {
    expect(countiesLabel(["17031"])).toBe("Cook, IL");
  });

  it("says the shared state once rather than after every county", () => {
    // Otherwise Vince's subject line reads "Cook, IL, DuPage, IL, and Will, IL".
    expect(countiesLabel(["17031", "17043", "17197"])).toBe(
      "Cook, DuPage, and Will counties, IL",
    );
  });

  it("keeps states attached when they differ", () => {
    expect(countiesLabel(["17031", "26163"])).toBe("Cook, IL and Wayne, MI");
  });

  it("fills the subject template", () => {
    const content = composeDigest(input({ counties: ["17031", "17043", "17197"] }));
    expect(content.subject).toBe(
      "Your Cook, DuPage, and Will counties, IL losses this morning",
    );
  });
});

describe("HTML safety", () => {
  it("escapes the characters Telegram would reject", () => {
    expect(escapeHtml('Smith & Sons <"Co">')).toBe(
      "Smith &amp; Sons &lt;&quot;Co&quot;&gt;",
    );
  });

  it("escapes county data inside a rendered digest", () => {
    // County address lines are full of ampersands, and one unescaped is enough
    // for Telegram to reject the whole message.
    const content = composeDigest(
      input({ leads: [lead(1, { property: { address: "A & B ST", city: "CICERO" } })] }),
    );
    expect(content.telegram[0]).toContain("A &amp; B ST");
    expect(content.telegram[0]).not.toMatch(/[^&]&[^a-z#]/);
  });

  it("keeps the anchor tag intact around an escaped url", () => {
    const content = composeDigest(input());
    expect(content.telegram[0]).toContain('<a href="https://app.firstknock.example/leads/');
  });
});

describe("deep links", () => {
  it("points at the app with the tenant preserved", () => {
    const content = composeDigest(input());
    expect(content.telegram[0]).toContain("/leads/lead-1?tenant=paul");
  });

  it("does not double up slashes when the app url has a trailing one", () => {
    const content = composeDigest(input({ appUrl: "https://app.firstknock.example/" }));
    expect(content.telegram[0]).not.toContain(".example//leads");
  });
});

describe("Telegram length limit", () => {
  it("keeps a normal digest in one message", () => {
    const content = composeDigest(input({ leads: [lead(1), lead(2), lead(3)] }));
    expect(content.telegram).toHaveLength(1);
    expect(content.telegram[0]!.length).toBeLessThan(TELEGRAM_LIMIT);
  });

  it("splits a long digest rather than losing the tail", () => {
    const many = Array.from({ length: 120 }, (_, i) => lead(i));
    const content = composeDigest(input({ leads: many }));

    expect(content.telegram.length).toBeGreaterThan(1);
    for (const message of content.telegram) {
      expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    }
  });

  it("splits between leads, never inside one", () => {
    const many = Array.from({ length: 120 }, (_, i) => lead(i));
    const content = composeDigest(input({ leads: many }));

    // Every lead's link survives exactly once across the whole sequence.
    const joined = content.telegram.join("\n");
    for (let i = 0; i < 120; i += 1) {
      expect(joined.split(`/leads/lead-${i}?`).length - 1, `lead ${i}`).toBe(1);
    }
  });

  it("puts the footer on the last message only", () => {
    const many = Array.from({ length: 120 }, (_, i) => lead(i));
    const content = composeDigest(input({ leads: many }));
    const withFooter = content.telegram.filter((m) => m.includes("/leads any time"));
    expect(withFooter).toHaveLength(1);
    expect(content.telegram[content.telegram.length - 1]).toContain("/leads any time");
  });
});

describe("empty digest", () => {
  it("says so plainly instead of sending a bare header", () => {
    const content = composeDigest(input({ leads: [] }));
    expect(content.telegram[0]).toContain("No new losses in Cook, IL this morning.");
  });
});

describe("hot ping", () => {
  it("names the score and the threshold it crossed", () => {
    const ping = composeHotPing(input(), lead(1), 80);
    expect(ping.telegram).toContain("Hot loss, 89");
    expect(ping.telegram).toContain("Above your 80 ping threshold.");
    expect(ping.subject).toBe("89: 18231 PARK AV");
  });

  it("stays short enough to read on a lock screen", () => {
    expect(composeHotPing(input(), lead(1), 80).telegram.length).toBeLessThan(400);
  });
});

describe("the /leads reply", () => {
  it("returns at most five", () => {
    const many = Array.from({ length: 12 }, (_, i) => lead(i));
    const reply = composeLeadsReply(input({ leads: many }));
    expect(reply.split("/leads/").length - 1).toBe(5);
  });

  it("says something useful when there is nothing", () => {
    expect(composeLeadsReply(input({ leads: [] }))).toContain("Nothing scored above zero");
  });
});
