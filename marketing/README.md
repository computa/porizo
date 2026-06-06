# Porizo Marketing

This folder is the source of truth for Porizo marketing, distribution, acquisition measurement, and channel assets.

## Current Push

Start here: [`strategy/current/proof-first-distribution-reset.md`](strategy/current/proof-first-distribution-reset.md)

The active direction is a proof-first GTM reset: make people encounter finished songs and believable reactions before asking them to download Porizo. Paid ads and cold email are monitoring/learning channels for now, not the main growth engine.

## Folder Map

| Folder | Purpose | Status |
|---|---|---|
| `strategy/current/` | Live GTM strategy | Canonical |
| `strategy/achieved/` | Tried/completed strategies with lessons | Canonical |
| `channels/` | Channel-specific plans and indexes | Canonical |
| `funnels/` | Attribution, UTM, traffic, and conversion measurement | Canonical |
| `appstore/` | App Store metadata, screenshots, ASO, Apple Search Ads data | Active operational path |
| `campaigns/` | Reusable campaign source assets and generated campaign outputs | Active creative path |
| `creative/` | Indexes for raw creative sources such as audio hooks and product demos | Canonical index |
| `email/` | Backend cold-email runtime templates and state | Active operational path; do not rename casually |
| `email-templates/` | One-off lifecycle/email campaign template packs | Legacy active assets |
| `emails/` | Older GMass/nurture sequence assets and sent logs | Legacy active assets |
| `gtm/` | Historical daily GTM operating system from the April/May push | Archive/reference unless the current strategy says otherwise |
| `operations/` | Marketing task plans and runbooks | Canonical |
| `research/` | Leads, market notes, raw research | Canonical |
| `archive/` | Superseded campaign packs and old channel plans | Canonical archive |

## Rules

- Put new channel work under `channels/<channel>/` unless a script already depends on an existing path.
- Keep `marketing/appstore/aso` stable; Apple Search Ads scripts write there.
- Keep `marketing/email` stable; production/admin cold-email tooling reads templates from there.
- If a strategy is no longer active, move it to `strategy/achieved/` and add outcome notes.
- If a campaign pack is no longer active, move it to `archive/campaign-packs/`.
- The current GTM push lives in `strategy/current/`; avoid creating competing top-level strategy docs.
