# Consolidate Porizo marketing and distribution assets

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain its own `PLANS.MD`, so this document follows the global standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo's marketing work is scattered across `marketing/`, `docs/`, and `tasks/`, and the current GTM direction is hard to find because older channel plans sit beside active assets. After this change, a contributor can open `marketing/README.md`, find the active push, find each channel's assets under a predictable folder, and understand which old plans are archived rather than current.

## Progress

- [x] (2026-05-15 11:20Z) Read core project docs required by `AGENTS.md`: `CLAUDE.md`, `specs/personalized-song-platform-spec.md`, and `docs/architecture-and-flows.md`.
- [x] (2026-05-15 11:20Z) Inventoried marketing, growth, App Store, email, campaign, and GTM folders.
- [x] (2026-05-15 11:28Z) Defined the canonical `/marketing` folder structure in `marketing/README.md`.
- [x] (2026-05-15 11:28Z) Moved low-risk marketing docs and repetitive campaign folders into the canonical structure.
- [x] (2026-05-15 11:28Z) Added index documents and made `marketing/current-push.md` the active GTM plan.
- [x] (2026-05-15 11:36Z) Validated changed scripts/docs with syntax check, focused ASO tests, lint, and full test suite.
- [x] (2026-05-15 11:45Z) Split strategy into `marketing/strategy/current/` and `marketing/strategy/achieved/` so tried strategies retain explicit learning notes.

## Surprises & Discoveries

- Observation: Most marketing assets already lived under `/marketing`, but several strategic or channel docs still lived in `docs/growth`, `docs/marketing`, `docs/appstore`, and `tasks`.
  Evidence: these have now moved to `marketing/funnels/`, `marketing/channels/paid-social/`, `marketing/appstore/docs/review-and-submission/`, and `marketing/operations/tasks/`.
- Observation: Some folders are code/runtime paths and should not be casually renamed in the same pass as strategy cleanup.
  Evidence: `scripts/import-cold-email-list.js` references `marketing/email/.state/cold-list.tsv`, `marketing/email/cold-intro.html`, and `marketing/email/cold-intro.txt`; ASO scripts write to `marketing/appstore/aso`.

## Decision Log

- Decision: Keep code-dependent paths such as `marketing/appstore/aso` and `marketing/email` stable unless every script reference is updated and validated in the same pass.
  Rationale: Breaking marketing automation while organizing docs would reduce leverage and make the cleanup harder to trust.
  Date/Author: 2026-05-15 / Codex
- Decision: Make `marketing/current-push.md` the canonical current GTM plan and demote older channel plans to channel references or archive.
  Rationale: The user explicitly wants the proof-first distribution reset to be the current push after consolidation.
  Date/Author: 2026-05-15 / Codex
- Decision: Keep a top-level `marketing/current-push.md` as a pointer, but store the active strategy under `marketing/strategy/current/`.
  Rationale: This satisfies the current-vs-achieved structure while preserving older links that already point to `marketing/current-push.md`.
  Date/Author: 2026-05-15 / Codex

## Outcomes & Retrospective

Consolidation pass complete. `marketing/README.md` now maps the marketing tree, `marketing/strategy/current/proof-first-distribution-reset.md` is the active proof-first GTM plan, channel folders have README indexes, and older growth/task/App Store docs have been moved under `/marketing`. Runtime paths with production/script dependencies were intentionally kept stable: `marketing/appstore/aso` and `marketing/email`.

Validation passed:

    node --check marketing/tools/generate-mothers-day-pins.js
    node --test scripts/aso/*.test.mjs
    npm run lint
    npm test

The full suite reported 447 tests, 441 passed, 6 skipped, and 0 failed.

## Context and Orientation

The existing marketing tree contains real assets and build outputs: App Store metadata, Apple Search Ads data, email templates, TikTok/Remotion video experiments, blog drafts, lead lists, and GTM logs. A "channel" means a place where Porizo can acquire users, such as App Store, Apple Search Ads, email, SEO/blog, social video, Reddit, creators, and web/landing pages. A "funnel" means measurement or conversion flow documentation, such as UTM links, download attribution, and weekly metrics.

The cleanup should make active work easy to locate without pretending old work never happened. Archived plans are still useful as evidence, but they should not read as the current strategy.

## Plan of Work

First, create a canonical folder model under `marketing/`: `strategy/`, `channels/`, `funnels/`, `campaigns/`, `creative/`, `research/`, `operations/`, and `archive/`. Next, move low-risk docs from `docs/growth`, `docs/marketing`, `docs/appstore`, and marketing task files into the matching marketing folders. Then consolidate duplicate Mother's Day and GTM documents by making archive folders explicit. Finally, add `marketing/README.md` and `marketing/current-push.md` so the present GTM push is clear.

## Concrete Steps

Run inventory commands from `/Users/ao/Documents/projects/porizo`:

    find marketing -maxdepth 3 -type d | sort
    find marketing -maxdepth 3 -type f | sort
    rg -n "marketing/email|marketing/appstore/aso|docs/growth|docs/marketing|docs/appstore"

Move files with `git mv` where possible so history remains intact. Use `mkdir -p` for new folders. Use `apply_patch` for new or edited Markdown.

## Validation and Acceptance

Acceptance is met when:

1. `marketing/README.md` explains the canonical structure and names the current push.
2. `marketing/current-push.md` captures the proof-first 14-day GTM reset.
3. Major channel docs live under `marketing/channels/*` or are clearly archived.
4. Script-dependent paths still work or have updated references.
5. `npm run lint` and focused ASO tests pass after any script edits.

## Idempotence and Recovery

Most moves are safe to repeat if they are guarded by `git status` and `test -e` checks. If a move proves too risky because scripts depend on a path, leave the existing folder in place and add a README that points to the canonical owner. Do not use destructive cleanup commands. Do not remove user changes.

## Artifacts and Notes

Important existing paths:

    marketing/appstore/aso
    marketing/email
    marketing/email-templates
    marketing/emails
    marketing/gtm
    marketing/campaigns/mothers-day-2026
    marketing/archive/campaign-packs/mothers-day-2026-plan-pack
    marketing/appstore/docs/review-and-submission
    marketing/strategy/archive/traffic-strategy.md
    marketing/operations/tasks/aso-spend-tracking.md
    marketing/operations/tasks/cold-email-backend-port.md

## Interfaces and Dependencies

The Apple Search Ads scripts depend on `marketing/appstore/aso`. The cold-email import and send tooling depends on `marketing/email`. These dependencies must either remain stable or be updated and validated.
