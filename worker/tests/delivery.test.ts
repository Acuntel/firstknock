import { describe, expect, it } from "vitest";
import { deliver } from "../src/digest/deliver";
import type { DeliveryPayload, DeliveryTarget } from "../src/digest/deliver";

// Every case here returns before touching a transport, so nothing reaches the
// network. That is the point: these are the paths a tenant actually sits in
// while the accounts are still being set up.

const payload: DeliveryPayload = {
  subject: "Your Cook, IL losses this morning",
  telegram: ["<b>Digest</b>"],
  emailText: "Digest",
  emailHtml: "<p>Digest</p>",
};

function target(overrides: Partial<DeliveryTarget> = {}): DeliveryTarget {
  return {
    tenantName: "Paul Restoration",
    channels: ["telegram", "email"],
    telegramChatId: "123456",
    digestEmail: "paul@example.com",
    complianceFooter: null,
    ...overrides,
  };
}

describe("channel selection", () => {
  it("attempts every channel the tenant configured", async () => {
    const results = await deliver(target(), payload, { dryRun: true });
    expect(results.map((r) => r.channel).sort()).toEqual(["email", "telegram"]);
  });

  it("only attempts the channels the tenant asked for", async () => {
    // REAL Law is email only, Vince is Telegram only.
    const email = await deliver(target({ channels: ["email"] }), payload, { dryRun: true });
    expect(email.map((r) => r.channel)).toEqual(["email"]);

    const telegram = await deliver(target({ channels: ["telegram"] }), payload, {
      dryRun: true,
    });
    expect(telegram.map((r) => r.channel)).toEqual(["telegram"]);
  });

  it("reports rather than silently doing nothing when no channels are set", async () => {
    const results = await deliver(target({ channels: [] }), payload, { dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.detail).toContain("no delivery channels");
  });
});

describe("missing configuration", () => {
  it("says what to do when no chat is connected", async () => {
    const results = await deliver(
      target({ channels: ["telegram"], telegramChatId: null }),
      payload,
      { dryRun: true },
    );
    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.detail).toContain("connect link");
  });

  it("says so when a tenant wants email but has no address", async () => {
    const results = await deliver(
      target({ channels: ["email"], digestEmail: null }),
      payload,
      { dryRun: true },
    );
    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.detail).toContain("digest_email");
  });

  it("skips a channel without failing the other one", async () => {
    const results = await deliver(target({ telegramChatId: null }), payload, {
      dryRun: true,
    });
    const telegram = results.find((r) => r.channel === "telegram");
    const email = results.find((r) => r.channel === "email");

    expect(telegram?.status).toBe("skipped");
    expect(email?.status).toBe("dry-run");
  });
});

describe("dry run", () => {
  it("reports what it would have done without sending", async () => {
    const results = await deliver(target(), payload, { dryRun: true });
    for (const result of results) {
      expect(result.status).toBe("dry-run");
      expect(result.detail).toMatch(/Would/);
    }
  });

  it("counts the messages a split digest would take", async () => {
    const results = await deliver(
      target({ channels: ["telegram"] }),
      { ...payload, telegram: ["one", "two", "three"] },
      { dryRun: true },
    );
    expect(results[0]?.detail).toContain("3 messages");
  });
});
