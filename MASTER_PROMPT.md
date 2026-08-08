# FIRSTKNOCK — MASTER PROMPT (V1)

One prompt to build a sellable multi-tenant SaaS. Read this whole file before writing code.

## The product

FirstKnock watches public records and tells local service businesses who needs them TODAY, before competitors know. County events (lis pendens, foreclosure judgments, notices of sale, tax delinquency, building permits, property sales, new HOA/condo registrations) become scored leads with resolved contact info, delivered as a daily digest plus instant hot pings, with one-click outreach attached. It is PropStream's data instinct + HailTrace's event instinct + the outreach layer none of them have, priced for a single operator, architected so every new county is an adapter, not a rebuild.

One-liner for the landing page: "Know first. Knock first."

Launch verticals (each is a preset, not a fork): restoration contractors, real-estate investors, roofers/HVAC, law firms (foreclosure defense + HOA/condo counsel).

## Why Brady wins this market

- The county adapter library compounds: every customer funds new adapters, and the fragmented per-county work is exactly what venture-backed competitors skip.
- Five bespoke versions of this loop already exist across his client work; the patterns are proven in production.
- Distribution is warm: an existing franchise operator (restoration), two investor clients, a law-firm client base, and the 22-contact GBR pitch list.

## IP rules (hard constraints)

- REUSE CODE from fully-Brady-owned repos only: `~/Desktop/property-intel` (county adapter registry, Cook Socrata 5-dataset join, DuPage ArcGIS, FIPS keying, JSON/CSV/PDF export), `Acuntel/il-association-leads` (fixed-width SOS bulk parser, headed-Chrome scrape), `~/Desktop/HIGH TICKET EMAIL BOT` (3-layer email verification), `~/dev/nessotalk` (Stripe checkout + license/entitlement pattern, server-side AI proxy pattern).
- REBUILD PATTERNS FRESH (no code lifting) from client-built systems: Restoration One (Telegram intake, digest cadence, kanban-lite, RLS test discipline), Fire Chase (0-100 scoring, door/call scripts, Lob letters, TCPA/CAN-SPAM posture), Vince tracker (value-gap + freshness ranking, 10am digest + hot pings), REDLINE (30/60/90 staging). The patterns are knowledge; the code belongs to clients.

## Architecture

- Next.js 15 + TypeScript + Tailwind, Supabase (Postgres + RLS multi-tenant + auth), Vercel for the app.
- Worker on Railway (Node + BullMQ + Redis, or plain node-cron if simpler): adapter polling, scoring, contact resolution, digest dispatch. ONE worker instance (Telegram polling forbids two).
- Telegram bot per tenant connection (grammY), email via Resend, letters via Lob API, Stripe for billing.
- Claude API (claude-sonnet-5 via server-side proxy, never client-side keys) for: outreach draft personalization, door/call script generation, event summarization. Keep per-tenant AI spend metered in a `usage_ledger` table (reserve-before-spend, hard monthly cap per plan).

## Data model (Supabase, RLS on everything tenant-scoped)

- `tenants` (plan, vertical preset, counties[], stripe ids)
- `members` (tenant users, roles owner/member)
- `sources` (adapter id, county FIPS, type, enabled, last_run, health)
- `events` (normalized: id, source, county, type, occurred_at, ingested_at, property{address, pin, lat/lng}, parties[], raw payload jsonb, dedupe_hash UNIQUE)
- `leads` (event_id, tenant_id, score 0-100, score_breakdown jsonb, status: new|contacted|responded|won|lost|skip, assigned_to)
- `contacts` (lead_id, name, mailing address, emails[] w/ verification status, phones[], resolution_trail jsonb)
- `outreach` (lead_id, channel: email_draft|letter|door|call|sms_link, payload, state: drafted|sent|delivered, timestamps)
- `digests` (tenant_id, date, lead_ids[], delivered_via)
- `usage_ledger` (tenant_id, tokens, dollars, op, reserved/settled)

## The adapter contract (the moat)

```ts
interface CountyAdapter {
  id: string; // "il-cook-socrata-lispendens"
  fips: string; // "17031"
  eventTypes: EventType[]; // LIS_PENDENS | JUDGMENT | NOTICE_OF_SALE | TAX_DELINQUENT | PERMIT | SALE | HOA_REGISTRATION
  cadence: string; // cron expr
  fetch(since: Date): Promise<RawRecord[]>;
  normalize(r: RawRecord): PropertyEvent | null; // null = discard
}
```

Registry keyed by FIPS, mirroring property-intel's design. Adapters are pure and testable: fixture file in, normalized events out. Every adapter ships with a fixture test.

V1 adapters (Illinois first, where all current knowledge lives): Cook County Socrata (sales, permits, appeals + the existing 5-dataset owner/tax join), DuPage ArcGIS, Will County treasurer API, IL SOS corp bulk file (HOA/condo registrations), and one generic IMAP-alert ingester (lets any tenant pipe an alert-email feed they already pay for into the same scoring pipeline).

## Scoring engine

Deterministic, per-vertical weight configs (jsonb on the tenant, editable defaults per preset). Inputs: event type severity, freshness decay (hours-based, steep), value gap (assessed value vs last sale where available), property class fit for the vertical, distance from tenant service area. Output 0-100 with a stored breakdown so the UI can explain every score. No LLM in the scoring path; LLMs write prose, not numbers.

## Contact resolution

Chain (stop on success, record trail): county record owner + mailing address → free reverse lookups → email candidates → verification (syntax, MX, SMTP RCPT probe, MS365 GetCredentialType check, from the High Ticket bot's 3-layer verifier). Store verification status per email; never claim verified when only guessed.

## Action layer (draft-first, always)

- Email: generate personalized draft (Claude), create as Gmail draft via the tenant's connected account or copy-to-clipboard fallback. NEVER auto-send in V1.
- Letter: Lob API, letter template per vertical, one click, show cost before send.
- Door/call: generated script referencing the specific event, printable route sheet for the day's top N.
- sms: links (no SMS API in V1, TCPA caution).
- Compliance posture baked into UI copy: human initiates every contact; CAN-SPAM identity/unsubscribe fields on email templates; no auto-dialer, no cold SMS.

## Delivery

- Daily digest at tenant-configured hour: top N leads with scores, map pins, one-tap actions. Channels: Telegram + email (both, per tenant toggle).
- Hot pings: score ≥ threshold fires instantly.
- Web app: today view, lead detail with score breakdown + contact trail, kanban-lite (5 statuses, drag), sources health page, settings.

## Billing (lift the NessoTalk pattern)

Stripe Checkout + customer portal. Tiers: Solo $149/mo (1 county, 1 vertical, digest only), Pro $299/mo (3 counties, hot pings, letters, email drafts), Team $499/mo (unlimited counties in-state, 5 seats, API export). 14-day trial, card required. Webhook this time (checkout.session.completed, customer.subscription.deleted) — do not repeat the NessoTalk no-webhook gap.

## Copy rules (non-negotiable)

No em dashes or en dashes anywhere in user-facing copy; use periods, commas, colons. Full explanatory sentences, never clipped fragments. High-contrast text. Professional, direct, zero hype.

## Build order (each phase ends runnable + committed)

1. **Skeleton + data spine**: Supabase schema + RLS policies + RLS tests (deny-by-default proven by test), adapter contract + registry, Cook Socrata adapter with fixture test, events flowing into `events` on a local worker run.
2. **Leads**: scoring engine + vertical presets, dedupe, lead list + detail UI, kanban-lite.
3. **Delivery**: digest engine (Telegram + Resend email), hot pings, sources health.
4. **Action**: contact resolution chain, email draft generation, Lob letters, scripts + route sheet.
5. **Money**: Stripe tiers + webhooks + trial gating, usage ledger with hard caps, onboarding wizard (pick vertical → pick counties → connect Telegram → first digest in <10 min).
6. **Ship**: landing page (headline above; the loop explained in three steps; one screenshot per step), seed demo tenant with realistic fixture data, `npx tsc --noEmit` clean, all tests green, deploy app to Vercel + worker to Railway.

## Non-goals for V1 (do not build)

National coverage, paid data sources, auto-send email, SMS/dialer, mobile apps, white-label, more than one state. Every one of these is a V2 conversation with revenue behind it.

## Verification bar

TypeScript clean, adapter fixture tests + RLS tests + scoring unit tests green, no console.log in production paths, files under 300 lines, layout smoke on the landing + app shell before any deploy.
