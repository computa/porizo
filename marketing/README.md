# Porizo Marketing

This folder is the source of truth for Porizo marketing **assets, strategy, and channel data**. For **how the marketing factory actually runs** — the pipelines, the production loops, what's runnable today, and the `/marketing` router — see the operational companion:

> **▶ [`docs/marketing/PIPELINES.md`](../docs/marketing/PIPELINES.md)** — the 6 pipelines + 3 loops (updated 2026-07-10). Use `$marketing` in Codex or `/marketing` through the tracked Claude compatibility skill.

Division of labor: **this README = the folder map / brain** (what lives where, what's canonical vs archive). **PIPELINES.md = the operating procedure** (which command, which cadence, which credential). They are not competing docs — README tells you where things are; PIPELINES tells you what to do.

## Current Push

Start here: [`strategy/current/proof-first-distribution-reset.md`](strategy/current/proof-first-distribution-reset.md)

The active direction is a proof-first GTM reset: make people encounter finished songs and believable reactions before asking them to download Porizo. Paid ads and cold email are monitoring/learning channels for now, not the main growth engine. **This matches PIPELINES.md's priority order** — Pipeline 1 (recipient conversion / the viral loop) leads; paid acquisition is dormant; ASO + organic-social + blog carry growth.

## Folder Map

| Folder               | Purpose                                                                                                         | Status                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `strategy/current/`  | Live GTM strategy                                                                                               | Canonical                                       |
| `strategy/achieved/` | Tried/completed strategies with lessons                                                                         | Canonical                                       |
| `channels/`          | Channel-specific plans and indexes                                                                              | Canonical                                       |
| `funnels/`           | Attribution, UTM, traffic, and conversion measurement                                                           | Canonical                                       |
| `appstore/`          | App Store metadata, screenshots, ASO, Apple Search Ads data                                                     | Active operational path                         |
| `campaigns/`         | Reusable campaign source assets and generated campaign outputs                                                  | Active creative path                            |
| `creative/`          | Indexes for raw creative sources such as audio hooks and product demos                                          | Canonical index                                 |
| `email/`             | Backend cold-email runtime templates and state                                                                  | Active operational path; do not rename casually |
| `emails/`            | Admin-dashboard nurture preview templates                                                                       | Active runtime path; do not archive              |
| `email-templates/`   | One-off lifecycle/email campaign template packs                                                                 | Legacy active assets                            |
| `gtm/`               | Daily GTM operating-system data; read by the `gtm-daily`/`gtm-weekly` skills                                    | Keep while those skills exist                   |
| `operations/`        | Marketing task plans and runbooks                                                                               | Canonical                                       |
| `research/`          | Leads, market notes, raw research                                                                               | Canonical                                       |
| `archive/`           | Superseded packs + old plans; `2026-07-consolidation/` holds the dead dirs pruned 2026-07-10 (see its manifest) | Canonical archive                               |

## Rules

- Put new channel work under `channels/<channel>/` unless a script already depends on an existing path.
- Use the tracked `.agents/skills/marketing/SKILL.md` router (`$marketing` in Codex) or its tracked `.claude/skills/marketing/SKILL.md` compatibility router (`/marketing` in Claude Code).
- Keep `marketing/appstore/aso` stable; Apple Search Ads scripts write there.
- Keep `marketing/email` stable; production/admin cold-email tooling reads templates from there (and the audio-probe logs into its `.state/`).
- Keep `marketing/emails` stable; the admin marketing route reads its three allowlisted HTML templates at runtime.
- `campaigns/`, `audio hooks/`, `product demo/` are **live `tiktok-pipeline` input pools** — its scripts read them by exact path. Do not archive them as "stale."
- **Before archiving ANY dir, grep `scripts/ src/ package.json .claude/skills/ ~/.claude/skills/` for its path** — a "paused channel" or old date does not mean the directory is dead (it may back a live route, script, or skill). This is the ENOENT lesson.
- If a strategy is no longer active, move it to `strategy/achieved/` and add outcome notes.
- If a campaign pack is no longer active, move it to `archive/campaign-packs/`.
- The current GTM push lives in `strategy/current/`; avoid creating competing top-level strategy docs. Operational how-to belongs in [`docs/marketing/PIPELINES.md`](../docs/marketing/PIPELINES.md), not a new top-level doc here.
