# Ben: What Is Left For You

Everything in this file needs a human. Code is not the blocker on any of it.

Ordered by what unblocks the most. The first two take about fifteen minutes
together and are the difference between a database full of leads and five
partners actually receiving them.

Current state, verified against the live database rather than assumed:

| | |
| --- | --- |
| Events ingested | 7,872 from Cook County IL and Detroit MI |
| Leads scored | 7,551 across the five partners |
| Partners who can receive a digest | 0, because no Telegram chat is connected and no email is set |

That last row is the whole point of the list below.

## 1. Sign in to the app

Your account already exists and owns all five tenants. Sign in links are minted
locally, so this does not wait on email working:

```
cd ~/firstknock
pnpm --filter worker invite benshpritz@icloud.com all
```

It prints a link. Open it. You land on Today with real Cook County leads and no
fixture banner. The same command onboards anyone else, and it is safe to re-run
because it reuses an existing account rather than creating a second one.

The app needs to be running: `pnpm --filter app dev`, then localhost:3000. If
you use a different port, set `APP_URL` in `.env` first so the link matches.

Signed out, every page falls back to Cook County fixtures and says so in a
banner. That is deliberate. Row level security refuses anonymous reads, and a
page quietly showing sample data while claiming to be live is the worst
outcome available.

## 2. Connect Telegram for each partner

This is the one that unblocks delivery. Every tenant currently has a null chat
id, so the digest has nowhere to go.

Start the bot in one terminal and leave it running:

```
pnpm --filter worker bot
```

In another, mint the links:

```
pnpm --filter worker connect all
```

You get one `https://t.me/firstNtwo_bot?start=...` link per partner. Send each
person their own link. They tap Start and they are connected. Codes are single
use and expire in thirty minutes, so a link forwarded around later does not
hand someone else's leads to a stranger.

Connect your own first and check that a digest looks right before sending any
to Brady's clients.

Note the bot is the development one. `@firstNtwo_bot` is fine for you and for
testing. Decide with Brady what the production bot is called before real
customers see it, because the name is on every message they receive.

## 3. Resend, so email digests can send

Three of the five partners have email in their digest channels. Without a key
those digests are silently undeliverable.

Sign up at resend.com, verify a sending domain, then in `.env`:

```
RESEND_API_KEY=re_...
RESEND_FROM=digests@yourdomain
DIGEST_TEST_EMAIL=benshpritz@icloud.com
```

Then collect the five partners' preferred addresses from Brady and set each
tenant's `digest_email`. They are all blank right now.

## 4. The decision only Brady can make

This blocks Phase 5 and it is not a coding problem. Four of the seven county
packs have no public data source. I checked each portal rather than assuming:

- DuPage IL publishes a live ArcGIS parcel layer with 86 fields and not one
  date. A parcel layer is a property database, not a feed of things that
  happened, so there is nothing to ingest.
- Will IL publishes no treasurer or delinquency feed on any platform it uses.
- The Illinois Secretary of State bulk endpoints do not respond publicly, and
  REAL Law's HOA registrations depend on them.
- Winnebago and Boone have no source at all, and Z subscribes to both, so he
  has zero events today.

The full survey and three ways forward are in `docs/OPEN_QUESTIONS.md`
question 14. My recommendation is the third: most of these counties will send
alert emails to a subscriber, and the IMAP ingester is already built and tested
for exactly that. It needs one email account and a signup per county. Buying
data is a recurring cost per county before there is revenue, and BUILD_SPEC
section 12 already lists paid sources as a V1 non-goal.

Send Brady that question. Nothing else in Phase 5 moves until it is answered.

## 5. Keys that unlock features already built

None of these are blocking anything today. Each turns on code that is written,
tested, and currently unreachable.

**Anthropic**, for email drafts and door scripts. Brady provisions this. Set
`ANTHROPIC_API_KEY`. Spend is metered per tenant with a hard monthly cap, so a
runaway loop cannot produce a surprise bill.

**Stripe**, for billing. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
Nothing charges anyone until these exist. The webhook records every event id
before handling it, so a retried delivery cannot double charge.

**Lob**, for physical letters. Set `LOB_API_KEY`. Test mode is free and prints
nothing real, which is what you want while checking the flow.

**Socrata**, optional. `SOCRATA_APP_TOKEN` raises Cook County rate limits. The
adapters work without it and have not been throttled yet.

## 6. Deploys

Both need accounts and neither can be created from a terminal.

Vercel hosts the app: `npx vercel` from `app/`, then paste every variable from
`.env` into the project settings. Railway runs the worker on its schedule.
Budget about five dollars a month.

Until then everything runs locally, which is fine for the five partners as long
as your laptop is awake when the digest is due.

## What I would do tonight

Steps 1 and 2, then send Brady question 14. That gets you looking at real leads
in the app, gets one real digest into your own Telegram, and starts the clock on
the one decision with the most work sitting behind it.
