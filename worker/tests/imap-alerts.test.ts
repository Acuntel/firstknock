import { describe, expect, it } from "vitest";
import {
  matchesSource,
  parseAlert,
  parseAlerts,
  type AlertMessage,
  type AlertSourceConfig,
} from "../src/adapters/imap-alerts";

// Two different vendors with completely different email shapes, parsed by the
// same code with different configs. That is the whole requirement from the
// Phase 5 directive: never hardcode one provider.

const FIRE_ALERTS: AlertSourceConfig = {
  id: "il-cook-imap-fire",
  fips: "17031",
  eventType: "FIRE_INCIDENT",
  fromPattern: "alerts@examplefirewatch\\.com",
  subjectPattern: "structure fire",
  fields: {
    address: { pattern: "Address:\\s*(.+)" },
    city: { pattern: "City:\\s*(.+)" },
    state: { pattern: "State:\\s*([A-Z]{2})", flags: "" },
    occurredAt: { pattern: "Dispatched:\\s*(.+)" },
  },
};

const FORECLOSURE_ALERTS: AlertSourceConfig = {
  id: "il-winnebago-imap-foreclosure",
  fips: "17201",
  eventType: "LIS_PENDENS",
  fromPattern: "noreply@examplecourtfeed\\.net",
  fields: {
    // Same parser, an entirely different email layout.
    address: { pattern: "PROPERTY\\s+>>\\s*([^\\n]+)" },
    parcelPin: { pattern: "PIN\\s+>>\\s*([0-9-]+)" },
  },
  defaultCategory: "residential",
};

function message(overrides: Partial<AlertMessage> = {}): AlertMessage {
  return {
    from: "alerts@examplefirewatch.com",
    subject: "Structure fire reported",
    text: [
      "Address: 1842 W Fullerton Ave",
      "City: Chicago",
      "State: IL",
      "Dispatched: 2026-08-10T04:12:00Z",
    ].join("\n"),
    receivedAt: new Date("2026-08-10T04:20:00.000Z"),
    messageId: "<abc123@examplefirewatch.com>",
    ...overrides,
  };
}

describe("source matching", () => {
  it("accepts mail from the configured sender and subject", () => {
    expect(matchesSource(message(), FIRE_ALERTS)).toBe(true);
  });

  it("ignores mail from anyone else in the same mailbox", () => {
    // A tenant's alert mailbox is usually a real inbox with other mail in it.
    expect(matchesSource(message({ from: "mom@example.com" }), FIRE_ALERTS)).toBe(false);
  });

  it("ignores the right sender with the wrong subject", () => {
    expect(
      matchesSource(message({ subject: "Your monthly invoice" }), FIRE_ALERTS),
    ).toBe(false);
  });

  it("survives a tenant supplying a broken pattern", () => {
    // The config comes from a person. A bad regex must not take the run down.
    const broken = { ...FIRE_ALERTS, fromPattern: "([unclosed" };
    expect(matchesSource(message(), broken)).toBe(false);
  });
});

describe("parsing one vendor's format", () => {
  it("pulls every configured field", () => {
    const event = parseAlert(message(), FIRE_ALERTS);
    expect(event?.type).toBe("FIRE_INCIDENT");
    expect(event?.fips).toBe("17031");
    expect(event?.property.address).toBe("1842 W Fullerton Ave");
    expect(event?.property.city).toBe("Chicago");
    expect(event?.property.state).toBe("IL");
  });

  it("prefers the timestamp the alert states over delivery time", () => {
    const event = parseAlert(message(), FIRE_ALERTS);
    expect(event?.occurredAt.toISOString()).toBe("2026-08-10T04:12:00.000Z");
  });

  it("falls back to delivery time when the alert states none", () => {
    const event = parseAlert(
      message({ text: "Address: 1842 W Fullerton Ave" }),
      FIRE_ALERTS,
    );
    expect(event?.occurredAt.toISOString()).toBe("2026-08-10T04:20:00.000Z");
  });

  it("falls back to delivery time when the stated one is unreadable", () => {
    const event = parseAlert(
      message({ text: "Address: 1 A St\nDispatched: sometime last night" }),
      FIRE_ALERTS,
    );
    expect(event?.occurredAt.toISOString()).toBe("2026-08-10T04:20:00.000Z");
  });

  it("uses the message id as the dedupe key, so re-reading costs nothing", () => {
    expect(parseAlert(message(), FIRE_ALERTS)?.externalId).toBe(
      "<abc123@examplefirewatch.com>",
    );
  });

  it("discards an alert with no address", () => {
    // Nothing can be scored, knocked on, or mailed without one.
    expect(parseAlert(message({ text: "City: Chicago" }), FIRE_ALERTS)).toBeNull();
  });

  it("reads a field out of the subject line as readily as the body", () => {
    const event = parseAlert(
      message({ subject: "Structure fire at Address: 9 Elm St", text: "no body fields" }),
      FIRE_ALERTS,
    );
    expect(event?.property.address).toBe("9 Elm St");
  });
});

describe("a second vendor, same parser", () => {
  const courtMail = message({
    from: "noreply@examplecourtfeed.net",
    subject: "New filing",
    text: ["CASE >> 2026-CH-00412", "PROPERTY >> 77 Kishwaukee St", "PIN >> 11-26-104-003"].join(
      "\n",
    ),
    messageId: "<filing-412@examplecourtfeed.net>",
  });

  it("parses a completely different layout with no code change", () => {
    const event = parseAlert(courtMail, FORECLOSURE_ALERTS);
    expect(event?.type).toBe("LIS_PENDENS");
    expect(event?.fips).toBe("17201");
    expect(event?.property.address).toBe("77 Kishwaukee St");
    expect(event?.property.parcelPin).toBe("11-26-104-003");
  });

  it("applies the source's default category when the mail says nothing", () => {
    expect(parseAlert(courtMail, FORECLOSURE_ALERTS)?.property.category).toBe("residential");
  });

  it("does not parse one vendor's mail with the other's config", () => {
    expect(parseAlert(courtMail, FIRE_ALERTS)).toBeNull();
    expect(parseAlert(message(), FORECLOSURE_ALERTS)).toBeNull();
  });
});

describe("reading a whole mailbox", () => {
  it("keeps matching mail and drops the rest", () => {
    const events = parseAlerts(
      [
        message(),
        message({ from: "newsletter@example.com", messageId: "<n1>" }),
        message({ messageId: "<abc124@examplefirewatch.com>", text: "Address: 5 Oak St" }),
      ],
      FIRE_ALERTS,
    );

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.property.address)).toEqual([
      "1842 W Fullerton Ave",
      "5 Oak St",
    ]);
  });

  it("is pure, so the same mailbox parses identically twice", () => {
    const inbox = [message(), message({ messageId: "<x>", text: "Address: 5 Oak St" })];
    expect(JSON.stringify(parseAlerts(inbox, FIRE_ALERTS))).toBe(
      JSON.stringify(parseAlerts(inbox, FIRE_ALERTS)),
    );
  });
});
