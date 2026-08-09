# FirstKnock

**Know first. Knock first.**

FirstKnock is a subscription tool for local service businesses that watches county public records (foreclosure filings, tax delinquencies, building permits, fire incidents, property sales, HOA registrations) and turns each new filing into a scored lead with the owner's contact info attached. Every morning the operator gets a digest of the top leads in their counties, with one-click ways to act: a personalized email draft, a mailed letter, or a door-knock script.

The pitch in one line: it tells you who in your county needs your service today, before your competitors know.

## Why this exists

Brady has built this exact loop five separate times as one-off client projects: a distressed-property tracker for an investor, a foreclosure pipeline for another, a fire-alert lead engine for a restoration franchise, an HOA lead extractor for law firms, and county-data recipes for a moving company. Same shape every time: public-record event, score it, find the owner, digest it, reach out. FirstKnock makes it one product sold at $149 to $499 a month instead of a rebuild per client.

## Market position

The market exists in fragments, which is the opportunity: PropStream and BatchLeads serve investors only. HailTrace serves roofing storm data only. Perch serves restoration fire alerts only. Dodge serves permits at enterprise prices. Nobody is multi-vertical, nobody bundles the outreach layer, and everybody goes national-first because county-by-county adapter work is unglamorous. The adapter library IS the moat: it compounds with every customer, and it is exactly the grind venture-backed teams skip.

Launch verticals (each is a config preset, not a fork):

1. **Restoration contractors** — fire/water losses, repair permits
2. **Real estate investors** — lis pendens, judgments, tax delinquency, probate
3. **Roofers / HVAC** — permits, sales, storm-adjacent filings
4. **Law firms** — new foreclosure filings, HOA/condo registrations needing counsel

## Repo map

| File                       | What it is                                                                                                                           | Read order |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `README.md`                | This file: what and why                                                                                                              | 1          |
| `docs/BUILD_SPEC.md`       | The complete engineering spec: stack, data model, adapter contract, scoring, build phases with acceptance criteria                   | 2          |
| `docs/CUSTOMIZATION.md`    | How the one codebase serves every client: presets, county packs, config vs code                                                      | 3          |
| `MASTER_PROMPT.md`         | The whole build compressed into a single prompt for an AI coding agent. `BUILD_SPEC.md` is the human-readable expansion of this file | 4          |
| `ben/START_HERE.md`      | Ben's onboarding: read order, working agreement, accounts needed                                                                   | Ben 1    |
| `ben/DESIGN_PARTNERS.md` | The 5 real first customers V1 is scoped to, with their tenant configs                                                                | Ben 2    |
| `ben/AGENT_DIRECTIVE.md` | Paste-ready phase prompts for Ben's Claude agent                                                                                   | Ben 3    |
| `ben/TELEGRAM_SETUP.md`  | BotFather to production wiring, connect flow, gotchas                                                                                | Ben 4    |
| `ben/EMAIL_BOT_SAUCE.md` | The outreach-bot recipe: architecture, filters, ops rhythm, agent prompt                                                             | Ben 5    |

| `docs/OPEN_QUESTIONS.md` | Decisions waiting on Brady, with the evidence behind each one | Brady |
| `supabase/migrations/` | Schema and row level security policies | Code |
| `worker/` | Adapter registry, county packs, and the ingest run | Code |

## Current status (August 2026)

- Phase 1 (data spine) is built: schema, RLS, the adapter registry, and the Cook County sales and permits adapters, with 50 tests covering them. Both adapters pull live data from the county API. Nothing has run against a real Supabase project yet because there is no project to point at. See `docs/OPEN_QUESTIONS.md`.
- A first outreach campaign ran against the thesis: cold-email drafts to named decision makers at restoration, investor, roofing, and law-firm companies nationally (10 drafted so far, campaign paused). Early interest replies will become design partners.
- Warm first-tenant candidates already exist from Brady's client network in all four verticals.

## Running it locally

Requires Node 20 or newer and pnpm.

```bash
pnpm install
pnpm test        # 50 tests, no network and no database needed
pnpm typecheck
```

The test suite runs the migrations against an in-process Postgres, so the row level
security policies are exercised for real without Docker or a Supabase project.

Once a Supabase project exists, copy `env.example` to `.env`, apply the migrations in
`supabase/migrations/`, then:

```bash
pnpm worker:seed-sources   # one sources row per registered adapter
pnpm worker:once           # poll every enabled source once
```

Running `pnpm worker:once` twice inserts zero duplicate events. That is the property
the dedupe hash exists to guarantee, and `worker/tests/ingest-idempotency.test.ts`
holds it in place.

## Ground rules

- **IP hygiene:** reuse code only from Brady's own repos (listed in `BUILD_SPEC.md`). Patterns learned from client work get rebuilt fresh, never copied.
- **Copy rules for anything user-facing:** no em dashes or en dashes anywhere, use periods, commas, colons. Full explanatory sentences, never clipped fragments. High-contrast text. No hype adjectives.
- **No secrets in this repo.** Env vars documented in `BUILD_SPEC.md`, values live in `.env` locally and in Vercel/Railway/Supabase dashboards only.
