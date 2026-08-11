export type PlanId = "solo" | "pro" | "team";

/**
 * The three tiers from BUILD_SPEC section 8, and what each one actually buys.
 *
 * Entitlements live here rather than being checked ad hoc at each call site, so
 * a tier change is one edit and there is one place to read to answer "what does
 * Pro include". The worker and the app both import this.
 */
export interface Plan {
  id: PlanId;
  label: string;
  monthlyCents: number;
  /** Null means unlimited within one state, which is the Team promise. */
  maxCounties: number | null;
  maxSeats: number;
  hotPings: boolean;
  letters: boolean;
  emailDrafts: boolean;
  csvExport: boolean;
  /** Monthly AI ceiling in dollars. See usage.ts and question 12. */
  aiCapDollars: number;
}

export const PLANS: Record<PlanId, Plan> = {
  solo: {
    id: "solo",
    label: "Solo",
    monthlyCents: 14_900,
    maxCounties: 1,
    maxSeats: 1,
    // Digest only. Everything time critical is what Pro is for.
    hotPings: false,
    letters: false,
    emailDrafts: false,
    csvExport: false,
    aiCapDollars: 7.5,
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyCents: 29_900,
    maxCounties: 3,
    maxSeats: 1,
    hotPings: true,
    letters: true,
    emailDrafts: true,
    csvExport: false,
    aiCapDollars: 15,
  },
  team: {
    id: "team",
    label: "Team",
    monthlyCents: 49_900,
    maxCounties: null,
    maxSeats: 5,
    hotPings: true,
    letters: true,
    emailDrafts: true,
    csvExport: true,
    aiCapDollars: 25,
  },
};

export const TRIAL_DAYS = 14;

export function planFor(id: string): Plan {
  const plan = PLANS[id as PlanId];
  if (!plan) throw new Error(`Unknown plan "${id}".`);
  return plan;
}

export interface EntitlementCheck {
  allowed: boolean;
  reason: string | null;
}

/**
 * Whether a tenant may add another county.
 *
 * Checked before the county is saved rather than when the digest runs. A tenant
 * who adds a fourth county on Pro and only discovers it at 6:30 the next morning
 * has had a bad night for no reason.
 */
export function canAddCounty(plan: Plan, currentCount: number): EntitlementCheck {
  if (plan.maxCounties === null) return { allowed: true, reason: null };
  if (currentCount < plan.maxCounties) return { allowed: true, reason: null };

  return {
    allowed: false,
    reason: `${plan.label} covers ${plan.maxCounties} ${plan.maxCounties === 1 ? "county" : "counties"}. Upgrade to add more.`,
  };
}

export function canUseFeature(
  plan: Plan,
  feature: "hotPings" | "letters" | "emailDrafts" | "csvExport",
): EntitlementCheck {
  if (plan[feature]) return { allowed: true, reason: null };

  const names: Record<typeof feature, string> = {
    hotPings: "Instant pings",
    letters: "Mailed letters",
    emailDrafts: "Email drafts",
    csvExport: "CSV export",
  };

  return {
    allowed: false,
    reason: `${names[feature]} are not included on ${plan.label}.`,
  };
}

/**
 * Whether a tenant's subscription still entitles them to anything.
 *
 * A cancelled tenant keeps access until the period they paid for ends, which is
 * what "cancel via portal downgrades access same day" means in practice: the
 * webhook sets the end date, and this is what reads it.
 */
export function subscriptionActive(
  tenant: { trialEndsAt: Date | null; accessEndsAt: Date | null },
  now: Date,
): EntitlementCheck {
  if (tenant.accessEndsAt && tenant.accessEndsAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "This subscription has ended." };
  }
  if (
    !tenant.accessEndsAt &&
    tenant.trialEndsAt &&
    tenant.trialEndsAt.getTime() <= now.getTime()
  ) {
    return { allowed: false, reason: "The trial has ended and no card was charged." };
  }
  return { allowed: true, reason: null };
}
