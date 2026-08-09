-- Paul's configured digest time in DESIGN_PARTNERS.md is 6:30am, which the
-- original tenants table could not represent: it stored an hour and nothing
-- finer. Rounding him to 6:00 or 7:00 would be a product decision made by a
-- schema oversight, so the column gains minutes.
--
-- Defaults to zero, so every existing configuration keeps the time it had.

alter table tenants
  add column digest_minute smallint not null default 0
    check (digest_minute between 0 and 59);

comment on column tenants.digest_minute is
  'Minute of digest_hour. Together they give the tenant local send time.';
