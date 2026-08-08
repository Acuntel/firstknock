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
| `wyatt/START_HERE.md`      | Wyatt's onboarding: read order, working agreement, accounts needed                                                                   | Wyatt 1    |
| `wyatt/DESIGN_PARTNERS.md` | The 5 real first customers V1 is scoped to, with their tenant configs                                                                | Wyatt 2    |
| `wyatt/AGENT_DIRECTIVE.md` | Paste-ready phase prompts for Wyatt's Claude agent                                                                                   | Wyatt 3    |
| `wyatt/TELEGRAM_SETUP.md`  | BotFather to production wiring, connect flow, gotchas                                                                                | Wyatt 4    |
| `wyatt/EMAIL_BOT_SAUCE.md` | The outreach-bot recipe: architecture, filters, ops rhythm, agent prompt                                                             | Wyatt 5    |

## Current status (August 2026)

- Product is at spec stage: no application code in this repo yet. The spec is complete enough to start Phase 1 today.
- A first outreach campaign ran against the thesis: cold-email drafts to named decision makers at restoration, investor, roofing, and law-firm companies nationally (10 drafted so far, campaign paused). Early interest replies will become design partners.
- Warm first-tenant candidates already exist from Brady's client network in all four verticals.

## Ground rules

- **IP hygiene:** reuse code only from Brady's own repos (listed in `BUILD_SPEC.md`). Patterns learned from client work get rebuilt fresh, never copied.
- **Copy rules for anything user-facing:** no em dashes or en dashes anywhere, use periods, commas, colons. Full explanatory sentences, never clipped fragments. High-contrast text. No hype adjectives.
- **No secrets in this repo.** Env vars documented in `BUILD_SPEC.md`, values live in `.env` locally and in Vercel/Railway/Supabase dashboards only.
