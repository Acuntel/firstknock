# FirstKnock — Per-Client Customization Playbook

The core promise of the architecture: **one codebase, every client served by configuration.** This document defines exactly what changes per client, what never does, and the three escalation levels when a client wants something config cannot do.

## 1. The three levels of customization

| Level                                    | What                                                                                                                                 | Effort                                                          | Examples                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Config** (a tenant row, zero code)     | vertical preset, counties, scoring weights, digest hour/channels, hot-ping threshold, service-area radius, outreach voice, plan tier | Minutes, done in the onboarding wizard or admin                 | 95% of clients stop here                                                                                               |
| **Preset** (a new JSON file, light code) | A new vertical: event types + default weights + outreach templates + digest copy                                                     | Hours                                                           | Adding "pool contractors" or "solar installers" as vertical #5                                                         |
| **Adapter** (real code + fixture test)   | A new county or data source                                                                                                          | Half a day to a few days depending on the county's data quality | A client in Texas needs Harris County; a restoration client pipes their Perch-style alert email into the IMAP ingester |

The discipline that keeps this a product instead of an agency: **never fork the codebase for a client.** If a request cannot be met by config, preset, or adapter, it is a V2 roadmap conversation, not a custom build.

## 2. What a vertical preset contains

Each preset is one JSON file, cloned onto the tenant at onboarding (so later preset edits never surprise existing clients):

```jsonc
{
  "id": "restoration",
  "label": "Damage Restoration",
  "eventTypes": ["FIRE_INCIDENT", "PERMIT", "LIS_PENDENS"],
  "weights": {
    "eventSeverity": { "FIRE_INCIDENT": 100, "PERMIT": 45, "LIS_PENDENS": 20 },
    "freshnessHalfLifeHours": 18,
    "valueGap": 0.1,
    "propertyClassFit": { "residential": 1.0, "commercial": 1.2 },
    "distanceDecayMiles": 25,
  },
  "digest": {
    "subject": "Your {county} losses this morning",
    "leadNoun": "loss",
    "topN": 5,
  },
  "outreach": {
    "emailTemplate": "restoration_v1",
    "letterTemplate": "restoration_letter_v1",
    "doorScript": "restoration_door_v1",
  },
  "hotPingDefault": 80,
}
```

The four launch presets: `restoration`, `investors`, `roofing`, `lawfirms`. Same event, different lens: a new lis pendens is a 20 for a restoration company, an 85 for an investor, and a 95 for a foreclosure-defense firm.

## 3. What a county pack contains

A county pack is the set of adapters enabled for a FIPS code, plus county metadata (record freshness expectations, known data quirks, parcel URL pattern for deep links). Clients buy counties, not adapters: enabling "Cook County, IL" flips on every adapter we have for 17031. When a new client's county has no pack yet, that is the Adapter escalation level, and it is also how the moat compounds: **every new client funds a county pack that every future client in that county gets for free.**

## 4. Per-client knobs (all config level)

- **Counties**: 1 / 3 / unlimited-in-state by tier.
- **Service-area geo-fence**: center + radius; leads outside decay hard rather than disappearing (a big commercial loss 40 miles out may still be worth a ping).
- **Scoring weights**: start from preset, tune per client during concierge onboarding (e.g. an investor who only wants absentee-owner single-family: crank propertyClassFit, zero out commercial).
- **Digest**: hour, channels (Telegram, email, both), topN.
- **Hot-ping threshold**: lower it for hungry clients, raise it for owners who only want the whales.
- **Outreach voice**: per-tenant signature block, company boilerplate, compliance footer, and a tone sample the email generator mimics. The event reference in each draft comes from the lead; the voice comes from the tenant.
- **Seats and roles**: owner vs member (members work leads, cannot touch billing or settings).

## 5. Concierge onboarding (the first 10-20 clients)

Early clients get white-glove setup, and the process is itself the product research:

1. 30-minute call: their counties, their ideal job, their current lead sources and cost per lead.
2. We pick the preset, set the geo-fence, tune weights live against last week's real events ("would you have wanted this one?").
3. Connect Telegram and their Gmail, set digest hour.
4. Week one: daily check-in message, tune scores against their verdicts.
5. Week two onward: they run self-serve; their weight adjustments feed back into better preset defaults.

Design partners (warm network: a restoration franchise operator, two Chicago-area investors, law-firm clients) get founder pricing locked for life in exchange for weekly feedback and a testimonial when it works.

## 6. White-label and reseller notes (V2, do not build yet)

The repeated ask that will come: agencies and franchise HQs wanting to resell under their brand. The architecture allows it later (digest branding, custom domain, per-reseller tenant grouping) but it is explicitly out of V1 scope. Take names, do not build.

## 7. Worked examples

**Nashville restoration company (midsize, commercial-heavy).** Preset `restoration`, counties: Davidson + Williamson TN (needs a new county pack: adapter work, ~2 days including fire-incident source research). Weights: commercial fit 1.5, freshness half-life 12h because commercial losses get claimed fast. Hot-ping 75, digest 6:30am, Telegram to the ops group chat. Outreach voice: their estimator's signature, IICRC certs in the footer.

**Chicago-area investor (flipper, absentee-owner focus).** Preset `investors`, counties: Cook + DuPage + Will (all packs exist day one). Weights: absentee-owner bonus up, valueGap weight up, commercial zeroed. Hot-ping 85 mailed-letter flow: every 85+ lead gets a Lob letter same day automatically queued for approval. This client exists today as a bespoke build; FirstKnock replaces it with config.

**Charlotte HOA law firm.** Preset `lawfirms`, county: Mecklenburg NC (new pack; SOS registration source plus foreclosure filings). Digest weekly on Monday rather than daily (config: digest cadence), because intake committees meet Mondays. Outreach: letter-first, never email, bar-advertising disclaimer in the footer (tenant compliance footer field).

## 8. Pricing discipline

$149 Solo / $299 Pro / $499 Team. Custom adapter work for a client's new county is included at Pro and above (it becomes a shared county pack), not billed as services. Do not sell one-off custom features for money; sell the roadmap. The moment we take $5k to build a client-specific feature, we are an agency again.
