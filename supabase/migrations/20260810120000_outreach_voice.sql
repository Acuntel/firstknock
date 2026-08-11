-- Phase 4 outreach. Three fields the action layer needs and the tenants table
-- had nowhere to put.

-- 1. The voice the email generator mimics.
--
-- CUSTOMIZATION.md section 4 lists outreach voice as a per-client knob: a
-- signature block, company boilerplate, and "a tone sample the email generator
-- mimics". Without a sample every tenant's drafts read the same, which is the
-- opposite of the point.
alter table tenants
  add column outreach_voice_sample text,
  add column outreach_signature text;

comment on column tenants.outreach_voice_sample is
  'A short piece of the tenant''s own writing. Shown to the model as tone reference, never copied verbatim.';

-- 2. CAN-SPAM identity.
--
-- BUILD_SPEC section 6 requires CAN-SPAM identity on email templates, and the
-- law is specific: a valid physical postal address. Folding it into the free
-- text compliance footer makes it something a tenant can quietly omit, so it
-- gets its own column and the draft builder refuses without it.
alter table tenants
  add column postal_address text;

comment on column tenants.postal_address is
  'Physical mailing address required by CAN-SPAM on every outreach email. Drafts are refused without it.';
