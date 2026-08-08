# FirstKnock — Build Spec

This is the complete engineering spec. `../MASTER_PROMPT.md` is the same content compressed for an AI coding agent; this document is the human-readable expansion with acceptance criteria. If the two ever disagree, this file wins.

## 1. System overview

```
county sources          worker (Railway)                    app (Vercel)
┌─────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ Socrata API │   │ adapter poll (cron)      │   │ Next.js 15 + TS + Tailwind│
│ ArcGIS API  │──▶│ normalize → events       │──▶│ today view / lead detail  │
│ Treasurer   │   │ score → leads            │   │ kanban-lite / settings    │
│ SOS bulk    │   │ resolve contacts         │   │ sources health            │
│ IMAP alerts │   │ digest + hot pings       │   └──────────────────────────┘
└─────────────┘   │  (Telegram + Resend)     │              │
                  └──────────────────────────┘       Supabase (Postgres,
                                                     RLS multi-tenant, auth)
```

Stack: Next.js 15 + TypeScript + Tailwind on Vercel. Supabase for Postgres, RLS multi-tenancy, and auth. One worker on Railway (Node; BullMQ + Redis, or node-cron if simpler to start). Telegram via grammY, transactional email via Resend, letters via Lob, billing via Stripe. Claude API (claude-sonnet-5) through a server-side proxy only, never client-side keys.

## 2. Data model (Supabase, RLS deny-by-default on every tenant-scoped table)

- `tenants` — plan, vertical preset id, counties[], service-area geo (lat/lng + radius), digest hour + channels, stripe customer/subscription ids
- `members` — tenant users, role owner|member
- `sources` — adapter id, county FIPS, event types, enabled, cadence, last_run_at, consecutive_failures, health
- `events` — normalized: source id, county, type, occurred_at, ingested_at, property (address, parcel PIN, lat/lng, class), parties[], raw jsonb, `dedupe_hash` UNIQUE
- `leads` — event_id, tenant_id, score 0-100, score_breakdown jsonb, status new|contacted|responded|won|lost|skip, assigned_to
- `contacts` — lead_id, name, mailing address, emails[] with per-email verification status, phones[], resolution_trail jsonb
- `outreach` — lead_id, channel email_draft|letter|door|call|sms_link, payload, state drafted|sent|delivered, cost_cents (letters), timestamps
- `digests` — tenant_id, date, lead_ids[], delivered_via, delivered_at
- `usage_ledger` — tenant_id, op, tokens, dollars, reserved_at/settled_at (reserve-before-spend, hard monthly cap per plan)

Key separation: `events` are global facts ingested once. `leads` are per-tenant interpretations of those facts (two tenants in the same county each get their own scored lead from one event). Never store tenant data on `events`.

## 3. The adapter contract (the moat)

```ts
type EventType =
  | "LIS_PENDENS"
  | "JUDGMENT"
  | "NOTICE_OF_SALE"
  | "TAX_DELINQUENT"
  | "PERMIT"
  | "SALE"
  | "HOA_REGISTRATION"
  | "FIRE_INCIDENT";

interface CountyAdapter {
  id: string; // "il-cook-socrata-lispendens"
  fips: string; // "17031"
  eventTypes: EventType[];
  cadence: string; // cron expression
  fetch(since: Date): Promise<RawRecord[]>;
  normalize(r: RawRecord): PropertyEvent | null; // null = discard
}
```

Rules:

- Registry keyed by FIPS (mirrors the `property-intel` design).
- Adapters are pure and testable: fixture file in, normalized events out. Every adapter ships with a fixture test. No adapter merges without one.
- One generic **IMAP alert ingester** adapter lets any tenant pipe an alert-email feed they already pay for (e.g. a fire-alert service) into the same scoring pipeline. This is also the escape hatch for counties with no API.

### V1 adapters (Illinois first, where the domain knowledge already exists)

1. Cook County Socrata: sales, permits, assessment appeals, plus the 5-dataset owner/tax join
2. DuPage County ArcGIS parcel/records
3. Will County treasurer API (delinquency)
4. IL SOS corporation bulk file (new HOA/condo registrations; fixed-width parser)
5. Generic IMAP alert ingester

## 4. Scoring engine

Deterministic, no LLM in the scoring path (LLMs write prose, not numbers). Per-vertical weight config stored as jsonb on the tenant, cloned from the vertical preset at onboarding, editable later.

Inputs: event-type severity, freshness decay (hours-based and steep: a 3-day-old lis pendens is worth much less than a 3-hour-old one), value gap (assessed value vs last sale where data exists), property-class fit for the vertical, distance from tenant service area.

Output: 0-100 plus a stored `score_breakdown` so the UI can explain every score. Acceptance: given the same event and config, the score is bit-identical across runs.

## 5. Contact resolution

Chain, stop on first success, record every step in `resolution_trail`:

1. Owner name + mailing address from the county record itself
2. Free reverse-lookup passes for email/phone candidates
3. Email verification before display: syntax, MX, SMTP RCPT probe, MS365 GetCredentialType check

Every email is labeled `verified` or `guessed` in the UI. Never display a guessed email as verified. Acceptance: no contact row without a trail.

## 6. Action layer (draft-first, always)

- **Email**: Claude-personalized draft referencing the specific event; lands as a Gmail draft via the tenant's connected account, or copy-to-clipboard fallback. NEVER auto-send in V1.
- **Letter**: Lob API with a per-vertical template, cost shown before confirm.
- **Door/call**: generated script referencing the event, plus a printable route sheet of the day's top N sorted by drive order.
- **sms:** links only (no SMS API in V1, TCPA caution).
- Compliance posture baked in: a human initiates every contact, CAN-SPAM identity + unsubscribe on email templates, no auto-dialer, no cold SMS.

## 7. Delivery

- Daily digest at tenant-configured hour, Telegram and/or email: top N leads with score, map pin, one-tap actions.
- Hot pings: any lead scoring at or above the tenant threshold fires immediately.
- Web app: today view, lead detail (score breakdown + contact trail), kanban-lite (5 statuses, drag), sources health page, settings.

## 8. Billing (Stripe)

Tiers: Solo $149/mo (1 county, 1 vertical, digest only) · Pro $299/mo (3 counties, hot pings, letters, email drafts) · Team $499/mo (unlimited in-state counties, 5 seats, CSV/API export). 14-day trial, card required. Stripe Checkout + customer portal + webhooks (`checkout.session.completed`, `customer.subscription.deleted`). Webhooks are non-negotiable in V1. AI spend metered per tenant in `usage_ledger` with a hard monthly cap per tier.

## 9. Build order (each phase ends runnable, tested, committed)

| Phase         | Deliverable                                                           | Acceptance criteria                                                                                                                             |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Data spine | Supabase schema + RLS + adapter registry + Cook Socrata adapter       | RLS deny-by-default proven by a test that tries cross-tenant reads; adapter fixture test green; events land in `events` from a local worker run |
| 2. Leads      | Scoring engine + presets, dedupe, lead list/detail UI, kanban-lite    | Same event + config = identical score; dedupe_hash blocks duplicates; UI explains every score                                                   |
| 3. Delivery   | Digest engine (Telegram + Resend), hot pings, sources health          | A test tenant receives a real digest at the configured hour; a high-score event pings within one worker cycle                                   |
| 4. Action     | Contact chain, email drafts, Lob letters, scripts + route sheet       | Every displayed email labeled verified/guessed with a trail; letter shows cost before send                                                      |
| 5. Money      | Stripe tiers + webhooks + trial gating, usage caps, onboarding wizard | New signup reaches first digest in under 10 minutes; cancel via portal downgrades access same day                                               |
| 6. Ship       | Landing page, seeded demo tenant, deploys                             | `npx tsc --noEmit` clean; all tests green; app on Vercel + worker on Railway; landing explains the loop in three steps                          |

## 10. What to reuse vs rebuild

Reuse code (Brady's own IP):

- `~/Desktop/property-intel` — county adapter registry, Cook Socrata 5-dataset join, DuPage ArcGIS, FIPS keying, export
- `Acuntel/il-association-leads` — IL SOS fixed-width bulk parser
- `~/Desktop/HIGH TICKET EMAIL BOT` — 3-layer email verifier
- `~/dev/nessotalk` — Stripe checkout + license/entitlement pattern, server-side AI proxy pattern

Rebuild fresh from pattern knowledge only (client-owned code, do not copy): fire-alert scoring, digest cadence + hot-ping UX, kanban stage gates, RLS test discipline, 30/60/90 foreclosure staging.

## 11. Env vars

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (worker only), `ANTHROPIC_API_KEY` (server only), `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `LOB_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REDIS_URL` (if BullMQ). No secrets in the repo, ever.

## 12. Non-goals for V1

National coverage, paid data sources, auto-send email, SMS/dialer, mobile apps, white-label, more than one state. Each is a V2 conversation with revenue behind it.

## 13. Verification bar

TypeScript clean (`npx tsc --noEmit`), adapter fixture tests + RLS tests + scoring unit tests green, no console.log in production paths, files under 300 lines, layout smoke on landing + app shell before any deploy.
