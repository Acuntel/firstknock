-- Phase 6 billing. The tenants table already carries the Stripe customer and
-- subscription ids and a trial end; these are the fields the webhook writes.

-- When access actually stops.
--
-- Distinct from trial_ends_at. A tenant who cancels keeps what they paid for
-- until the period ends, so the webhook records that date here rather than
-- cutting them off the moment they click cancel. Null means active with no end
-- scheduled.
alter table tenants
  add column access_ends_at timestamptz,
  add column subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled'));

comment on column tenants.access_ends_at is
  'When paid access stops. Set by the Stripe webhook on cancellation. Null means no end scheduled.';

-- Idempotency for webhook delivery.
--
-- Stripe retries a webhook until it gets a 2xx, and can deliver the same event
-- more than once regardless. Without this a retried checkout.session.completed
-- would extend a subscription twice.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table stripe_events enable row level security;
revoke all on stripe_events from anon, authenticated;

comment on table stripe_events is
  'Every Stripe event id already processed. Written by the webhook, read to reject replays. Service role only.';

create index tenants_stripe_customer_idx on tenants (stripe_customer_id)
  where stripe_customer_id is not null;
