-- Prospects are the people FirstKnock sells to, not the properties it sells.
--
-- Deliberately separate from contacts, which are property owners attached to a
-- lead. Conflating them would be a real hazard: one is a person who might buy a
-- subscription, the other is a homeowner with a code violation, and the two must
-- never end up in the same outreach run.
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),

  company text not null,
  website text,
  city text,
  state text,
  -- The market this prospect buys, so the pitch can quote that county's real
  -- numbers rather than a generic claim.
  fips text,

  -- Named people only. An address with no human behind it is not draftable:
  -- addressing a generic inbox by a researched name is worse than no email.
  person_name text,
  person_role text,
  email text,

  -- Mirrors contacts.confidence. Only "verified" is ever draftable, and the
  -- verifier leaves anything it could not fully prove as "guessed".
  email_confidence text not null default 'guessed',

  status text not null default 'new',
  do_not_contact boolean not null default false,
  -- Why they are excluded, so a blanket suppression can be told apart from a
  -- specific person asking to be left alone.
  suppressed_reason text,

  drafted_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,

  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One address is only ever drafted once across the whole campaign. The unique
-- index is what enforces that rather than a check in application code, because
-- two runs racing is exactly when a duplicate gets through.
create unique index if not exists prospects_email_key
  on prospects (lower(email))
  where email is not null;

create index if not exists prospects_status_idx on prospects (status);
create index if not exists prospects_fips_idx on prospects (fips);

-- Prospects belong to the operator, not to a tenant, so there is no tenant_id to
-- scope by and no policy that could make them readable through the app. Row
-- level security stays on with no policy at all, which denies everything: only
-- the worker's service role key, which bypasses RLS, can touch this table.
alter table prospects enable row level security;
