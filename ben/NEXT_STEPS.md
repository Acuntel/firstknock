# Ben: What Is Left For You

Illinois is out. The markets are Wisconsin, Michigan, and upstate New York.

## 1. Run one line of SQL

Open your Supabase SQL Editor, paste the contents of
`supabase/migrations/20260812060000_prospects.sql`, and Run.

It creates the table that holds the flippers you email. The worker's key is not
allowed to make schema changes, on purpose, so this is the one thing it cannot
do itself. Until it is applied, `pnpm --filter worker prospect` cannot store
anyone.

## 2. Three env values for the email bot

The bot writes drafts into your own Gmail and never sends. You read each one and
hit send yourself.

```
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=          # myaccount.google.com/apppasswords, NOT your password
PROSPECT_SENDER_NAME=Ben Shpritz
PROSPECT_POSTAL_ADDRESS=1 Example St, Chicago IL 60601
```

The postal address is not optional. Commercial email in the United States has to
carry a real one, and the opt out line has to work. Both are built in.

## 3. Nothing else is blocking

## What you have now

Four live markets, all ingesting on their own.

| Market | What it gives you | Freshness |
| --- | --- | --- |
| Milwaukee, WI | 18,719 delinquent tax accounts, all with owner name and mailing address. Plus the vacant building registry. | Every few days |
| Buffalo, NY | 4,204 open code enforcement cases, with the state property class on each | Every couple of weeks |
| Syracuse, NY | Code violations with owner name, mailing address, and a vacancy marker | Daily |
| Detroit, MI | Building permits | Daily |

Milwaukee and Syracuse are the two that hand you owner contact details. That is
normally the expensive part of a lead and almost no county publishes it.

## Commands

```
pnpm --filter worker prospect stats        what each market can prove today
pnpm --filter worker prospect draft 10     draft 10 emails, review them in Gmail
pnpm --filter worker prospect suppress a@b.com
```

In Telegram, `/leads` gives you every market at once because your chat is listed
in `OPERATOR_CHAT_IDS`. A customer's chat gets only their own county.

## What I looked at and rejected

I probed 37 cities across the three states. Almost none publish anything usable.

- **Rochester** has a dataset the city literally labels Live. Its server returns
  "service not started" and appears to have been down a long time.
- **Madison** and **Grand Rapids** publish nothing property related at all.
- **Green Bay** publishes parcels and zoning, which is a property database, not
  a feed of things happening.
- **Saratoga** publishes nothing. Records come out by written request.
- Most of what a search turns up in these cities is student and consultant
  uploads. One-off snapshots, not feeds anyone maintains.

For the places with nothing, the answer is still the email bridge: most counties
will send alert emails to a subscriber even when they publish no data. The
reader for that is built and tested. It needs an email account and a signup per
county, and it is worth doing once you have paying customers asking for a
specific town.

## The one piece still missing

Discovery. The bot can write to flippers but it cannot yet find them. That needs
a search API and a scraper to pull company sites, names and addresses, then the
existing verifier to prove each address before anything is draftable.

Until then you can add prospects by hand and the whole rest of the chain works.

## Later, not now

**Resend** for email digests to customers, as opposed to prospecting. Free.

**Vercel and Railway** to keep it running when your laptop is closed. About five
dollars a month. Until then your machine has to be awake.

**Anthropic** key is what the prospecting bot writes with, so that one now
matters. **Stripe** for taking money. **Lob** for physical letters.

## Still yours to decide

The market accounts are named "Milwaukee Flippers", "Syracuse Flippers" and
"Buffalo Flippers". They are placeholders. Once you have a real buyer, tell me
who they are and what they want and I will configure them properly.
