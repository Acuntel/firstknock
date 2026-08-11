import { describe, expect, it } from "vitest";
import {
  canAddCounty,
  canUseFeature,
  planFor,
  PLANS,
  subscriptionActive,
  TRIAL_DAYS,
} from "../src/billing/plans";

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("the three tiers", () => {
  it("matches the prices in BUILD_SPEC section 8", () => {
    expect(PLANS.solo.monthlyCents).toBe(14_900);
    expect(PLANS.pro.monthlyCents).toBe(29_900);
    expect(PLANS.team.monthlyCents).toBe(49_900);
  });

  it("matches the county allowances", () => {
    expect(PLANS.solo.maxCounties).toBe(1);
    expect(PLANS.pro.maxCounties).toBe(3);
    // Team is unlimited in state, which is null rather than a large number.
    expect(PLANS.team.maxCounties).toBeNull();
  });

  it("gives Team five seats and the others one", () => {
    expect(PLANS.team.maxSeats).toBe(5);
    expect(PLANS.solo.maxSeats).toBe(1);
  });

  it("trials for fourteen days", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("refuses a plan that does not exist rather than defaulting", () => {
    expect(() => planFor("enterprise")).toThrow(/Unknown plan/);
  });
});

describe("county limits", () => {
  it("lets a Solo tenant hold one county and no more", () => {
    expect(canAddCounty(PLANS.solo, 0).allowed).toBe(true);
    expect(canAddCounty(PLANS.solo, 1).allowed).toBe(false);
  });

  it("lets a Pro tenant hold three, which is exactly Vince's three", () => {
    expect(canAddCounty(PLANS.pro, 2).allowed).toBe(true);
    expect(canAddCounty(PLANS.pro, 3).allowed).toBe(false);
  });

  it("never stops a Team tenant", () => {
    expect(canAddCounty(PLANS.team, 40).allowed).toBe(true);
  });

  it("explains the refusal in words a customer would read", () => {
    const refusal = canAddCounty(PLANS.solo, 1);
    expect(refusal.reason).toContain("Solo");
    expect(refusal.reason).toContain("Upgrade");
    expect(refusal.reason?.endsWith(".")).toBe(true);
  });
});

describe("feature entitlements", () => {
  it("keeps Solo to the digest, which is what the tier promises", () => {
    expect(canUseFeature(PLANS.solo, "hotPings").allowed).toBe(false);
    expect(canUseFeature(PLANS.solo, "letters").allowed).toBe(false);
    expect(canUseFeature(PLANS.solo, "emailDrafts").allowed).toBe(false);
  });

  it("gives Pro the things that close Vince and Paul", () => {
    // Letters are what closes Vince, hot pings are what Paul's ops group runs on.
    expect(canUseFeature(PLANS.pro, "letters").allowed).toBe(true);
    expect(canUseFeature(PLANS.pro, "hotPings").allowed).toBe(true);
  });

  it("reserves export for Team", () => {
    expect(canUseFeature(PLANS.pro, "csvExport").allowed).toBe(false);
    expect(canUseFeature(PLANS.team, "csvExport").allowed).toBe(true);
  });

  it("names the feature when it refuses", () => {
    expect(canUseFeature(PLANS.solo, "letters").reason).toContain("Mailed letters");
  });
});

describe("subscription access", () => {
  it("allows a tenant inside their trial", () => {
    expect(
      subscriptionActive(
        { trialEndsAt: new Date("2026-08-20T00:00:00Z"), accessEndsAt: null },
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it("cuts off a trial that expired with no card charged", () => {
    const result = subscriptionActive(
      { trialEndsAt: new Date("2026-08-01T00:00:00Z"), accessEndsAt: null },
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("trial has ended");
  });

  it("keeps a cancelled tenant running through what they already paid for", () => {
    // Cancelling on the 10th with a period ending the 25th does not cut them off
    // on the 10th. They bought the month.
    expect(
      subscriptionActive(
        { trialEndsAt: new Date("2026-07-01T00:00:00Z"), accessEndsAt: new Date("2026-08-25T00:00:00Z") },
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it("stops them once that period is over", () => {
    expect(
      subscriptionActive(
        { trialEndsAt: null, accessEndsAt: new Date("2026-08-09T00:00:00Z") },
        NOW,
      ).allowed,
    ).toBe(false);
  });

  it("treats a paid tenant with no end date as active", () => {
    expect(subscriptionActive({ trialEndsAt: null, accessEndsAt: null }, NOW).allowed).toBe(
      true,
    );
  });
});
