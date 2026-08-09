-- FirstKnock Phase 1: the data spine.
-- BUILD_SPEC section 2 is the model of record.
--
-- Key separation enforced here: `events` and `sources` are global facts with no
-- tenant column. `leads` are the per-tenant interpretation of those facts, so two
-- tenants watching the same county each get their own scored lead from one event.

create extension if not exists pgcrypto;

-- Fixed vocabularies from the spec. Adding a value is a migration, not a config
-- change, which is deliberate: the scoring presets key off these names.
create type event_type as enum (
  'LIS_PENDENS',
  'JUDGMENT',
  'NOTICE_OF_SALE',
  'TAX_DELINQUENT',
  'PERMIT',
  'SALE',
  'HOA_REGISTRATION',
  'FIRE_INCIDENT'
);

create type member_role as enum ('owner', 'member');
create type tenant_plan as enum ('solo', 'pro', 'team');
create type source_health as enum ('healthy', 'degraded', 'failing');
create type lead_status as enum ('new', 'contacted', 'responded', 'won', 'lost', 'skip');
create type outreach_channel as enum ('email_draft', 'letter', 'door', 'call', 'sms_link');
create type outreach_state as enum ('drafted', 'sent', 'delivered');

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan tenant_plan not null default 'solo',
  -- Cloned from the vertical preset at onboarding, editable per tenant after.
  vertical_preset_id text not null,
  score_weights jsonb not null default '{}'::jsonb,
  -- County FIPS codes, five characters, e.g. 17031 for Cook.
  counties text[] not null default '{}',
  -- Tenant level knob: towns excluded from scoring regardless of county.
  excluded_towns text[] not null default '{}',
  service_area_lat double precision,
  service_area_lng double precision,
  service_area_radius_miles numeric(6, 2),
  digest_hour smallint not null default 7 check (digest_hour between 0 and 23),
  digest_timezone text not null default 'America/Chicago',
  -- 'daily' for most partners, 'weekly_monday' for the law firm.
  digest_cadence text not null default 'daily',
  digest_channels text[] not null default '{email}',
  hot_ping_threshold smallint check (hot_ping_threshold between 0 and 100),
  telegram_chat_id text,
  telegram_connect_code text unique,
  compliance_footer text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index members_user_id_idx on members (user_id);
create index members_tenant_id_idx on members (tenant_id);

-- ---------------------------------------------------------------------------
-- Sources and events: global, never tenant scoped
-- ---------------------------------------------------------------------------

create table sources (
  id uuid primary key default gen_random_uuid(),
  -- Matches CountyAdapter.id in the registry, e.g. il-cook-socrata-sales.
  adapter_id text not null unique,
  fips text not null check (char_length(fips) = 5),
  event_types event_type[] not null,
  enabled boolean not null default true,
  cadence text not null,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  health source_health not null default 'healthy',
  created_at timestamptz not null default now()
);

create index sources_fips_idx on sources (fips);
create index sources_enabled_idx on sources (enabled) where enabled;

create table events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources (id) on delete cascade,
  fips text not null check (char_length(fips) = 5),
  type event_type not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  property_address text,
  property_city text,
  property_state text,
  property_zip text,
  parcel_pin text,
  lat double precision,
  lng double precision,
  property_class text,
  -- [{ role: 'owner' | 'buyer' | 'seller' | 'appellant', name, address? }]
  parties jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  -- Stable natural key from the adapter. Makes re-polling idempotent.
  dedupe_hash text not null unique,
  created_at timestamptz not null default now()
);

create index events_fips_occurred_idx on events (fips, occurred_at desc);
create index events_type_occurred_idx on events (type, occurred_at desc);
create index events_parcel_pin_idx on events (parcel_pin) where parcel_pin is not null;

-- ---------------------------------------------------------------------------
-- Leads and everything hanging off them: tenant scoped
-- ---------------------------------------------------------------------------

create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  status lead_status not null default 'new',
  assigned_to uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One event yields at most one lead per tenant.
  unique (tenant_id, event_id)
);

create index leads_tenant_score_idx on leads (tenant_id, score desc, created_at desc);
create index leads_tenant_status_idx on leads (tenant_id, status);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  name text,
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  -- [{ address, status: 'verified' | 'guessed', checked_at, method }]
  -- The UI reads status off each entry. A guessed email is never shown as verified.
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  -- Every step of the resolution chain, in order. No contact row without one.
  resolution_trail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index contacts_lead_id_idx on contacts (lead_id);

create table outreach (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  channel outreach_channel not null,
  payload jsonb not null default '{}'::jsonb,
  state outreach_state not null default 'drafted',
  cost_cents integer,
  drafted_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);

create index outreach_lead_id_idx on outreach (lead_id);

create table digests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  digest_date date not null,
  lead_ids uuid[] not null default '{}',
  delivered_via text[] not null default '{}',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, digest_date)
);

create index digests_tenant_date_idx on digests (tenant_id, digest_date desc);

-- Reserve before spend, settle after. A reserved row with no settled_at still
-- counts against the monthly cap, so a crashed job cannot overspend silently.
create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  op text not null,
  tokens integer not null default 0,
  dollars numeric(10, 4) not null default 0,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz
);

create index usage_ledger_tenant_reserved_idx on usage_ledger (tenant_id, reserved_at desc);
