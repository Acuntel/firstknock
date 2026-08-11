import { NextResponse } from "next/server";
import { PLANS, TRIAL_DAYS, planFor } from "@firstknock/worker/billing/plans";
import { appUrl, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Starts a subscription.
 *
 * A card is required even for the trial, per BUILD_SPEC section 8. That is a
 * deliberate filter: a trial without a card fills the pipeline with people who
 * were never going to pay, and every one of them still costs county API calls
 * and AI spend.
 *
 * Prices are created inline from the plan table rather than referencing Stripe
 * price ids, so tiers live in one place in this repo instead of being split
 * between code and a dashboard someone forgets to update.
 */
export async function POST(request: Request) {
  let body: { plan?: string; email?: string; tenantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body.plan || !(body.plan in PLANS)) {
    return NextResponse.json(
      { error: `Pick one of: ${Object.keys(PLANS).join(", ")}.` },
      { status: 400 },
    );
  }

  const plan = planFor(body.plan);

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: body.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: plan.monthlyCents,
            recurring: { interval: "month" },
            product_data: {
              name: `FirstKnock ${plan.label}`,
              description:
                plan.maxCounties === null
                  ? `Unlimited counties in one state, ${plan.maxSeats} seats.`
                  : `${plan.maxCounties} ${plan.maxCounties === 1 ? "county" : "counties"}, ${plan.maxSeats} ${plan.maxSeats === 1 ? "seat" : "seats"}.`,
            },
          },
        },
      ],
      subscription_data: { trial_period_days: TRIAL_DAYS },
      // Required even during the trial, so the card is on file when it ends.
      payment_method_collection: "always",
      // Carried through to the webhook, which is where the tenant is actually
      // updated. The success redirect is not trusted for that: a user can hit
      // it without paying, and Stripe may confirm after the redirect.
      metadata: { plan: plan.id, tenantId: body.tenantId ?? "" },
      success_url: `${appUrl()}/onboarding?checkout=done`,
      cancel_url: `${appUrl()}/?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start checkout." },
      { status: 502 },
    );
  }
}
