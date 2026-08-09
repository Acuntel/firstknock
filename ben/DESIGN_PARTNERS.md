# The 5 Design Partners V1 Is Built For

These are real people. Four are existing relationships Brady leads personally; one is a cold prospect who was drafted in the first outreach batch. V1 is scoped to make exactly these five successful. Their tenant configs below are the acceptance test for the whole product: when all five configs work end to end, V1 ships.

Discretion: existing-client details stay in this private repo. Brady makes first contact in every case; Ben builds.

## 1. Paul — restoration franchise operator (Chicagoland)

- **Vertical preset:** `restoration`
- **Counties:** Cook IL to start; confirm service territory with Paul before adding collars
- **Why he buys:** he already uses a bespoke fire-lead engine Brady built; FirstKnock is that plus permits and distress signals, productized. He is the reference customer for the whole restoration vertical.
- **Config notes:** commercial fit boosted, freshness half-life short (losses get claimed fast), hot-ping to his ops Telegram group, digest 6:30am.
- **What closes him:** side-by-side week where FirstKnock surfaces losses his current alerts missed.

## 2. Vince — residential investor (Cook + collar counties, IL)

- **Vertical preset:** `investors`
- **Counties:** Cook, DuPage, Will
- **Why he buys:** he already receives a bespoke daily distressed-property Telegram digest Brady built. FirstKnock replaces it with config plus adds contact resolution and one-click letters.
- **Config notes:** absentee-owner weighting up, value-gap weight up, commercial zeroed, exclude the town of Bellwood from his scoring (village-inspector reasons; keep this as a tenant-level town exclusion knob), instant pings for 85+.
- **What closes him:** letters. Every 85+ lead queues a Lob letter for one-tap approval.

## 3. Z — preforeclosure investor (Winnebago + Boone counties, IL)

- **Vertical preset:** `investors` with foreclosure-stage emphasis
- **Counties:** Winnebago, Boone (Rockford metro). This is a NEW county pack and the hardest one: judicial-foreclosure stages come from lis pendens, judgment, and notice-of-sale artifacts. Build this pack LAST, after the Cook-area packs prove the pipeline; bridge him early via the generic IMAP ingester if needed.
- **Config notes:** stage-aware scoring (30/60/90 day windows to auction matter more than raw freshness), weekly summary plus instant pings.
- **What closes him:** stage timeline on the lead detail: how long until the sheriff's sale, at a glance.

## 4. REAL Law Group — real estate law firm (Cook County, IL)

- **Vertical preset:** `lawfirms`
- **Counties:** Cook
- **Why they buy:** existing client relationship; new foreclosure filings and new association registrations are intake for them.
- **Config notes:** letter-first outreach with bar-advertising disclaimer in the tenant compliance footer, digest weekly Monday 8am (intake meets Mondays; confirm), email drafts off by default.
- **What closes them:** compliance posture. Human-initiated contact only, disclaimer support, and an exportable log of what was sent to whom.

## 5. Mike Ostrowski — Pilot Roofing (Metro Detroit, MI)

- **Vertical preset:** `roofing`
- **Counties:** Wayne MI first, then Oakland/Macomb if he converts
- **Why him:** strongest named cold prospect from the first outreach batch (storm and hail damage roofer, exactly the ICP). He proves two things at once: the roofing preset and the first out-of-state county pack.
- **Config notes:** permit-weighted scoring plus recent-sale signal, hot-ping on commercial permits, digest 7am.
- **What closes him:** speed to value. He should see Wayne County permits in his first digest within 10 minutes of onboarding.

## Scope this implies (the whole V1 adapter list)

1. Cook County IL pack (Socrata: sales, permits, appeals + owner/tax join) — serves Paul, Vince, REAL Law
2. DuPage County IL pack (ArcGIS) — Vince
3. Will County IL pack (treasurer delinquency) — Vince
4. IL SOS bulk file (HOA/condo registrations) — REAL Law
5. Generic IMAP alert ingester — Paul's existing alerts, Z's bridge
6. Wayne County MI pack (permits) — Mike
7. Winnebago + Boone IL pack (foreclosure stages) — Z, built last

Five tenants, four presets, seven adapters. That is V1. Nothing else.
