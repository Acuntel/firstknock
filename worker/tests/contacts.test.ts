import { describe, expect, it } from "vitest";
import { resolveContact, verifiedEmails } from "../src/contacts/resolve";
import { syntaxValid, verifyEmail } from "../src/contacts/verify-email";
import type { PropertyEvent } from "../src/types";

function event(overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    fips: "17031",
    type: "PERMIT",
    occurredAt: new Date("2026-08-09T09:00:00.000Z"),
    externalId: "abc",
    property: { address: "18231 PARK AV", city: "HOMEWOOD", state: "IL" },
    parties: [],
    raw: {},
    ...overrides,
  };
}

describe("email syntax", () => {
  it("accepts the shapes real addresses take", () => {
    for (const address of [
      "owner@example.com",
      "first.last@sub.example.co.uk",
      "a+tag@example.io",
      "o'brien@example.com",
    ]) {
      expect(syntaxValid(address), address).toBe(true);
    }
  });

  it("rejects obvious junk before spending a DNS lookup on it", () => {
    for (const address of [
      "",
      "no-at-sign.com",
      "@example.com",
      "owner@",
      "owner@nodot",
      "owner name@example.com",
      ".leading@example.com",
      "double..dot@example.com",
      "owner@-example.com",
    ]) {
      expect(syntaxValid(address), address).toBe(false);
    }
  });
});

describe("verification labelling", () => {
  // The acceptance criterion with no exceptions: an address is verified only
  // when every step passed. Anything else is guessed, including a step that
  // could not run.
  it("never labels an address verified when a step could not run", async () => {
    const result = await verifyEmail("owner@example.com", { offline: true });
    expect(result.status).toBe("guessed");
    expect(result.steps.some((step) => step.step === "mx" && !step.passed)).toBe(true);
  });

  it("labels a malformed address guessed without touching the network", async () => {
    const result = await verifyEmail("not-an-address", {});
    expect(result.status).toBe("guessed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.step).toBe("syntax");
  });

  it("records a reason for every step, so the UI can explain the label", async () => {
    const result = await verifyEmail("owner@example.com", { offline: true });
    for (const step of result.steps) {
      expect(step.detail.length).toBeGreaterThan(10);
      expect(step.detail.endsWith(".")).toBe(true);
      expect(step.at).toBeTruthy();
    }
  });
});

describe("resolution chain", () => {
  it("always produces a trail, even when it finds nothing", async () => {
    // The Phase 4 acceptance criterion: no contact row without a trail.
    const contact = await resolveContact(event());
    expect(contact.resolutionTrail.length).toBeGreaterThan(0);
    expect(contact.name).toBeNull();
  });

  it("takes the owner from the county record first", async () => {
    const contact = await resolveContact(
      event({
        parties: [{ role: "owner", name: "JANE OWNER", address: "500 OTHER RD" }],
      }),
    );

    expect(contact.name).toBe("JANE OWNER");
    expect(contact.mailingAddress).toBe("500 OTHER RD");
    expect(contact.resolutionTrail[0]?.step).toBe("county_record");
    expect(contact.resolutionTrail[0]?.outcome).toBe("found");
  });

  it("reads the mailing address Cook buries in the raw permit record", async () => {
    const contact = await resolveContact(
      event({
        parties: [{ role: "applicant", name: "BIGOS, SCOTT" }],
        raw: { mailing_address: "503 ABBINGTON PL, SCHAUMBURG IL, 60914" },
      }),
    );
    expect(contact.mailingAddress).toContain("ABBINGTON");
  });

  it("says so plainly when no reverse lookup provider is configured", async () => {
    const contact = await resolveContact(
      event({ parties: [{ role: "owner", name: "JANE OWNER" }] }),
    );
    const step = contact.resolutionTrail.find((s) => s.step === "reverse_lookup");
    expect(step?.outcome).toBe("unavailable");
    expect(step?.detail).toContain("No reverse lookup provider");
  });

  it("records a provider failure rather than losing it", async () => {
    const contact = await resolveContact(
      event({ parties: [{ role: "owner", name: "JANE OWNER" }] }),
      {
        reverseLookup: {
          name: "TestLookup",
          find: async () => {
            throw new Error("upstream timeout");
          },
        },
      },
    );

    const step = contact.resolutionTrail.find((s) => s.step === "reverse_lookup");
    expect(step?.outcome).toBe("unavailable");
    expect(step?.detail).toContain("upstream timeout");
  });

  it("verifies every candidate a provider returns", async () => {
    const contact = await resolveContact(
      event({ parties: [{ role: "owner", name: "JANE OWNER" }] }),
      {
        reverseLookup: {
          name: "TestLookup",
          find: async () => ({
            emails: ["jane@example.com", "not-an-address"],
            phones: ["+13125550100"],
          }),
        },
        verify: { offline: true },
      },
    );

    expect(contact.emails).toHaveLength(2);
    expect(contact.phones).toEqual(["+13125550100"]);
    expect(contact.resolutionTrail.map((s) => s.step)).toEqual([
      "county_record",
      "reverse_lookup",
      "verification",
    ]);
  });

  it("hands the email drafter only verified addresses", async () => {
    // Offline mode cannot verify anything, so the drafter gets nothing. That is
    // the correct outcome: a guessed address is never drafted to.
    const contact = await resolveContact(
      event({ parties: [{ role: "owner", name: "JANE OWNER" }] }),
      {
        reverseLookup: {
          name: "TestLookup",
          find: async () => ({ emails: ["jane@example.com"], phones: [] }),
        },
        verify: { offline: true },
      },
    );

    expect(contact.emails[0]?.status).toBe("guessed");
    expect(verifiedEmails(contact)).toEqual([]);
  });
});
