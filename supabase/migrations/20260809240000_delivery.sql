-- Phase 3 delivery. Four gaps the connect flow in ben/TELEGRAM_SETUP.md and the
-- command list imply, none of which the Phase 1 tables could express.

-- 1. Connect codes have to expire.
--
-- TELEGRAM_SETUP.md calls for "a short-lived random code tied to the tenant".
-- The seed originally reused a stable code per tenant, which is a real weakness:
-- anyone who learns it can point their own chat at that tenant and start
-- receiving its leads. Codes are now minted on demand from settings and expire.
alter table tenants
  add column telegram_connect_expires_at timestamptz;

comment on column tenants.telegram_connect_code is
  'Single use Telegram deep link payload. Cleared once a chat connects.';

-- 2. Seeding needs its own stable key.
--
-- With connect codes now short lived, the tenant seed cannot match rows on them.
-- This identifies a fixture seeded tenant so re-running the seed updates the same
-- row instead of creating a parallel set. Real tenants created through onboarding
-- leave it null.
alter table tenants
  add column fixture_key text unique;

-- 3. /pause 7d needs somewhere to record the mute.
alter table tenants
  add column digest_paused_until timestamptz;

-- 3b. Email digests need a recipient.
--
-- digest_channels could already say "email" with nowhere to send it. Members
-- carry addresses through auth.users, but a tenant can be configured and
-- receiving digests before anyone has signed in, and REAL Law is email only.
alter table tenants
  add column digest_email text;

-- 4. A hot ping must fire once, not on every worker cycle.
--
-- The digests table gives daily sends idempotency through its unique key, but a
-- hot ping is per lead and fires between digests. Without this, a lead sitting
-- above the threshold would ping on every single run of the worker.
alter table leads
  add column hot_pinged_at timestamptz;

create index leads_hot_ping_pending_idx
  on leads (tenant_id, score desc)
  where hot_pinged_at is null;
