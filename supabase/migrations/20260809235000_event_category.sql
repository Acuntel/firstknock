-- The use category an adapter states directly, which the events table had
-- nowhere to put.
--
-- Cook permits carry no assessor class but do say "COMMERCIAL PERMIT" outright,
-- and the Phase 2 adapters normalize that into property.category. Without this
-- column the value survived only in memory: scoring straight from an adapter saw
-- it, and scoring anything read back from the database did not. Mike's commercial
-- permit hot ping depends on it, so it would have worked in tests and gone quiet
-- in production.

create type property_category as enum (
  'residential',
  'multifamily',
  'commercial',
  'industrial',
  'vacant',
  'nonprofit'
);

alter table events
  add column property_category property_category;

comment on column events.property_category is
  'Use type stated by the source itself. Takes precedence over property_class during scoring. Null means the source did not say.';

create index events_category_idx on events (property_category)
  where property_category is not null;
