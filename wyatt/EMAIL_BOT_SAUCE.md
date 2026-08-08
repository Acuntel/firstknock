# The Email Bot Sauce (Wyatt)

How Brady's outreach bots actually work, distilled from ~9 production bots, so you can have your Claude agent build you one for FirstKnock partner recruiting. The whole edge is discipline, not tricks: verified emails only, named people only, human reviews every send.

## The philosophy (this IS the sauce)

1. **Draft-first, always.** The bot NEVER sends. It creates Gmail drafts via IMAP. You read every draft, delete the bad ones, and send the good ones yourself from Gmail's web interface. A human initiating every send keeps quality high, keeps deliverability healthy, and keeps you honest.
2. **100% verified addresses only.** Three layers must all pass before an address is draftable: MX records exist, the address appears on the company's own site, and an SMTP RCPT probe accepts it. Guessed patterns like first.last@ are never drafted.
3. **Named people only.** If research cannot find a real person's name on the company's site, skip the company. And if the mailbox looks like a DIFFERENT person than the one you researched (jsmith@ but you researched Mike), skip it: addressing John's inbox "Hi Mike" is worse than no email.
4. **Locked-structure generation.** The LLM writes exactly two things: the subject line and a 2-sentence opening hook referencing one verified detail from their site. Everything else (the pitch, credentials, pricing, CTA, signature, opt-out line) is a deterministic template. This guarantees every email is on-message and no model hallucination reaches a prospect.
5. **One honest opt-out line.** "If this is not relevant, reply no and I will not email again." And you honor it: any "no" marks do_not_contact forever, any bounce kills the address forever.

## Architecture (six small modules, ~150 lines each)

```
finder.py    search-engine discovery: {vertical term} x {city}, SHUFFLED so you
             get national spread instead of exhausting city #1 first. Skip-list
             kills aggregators, directories, news sites, franchises' corporate HQs.
scraper.py   fetch homepage + about/team/contact subpages, extract emails and
             people (name + role), prefer domain-matched mailboxes, reject
             free-mail (gmail/aol/comcast = too small to buy anyway).
verifier.py  the 3-layer check: MX lookup, found-on-site, SMTP RCPT probe.
research.py  Claude call: given scraped text, return owner_name, services,
             client_base, one VERIFIED hook detail, one-liner. JSON out.
generator.py Claude writes subject + 2-sentence hook (strict rules: no em dashes,
             no exclamation marks, no "Dear", no hype adjectives, under 60 char
             subject). Deterministic body template does the rest.
sender.py    IMAP append to "[Gmail]/Drafts" as multipart/alternative text+html.
             NO images (Gmail strips cid: attachments on web sends, and plain
             professional email converts better with operators anyway).
tracker.py   SQLite: prospects, drafts, responses, bounces. Dedupe across the
             whole campaign: one address is only ever drafted once.
main.py      CLI: `go 50` = discover, verify, research, filter, generate, draft,
             rotating across verticals. Caps: 50/run, 500/day, seconds between
             IMAP appends.
```

Credentials: a Gmail **app password** (myaccount.google.com/apppasswords) in `.env` for IMAP, plus an Anthropic key. Nothing else.

## The named-targeting filter (the newest lesson, learned on this campaign)

After research, before drafting, reject when:

- no `owner_name` found on their site
- free-mail domain (too small to be a buyer)
- company title smells like an aggregator, directory, marketing agency, or blog
- the mailbox local-part looks like a person and does NOT overlap the researched name (accept generic prefixes like info@/office@ since the email opens with the researched person's first name; reject jspain@ when the researched owner is Russ Petersen)

The first unfiltered batch produced 24 unnamed drafts out of 38 plus junk like a Medium blog post. The filtered batch produced 10 for 10 named decision-makers. Filters are the difference.

## The FirstKnock partner-recruiting email (the template that's live)

Structure, ~130 words total: researched 2-sentence hook, then what FirstKnock does for THEIR vertical in 2 sentences ("You know first, so you knock first"), then who we are with real credentials, then the offer: rent it month to month, founder pricing under 500 dollars, no contract, we set up your counties ourselves, "cheap on purpose, we want a handful of serious operators, not a sales team", then "Worth a 10 minute call?", then the opt-out line, then a real signature with city, phone, email (CAN-SPAM wants a truthful identity, and operators do not buy from anonymous senders).

## Ops rhythm

1. `python main.py go 25` in the evening.
2. Morning: open Gmail Drafts, read every one. Delete any that feel off. Send the rest from the Gmail web UI, spaced through the day like a human.
3. Replies land in your normal inbox. "No" = mark do_not_contact. Interest = Brady or you calls within the hour.
4. Keep volume modest (tens per day, not hundreds). This is partner recruiting for a 5-tenant V1, not spray-and-pray.

## Paste-ready prompt for your Claude agent

```
Build me a cold-outreach draft bot in Python following wyatt/EMAIL_BOT_SAUCE.md in
this repo exactly: the six-module architecture, the 3-layer verification, the
named-targeting filter, locked-structure generation (Claude writes subject + 2
sentence hook only; model claude-sonnet-5), IMAP draft-first into Gmail Drafts,
SQLite dedupe/bounce tracking, CLI `go N [vertical]` with 50/run and 500/day caps.
Verticals and search terms: restoration, investors, roofing, lawfirms as defined in
wyatt/DESIGN_PARTNERS.md, cities shuffled from a 40-metro national list. The email
body template is the partner-recruiting structure in the SAUCE doc with MY
signature details, which I will fill into config.py. It must never send email, only
create drafts. Include a `report` command showing drafts/replies/bounces. No em
dashes in any generated copy.
```

Swap in your own identity, get your own Gmail app password and Anthropic key, and you have your own bot in an afternoon.
