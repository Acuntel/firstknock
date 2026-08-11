# Ben: What Is Left For You

Illinois is out. The targets are Wisconsin, Michigan, and upstate New York.

Everything below needs a human. Nothing here is waiting on code.

## 1. Run one line of SQL

This is the only thing blocking new leads right now.

Go to your Supabase project, open the SQL Editor, paste this, and hit Run:

```sql
alter type event_type add value if not exists 'CODE_VIOLATION';
```

That is it. Adding a value to a database enum is a schema change, and the API
key the worker holds is not allowed to make schema changes, which is why it
cannot do this itself. Until it is applied, the Syracuse and Milwaukee vacant
building feeds cannot even be switched on.

Once it is done, tell me and I will turn all three new feeds on and score them.

## 2. Tap one Telegram link

Ask me for a fresh one, they expire after 30 minutes. Tap it and leads come to
your phone. Ten seconds.

## 3. Nothing else is blocking

That really is the whole list.

## What the data looks like in your three states

I checked every portal rather than assuming. Most of what these cities publish
is not worth building on, so this is what survived.

**Milwaukee, Wisconsin. The best of the three.**

| Feed | Size | Freshness |
| --- | --- | --- |
| Delinquent property tax | 18,731 accounts, $65.9m owed | Every few days |
| Vacant building registry | 1,655 buildings, 331 added this year | Daily |
| Building permits | 16,685 | Runs about two months behind |

The delinquent tax file is the most saleable thing in this project. Every single
row carries the owner's name and their mailing address, so an investor can post
a letter without hunting for contact details. Almost no county publishes that.

**Syracuse, New York.**

Code violations, 150,707 records, current to yesterday, with the cited owner's
name, their mailing address, and a marker for whether the building is vacant.
859 new violations in the last three weeks, 58 of them on vacant buildings.

Everything else Syracuse publishes is abandoned. Fire incidents and building
permits both stop in December 2019. Permit requests stopped in August 2025.

**Detroit, Michigan.** Already live. Permits, daily.

## What I looked at and rejected

- **Madison** keeps permits behind an Accela portal rather than open data.
- **Green Bay** publishes parcels and zoning, but no feed of things happening.
- **Saratoga** publishes nothing. Records come out by written request only.
- **Skaneateles** is in Onondaga County but outside Syracuse city limits, and
  the violations feed is the city's, so it will not appear.

If you want any of these anyway, the answer is the email bridge: most counties
will send alert emails to a subscriber even when they publish no data, and the
reader for that is already built and tested. It needs an email account and a
signup per county.

## Later, not now

None of these block leads.

**Resend** for email digests as well as Telegram. Free.

**Vercel and Railway** to keep it running when your laptop is closed. About five
dollars a month. Until then it runs locally and your machine has to be awake.

**Anthropic, Stripe, and Lob** keys turn on drafting, billing, and physical
letters. All three are written and unreachable until keyed.

## One thing I need you to decide

The five accounts in the system are Brady's Illinois clients, and every one is
configured for Illinois counties. Right now a Syracuse violation would land in
an account set up for an Illinois roofer.

Tell me who is actually buying these leads and what they want, and I will set
the accounts up properly. Until then the data flows in but it is filed under the
wrong names.
