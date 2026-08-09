# Open Questions for Brady

Raised during Phase 1. The working agreement in `ben/START_HERE.md` says architecture
changes go to Brady before they go into code, so anything here that touches the spec
is written as a proposal with the evidence behind it, not as a done deal.

Ordered by how much they block.

## 1. Assessment appeals have no event type, so that adapter is not built

`BUILD_SPEC.md` section 3 lists the Cook pack as "sales, permits, assessment appeals,
plus the 5-dataset owner/tax join", and the Phase 1 directive repeats it. But the
`EventType` union in the same section has eight values and none of them fit an appeal.
The closest is `TAX_DELINQUENT`, which carries the opposite meaning: a delinquency says
the owner is not paying, an appeal says the owner is engaged and arguing about value.

Sales and permits shipped. Appeals did not, because guessing at the enum would put a
wrong value in the database that every preset then has to reason about.

Recommendation: add `ASSESSMENT_APPEAL` to the union. It is a real signal for two of
the five design partners. For REAL Law Group an appeal is intake, and the Board of
Review feed carries the attorney name and firm directly, which is unusually good
contact data. For Vince an appeal on a commercial parcel is a distress signal.

Cost if you say yes: about half a day. The fixture is already saved at
`worker/fixtures/cook-appeals.json`, the dataset is `7pny-nedm`, and it is the only
one of the three Cook feeds that ships real latitude and longitude, so it needs no
geocoding. The work is one enum value in a migration, one adapter, one fixture test.

## 2. The adapter contract gained a required field

`CountyAdapter` in the spec has five members. The implementation has a sixth,
`lookbackDays`, and it is required rather than optional. Flagging it because it is a
change to a contract the spec spells out.

Why it is not a nice-to-have. `fetch(since)` filters on the date the event happened,
not the date the county published it. Measured against the live Cook feed on
2026-08-09:

| Feed    | Newest record in dataset | Lag       |
| ------- | ------------------------ | --------- |
| Sales   | 2026-05-28               | 73 days   |
| Permits | within days              | negligible |

The first version of the runner used a watermark: start from the last successful run,
reach back 48 hours, read forward. Against a 73 day lag that window asks Cook for
sales dated in the last two days, receives zero rows, records a successful run, and
marks the source healthy. It would have looked like a working pipeline that never
ingested a single sale, and nothing in the acceptance criteria would have caught it.

So the window is now anchored on now and reaches back the adapter's declared lag:
120 days for sales, 45 for permits. Re-reading the same window daily costs nothing
because the dedupe hash turns everything already stored into a no-op insert. It is
also self healing, since a source that was down for a week catches up on its next run
with no backfill code.

Making the field required is the part worth arguing about. Optional with a default
would be less friction, but the failure it prevents is silent, and five more county
packs land in Phase 5. Requiring it forces every future pack to answer "how far behind
is this feed" before it ships.

## 3. Cook sale data is about 75 days stale, which is a product fact

Not a bug and nothing to fix in code, but it shapes what we can promise.

`DESIGN_PARTNERS.md` says Mike Ostrowski should see value within 10 minutes of
onboarding. Permits deliver that: they are current to within days, and the roofing
preset is permit weighted, so he is fine.

The one to watch is the recent-sale signal. A "recently sold, may need a roof" lead is
really "sold about three months ago" in Cook County. That is still a usable signal for
roofing and restoration, since a new owner is still a new owner, but it is not the
same product as a fresh distress alert and we should not describe it as one in the
landing copy or on a demo call.

Worth confirming whether DuPage and Will publish faster before Phase 5. If they do,
sale freshness becomes a county-by-county quality difference the sources health page
should probably surface.

## 4. The reuse repos are not on this machine

`BUILD_SPEC.md` section 10 lists four repos to reuse: `~/Desktop/property-intel`,
`Acuntel/il-association-leads`, `~/Desktop/HIGH TICKET EMAIL BOT`, and
`~/dev/nessotalk`. Three are local paths on your machine and the fourth is a private
repo this GitHub account cannot see.

Phase 1 did not need them, so nothing is blocked yet. Phase 5 does: the IL SOS bulk
file parser is called out as reusable and fixed-width parsers are exactly the kind of
thing worth not writing twice. Phase 4 wants the three layer email verifier, and
Phase 6 wants the Stripe and entitlement pattern.

Easiest fix is pushing them to the Acuntel org as private repos and adding this
account as a collaborator. Otherwise say the word and they get rebuilt from the spec.

## 5. Nothing can touch a real database yet

No Supabase project, so `pnpm worker:seed-sources` and `pnpm worker:once` have not run
against live infrastructure. Both adapters are confirmed working against the live Cook
County API, and the schema and policies are proven against a real Postgres, so what is
missing is credentials rather than code.

`ben/START_HERE.md` lists the accounts. Supabase is the only one Phase 1 needs, and
the free tier covers it. Send a project URL, an anon key, and a service role key, or
add this account to the project and it gets set up from here.

## 6. Two of the five scoring inputs cannot be computed from Cook data

`BUILD_SPEC.md` section 4 lists five scoring inputs. Three of them work today.
Two have nothing to read.

**Value gap** compares assessed value against the last sale. The Cook sales feed
carries a sale price but no assessment, and the permits feed carries neither. The
weight is implemented and tested, it simply never fires.

**Distance from the service area** needs coordinates. Neither Cook sales nor Cook
permits carry latitude or longitude. Every lead currently sits at a neutral 1.0 for
distance, which means the geo fence in every tenant config is decorative so far.

Both terms report themselves as unavailable in the lead detail rather than
contributing a silent neutral multiplier, so nothing is being faked. But it does
mean a score today is really three inputs, not five, and the investor preset is the
one that suffers: value gap is weighted highest there and it is exactly the term
with no data.

Two fixes, both already implied by the spec. The Cook "5-dataset owner/tax join"
named in section 3 is what supplies assessed value, and it was scoped as part of the
Cook pack. Coordinates need geocoding from the parcel number, which the assessor
publishes in a separate parcel dataset.

Worth deciding whether that join lands before Phase 5 county packs or after. My read
is before: it upgrades every Cook lead for three of the five partners, where a new
county pack only serves one.

## 7. Freshness needed a per event type half life

Flagging a design decision rather than asking a question, because it changed the
shape of the preset config.

Section 4 asks for one steep freshness decay, and the example half life is 18 hours.
That is right for a fire and wrong for a sale, because Cook publishes a sale about 75
days after it closes. A single steep half life scores every sale in the dataset at
zero, so the investor and roofing presets would show no sales at all.

Presets now carry an optional `freshnessHalfLifeByType` alongside the global value.
Fire and permits keep short half lives; sales get 90 days. The underlying point is
that a sale is not stale at 75 days, that is simply the freshest the county has, and
decay should measure how long we have had a chance to act rather than how long ago
the event happened.

Same root cause as the polling window in question 2. Publication lag varies by feed
and the spec assumed one number would cover it.

## 8. The app's live data path has never returned a row

Same root as question 5, listed separately because it is a different risk. The Next
app reads leads from Supabase when it is configured and falls back to scoring saved
Cook fixtures when it is not. Only the fixture path has ever run.

The live query is written out rather than stubbed, and it fails visibly instead of
falling back, because a page quietly showing fixture data while claiming to be live
is the worst outcome available. It still needs a real project before anyone trusts it.

The fixture mode is worth keeping regardless. It means the today view, lead detail,
board, and settings can be reviewed and demoed with no infrastructure at all, and it
runs the real scoring engine rather than canned numbers.
