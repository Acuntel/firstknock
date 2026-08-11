import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminDb, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * The Stripe webhook. Non-negotiable in V1 per BUILD_SPEC section 8.
 *
 * This, not the success redirect, is what grants and revokes access. A user can
 * open the success URL without ever paying, and Stripe often confirms a payment
 * after the browser has already been redirected, so the redirect is a courtesy
 * and this is the truth.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json({ error: "Unsigned request." }, { status: 400 });
  }

  // The raw body, not the parsed one. Any re-serialization changes the bytes
  // and the signature will not verify.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (error) {
    // A bad signature means this did not come from Stripe. Nothing is written.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bad signature." },
      { status: 400 },
    );
  }

  const db = adminDb();

  // Stripe retries until it gets a 2xx and can deliver the same event twice
  // regardless. Recording the id first makes a replay a no-op rather than a
  // second subscription extension.
  const { error: seenError } = await db
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });

  if (seenError) {
    // A duplicate key is the expected path for a retry, not a failure. Anything
    // else is real and should make Stripe retry, so it is surfaced as a 500.
    if (seenError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: seenError.message }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(db, event.data.object);
        break;
      case "customer.subscription.updated":
        await onSubscriptionUpdated(db, event.data.object);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(db, event.data.object);
        break;
      default:
        // Acknowledged and ignored. Returning an error for an event we do not
        // handle would make Stripe retry it forever.
        break;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Handler failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

async function onCheckoutCompleted(
  db: ReturnType<typeof adminDb>,
  session: Stripe.Checkout.Session,
) {
  const tenantId = session.metadata?.tenantId;
  const plan = session.metadata?.plan;
  if (!tenantId || !plan) return;

  const { error } = await db
    .from("tenants")
    .update({
      plan,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
      stripe_subscription_id:
        typeof session.subscription === "string" ? session.subscription : null,
      subscription_status: "trialing",
      // Cleared on purpose: a tenant who has just paid has no scheduled end.
      access_ends_at: null,
    })
    .eq("id", tenantId);

  if (error) throw new Error(`Could not activate tenant: ${error.message}`);
}

async function onSubscriptionUpdated(
  db: ReturnType<typeof adminDb>,
  subscription: Stripe.Subscription,
) {
  const status = subscription.status;
  const mapped =
    status === "trialing" || status === "active" || status === "past_due"
      ? status
      : "canceled";

  const { error } = await db
    .from("tenants")
    .update({
      subscription_status: mapped,
      // Set when the customer cancels but the period is still running. This is
      // what lets access continue through what they already paid for.
      access_ends_at: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000).toISOString()
        : null,
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) throw new Error(`Could not update subscription: ${error.message}`);
}

async function onSubscriptionDeleted(
  db: ReturnType<typeof adminDb>,
  subscription: Stripe.Subscription,
) {
  const { error } = await db
    .from("tenants")
    .update({
      subscription_status: "canceled",
      access_ends_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) throw new Error(`Could not cancel subscription: ${error.message}`);
}
