-- FirstKnock Phase 1: row level security, deny by default.
--
-- The posture: enable RLS on every table, then grant back only what a signed in
-- member of a tenant should see. A table with RLS on and no matching policy
-- returns zero rows rather than erroring, which is why the cross tenant test in
-- worker/tests/rls.test.ts asserts on row counts and not on thrown errors.
--
-- The worker uses the service role key, which carries BYPASSRLS. That is the only
-- path that writes events and leads. Nothing client side ever holds that key.

-- Membership lookup used by every policy below. SECURITY DEFINER on purpose: the
-- function reads `members` with RLS suspended, so policies on other tables can ask
-- "which tenants is this user in" without re-entering RLS and recursing.
create or replace function app_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from members where user_id = (select auth.uid());
$$;

revoke execute on function app_tenant_ids() from public, anon;
grant execute on function app_tenant_ids() to authenticated;

-- Same trick one level down, for tables that reach a tenant through `leads`.
create or replace function app_can_access_lead(lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from leads l
    join members m on m.tenant_id = l.tenant_id
    where l.id = lead
      and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function app_can_access_lead(uuid) from public, anon;
grant execute on function app_can_access_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere first, so any table missed below fails closed.
-- ---------------------------------------------------------------------------

alter table tenants enable row level security;
alter table members enable row level security;
alter table sources enable row level security;
alter table events enable row level security;
alter table leads enable row level security;
alter table contacts enable row level security;
alter table outreach enable row level security;
alter table digests enable row level security;
alter table usage_ledger enable row level security;

-- The anon role never reads tenant data. Signed out means no rows, full stop.
revoke all on tenants, members, leads, contacts, outreach, digests, usage_ledger
  from anon;

-- ---------------------------------------------------------------------------
-- Tenant scoped policies
-- ---------------------------------------------------------------------------

create policy tenants_select_own on tenants
  for select to authenticated
  using (id in (select app_tenant_ids()));

-- Settings edits come from the app. Owners only, and the row has to stay theirs.
create policy tenants_update_own on tenants
  for update to authenticated
  using (
    exists (
      select 1 from members m
      where m.tenant_id = tenants.id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
    )
  )
  with check (id in (select app_tenant_ids()));

create policy members_select_own on members
  for select to authenticated
  using (tenant_id in (select app_tenant_ids()));

create policy leads_select_own on leads
  for select to authenticated
  using (tenant_id in (select app_tenant_ids()));

-- Kanban drags and assignment. The with check clause stops a member from moving a
-- lead into a tenant they do not belong to.
create policy leads_update_own on leads
  for update to authenticated
  using (tenant_id in (select app_tenant_ids()))
  with check (tenant_id in (select app_tenant_ids()));

create policy contacts_select_own on contacts
  for select to authenticated
  using (app_can_access_lead(lead_id));

create policy outreach_select_own on outreach
  for select to authenticated
  using (app_can_access_lead(lead_id));

-- Drafting outreach is a user action, so the app writes these directly.
create policy outreach_insert_own on outreach
  for insert to authenticated
  with check (app_can_access_lead(lead_id));

create policy outreach_update_own on outreach
  for update to authenticated
  using (app_can_access_lead(lead_id))
  with check (app_can_access_lead(lead_id));

create policy digests_select_own on digests
  for select to authenticated
  using (tenant_id in (select app_tenant_ids()));

create policy usage_ledger_select_own on usage_ledger
  for select to authenticated
  using (tenant_id in (select app_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Global tables: readable by any signed in user, written only by the worker.
--
-- These carry no tenant column by design (BUILD_SPEC section 2). An event is a
-- public record fact, ingested once, shared by every tenant watching that county.
-- Read access leaks nothing about who else is a customer.
-- ---------------------------------------------------------------------------

create policy sources_select_authenticated on sources
  for select to authenticated
  using (true);

create policy events_select_authenticated on events
  for select to authenticated
  using (true);

-- No insert, update, or delete policy exists for authenticated on any table above
-- beyond the ones written out here. Everything else falls through to deny.
