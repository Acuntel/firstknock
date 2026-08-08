# Wyatt: Start Here

Welcome. This folder is your onboarding as the builder. Brady owns product direction, client relationships, and outreach; you own getting V1 running. Everything you need is in this repo, and every doc in this folder is written so you can paste it straight into your own Claude Code agent.

## Read order

1. `../README.md` — what FirstKnock is and why it wins (5 minutes)
2. `../docs/BUILD_SPEC.md` — the engineering spec of record (20 minutes, this is the one to actually study)
3. `DESIGN_PARTNERS.md` — the 5 real first customers V1 is scoped to
4. `AGENT_DIRECTIVE.md` — the exact prompts to give your Claude agent, phase by phase
5. `TELEGRAM_SETUP.md` — bot creation and wiring (needed by Phase 3)
6. `EMAIL_BOT_SAUCE.md` — how Brady's outreach bots work, so you can build your own

## The one-paragraph mission

We are NOT building a general product yet. We are building for five specific operators (four of them already pay Brady for bespoke versions of this loop). V1 is done when all five receive a real morning digest of scored leads from their real counties and can act on a lead in one click. Everything that does not serve those five is out of scope, no matter how good the idea is.

## Working agreement

- The spec wins. If your agent proposes an architecture change, it goes to Brady first, not into code.
- Every phase ends runnable, tested, committed. No 2,000-line PRs.
- Secrets never touch git. `.env` locally, dashboards in prod.
- Copy rules are law in anything user-facing: no em dashes or en dashes (periods, commas, colons instead), full sentences, no hype.
- When stuck for more than an hour, message Brady instead of thrashing.

## Accounts you will need

Free/cheap to start: GitHub (you're here), Supabase (free tier), Vercel (free), Railway (~$5/mo), Telegram (free), Resend (free tier), Stripe (free until revenue), Anthropic API key (Brady will provision), Lob (test mode free). Brady already owns the domain conversation; don't buy anything.
