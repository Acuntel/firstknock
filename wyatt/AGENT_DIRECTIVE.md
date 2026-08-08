# Directions for Wyatt's Claude Agent

This file is a set of paste-ready prompts. Open Claude Code in the repo, paste the preamble once, then run the phase prompts in order. Do not skip phases and do not let the agent "improve" the architecture; the spec is the spec.

## Preamble (paste this first, once per session)

```
You are building FirstKnock V1. The spec of record is docs/BUILD_SPEC.md and the
scope of record is wyatt/DESIGN_PARTNERS.md: five specific tenants, four vertical
presets, seven county adapters. Read both before writing any code.

Hard rules:
- Follow the data model, adapter contract, and phase order in BUILD_SPEC.md exactly.
  If you believe something should change, STOP and output the proposal instead of code.
- Every tenant-scoped table gets a Supabase RLS deny-by-default policy, proven by a
  test that attempts a cross-tenant read and fails.
- Adapters are pure functions with fixture tests: fixture file in, normalized events
  out. No adapter is done without a fixture test.
- No LLM calls in the scoring path. Scoring is deterministic and bit-identical for
  the same event + config.
- Claude API calls (email drafts, scripts) go through one server-side module with
  per-tenant metering into usage_ledger. Model: claude-sonnet-5. Never expose keys
  client-side.
- User-facing copy: no em dashes or en dashes anywhere, use periods, commas, colons.
  Full sentences. No hype adjectives.
- TypeScript strict. Files under 300 lines. No console.log in production paths.
- End every phase: npx tsc --noEmit clean, all tests green, committed.
```

## Phase 1 — Data spine

```
Build Phase 1 from docs/BUILD_SPEC.md: Supabase schema + RLS + adapter registry +
the Cook County Socrata adapter.

Deliverables:
1. supabase/migrations: all tables from BUILD_SPEC section 2, RLS deny-by-default,
   plus the RLS cross-tenant test.
2. worker/: adapter registry keyed by FIPS implementing the CountyAdapter interface
   from BUILD_SPEC section 3.
3. The Cook County Socrata adapter (sales, permits, appeals event types) with a
   fixture test built from a real API response saved to fixtures/.
4. A runnable `pnpm worker:once` that polls enabled sources and inserts normalized
   events with dedupe_hash uniqueness.

Acceptance: running worker:once twice inserts zero duplicate events; RLS test fails
closed; fixture test green.
```

## Phase 2 — Leads and scoring

```
Build Phase 2: scoring engine + the four vertical presets + lead UI.

1. presets/: restoration.json, investors.json, roofing.json, lawfirms.json per the
   shape in docs/CUSTOMIZATION.md section 2. Include a tenant-level town-exclusion
   list (one design partner excludes the town of Bellwood IL).
2. Scoring per BUILD_SPEC section 4, with score_breakdown stored. Investors preset
   needs foreclosure-stage awareness (days-to-sale windows: 30/60/90).
3. Next.js app shell: today view (leads ranked), lead detail with score breakdown,
   kanban-lite (new/contacted/responded/won/lost), settings reading the tenant row.
4. Seed script: create the five design-partner tenants from wyatt/DESIGN_PARTNERS.md
   as fixtures with their counties, presets, and weight overrides.

Acceptance: same event scores identically across runs; each of the 5 seeded tenants
sees a differently-scored lead list from the same Cook County fixture events.
```

## Phase 3 — Delivery (Telegram + email digests)

```
Build Phase 3: digest engine and hot pings. Telegram wiring instructions are in
wyatt/TELEGRAM_SETUP.md; follow its connect flow exactly (deep-link /start with a
tenant code, chat_id stored on the tenant).

1. grammY bot in the worker: /start <code> connects a chat to a tenant; /leads
   replies with today's top 5.
2. Digest job at each tenant's configured hour and cadence (daily for most, weekly
   Monday for the law-firm tenant): top N leads, score, address, one-line why, deep
   link into the app. Telegram and/or Resend email per tenant config.
3. Hot pings: leads at or above tenant threshold send within one worker cycle.
4. Sources health page: last run, consecutive failures, per adapter.

Acceptance: a seeded tenant receives a real Telegram digest from fixture data; a
fabricated 95-score event pings inside one cycle; digest cadence respects the
weekly setting.
```

## Phase 4 — Contacts and actions

```
Build Phase 4: contact resolution + the action layer, per BUILD_SPEC sections 5-6.

1. Resolution chain with resolution_trail, and verification labeling: an email is
   verified only after MX + SMTP RCPT probe pass; otherwise it displays as guessed.
2. Email draft generation (Claude, tenant voice sample + compliance footer from the
   tenant row), delivered as .eml download AND copy-to-clipboard in V1 (Gmail
   OAuth connect is V2; do not build it).
3. Lob letter flow with per-vertical letter templates and cost confirmation.
   The law-firm template must include the tenant compliance footer.
4. Door/call script generation + printable route sheet of today's top N.

Acceptance: no contact without a trail; no guessed email ever labeled verified;
letter flow shows cost before confirm; law-firm letters carry the disclaimer.
```

## Phase 5 — Remaining adapters

```
Build the remaining county packs in this order, each with fixture tests:
1. DuPage County IL (ArcGIS)
2. Will County IL (treasurer delinquency)
3. IL Secretary of State corporation bulk file (HOA/condo registrations; it is a
   fixed-width format, parse defensively)
4. Generic IMAP alert ingester (any tenant can pipe an alert-email feed; parse
   with a per-source regex config, never hardcode one provider)
5. Wayne County MI (permits)
6. Winnebago + Boone IL foreclosure stages (lis pendens, judgment, notice of sale;
   hardest pack, stage field feeds the investors preset windows)

Acceptance: all 7 adapters registered by FIPS with green fixture tests; the 5
seeded tenants each have live sources covering their DESIGN_PARTNERS.md counties.
```

## Phase 6 — Money and ship

```
Build Phase 6 per BUILD_SPEC sections 8-9: Stripe tiers with webhooks (webhooks are
non-negotiable), 14-day trial with card, usage_ledger hard caps, the 10-minute
onboarding wizard (vertical, counties, Telegram connect, first digest), landing page
(headline "Know first. Knock first.", the loop in three steps, no em dashes), seeded
demo tenant, deploy app to Vercel and worker to Railway.

Acceptance: a fresh signup reaches a first digest in under 10 minutes; canceling in
the Stripe portal downgrades same day; tsc clean; all tests green; both deploys live.
```

## When the agent finishes each phase

Wyatt: skim the diff, run the acceptance checks yourself (do not trust "done"),
commit, then send Brady a one-paragraph update: what shipped, what surprised you,
what's next.
