# Adopt Porizo SwiftUI And Xcode Release Workflows

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo needs a repeatable way to adopt new Apple platform releases without destabilizing production builds. After this change, agents and humans have one workflow that says which skills to use for SwiftUI changes, how to handle Xcode 27 beta separately from stable shipping builds, and what release checks must run before TestFlight or App Store handoff.

The result is visible in three places: a repo-local skill at `.agents/skills/porizo-swiftui-release-workflow/SKILL.md`, a project workflow document at `docs/ios-swiftui-release-workflow.md`, and a release gate in `docs/pre-testflight-distribution-checklist.md`.

## Progress

- [x] (2026-06-09 11:50Z) Read the global ExecPlan standard at `~/.codex/PLANS.MD`.
- [x] (2026-06-09 11:50Z) Reviewed existing Porizo instructions in `AGENTS.md`, `CLAUDE.md`, `specs/personalized-song-platform-spec.md`, and `docs/architecture-and-flows.md`.
- [x] (2026-06-09 11:50Z) Added the repo-local `porizo-swiftui-release-workflow` skill.
- [x] (2026-06-09 11:50Z) Added `docs/ios-swiftui-release-workflow.md`.
- [x] (2026-06-09 11:50Z) Added the Xcode and SwiftUI release gate to `docs/pre-testflight-distribution-checklist.md`.
- [x] (2026-06-09 11:50Z) Added root `AGENTS.md` instructions that make the new workflow part of future agent behavior.
- [x] (2026-06-09 11:50Z) Added a `.gitignore` carve-out so the new Porizo skill can be tracked like the existing repo-local Porizo skills.
- [x] (2026-06-09 11:50Z) Validated whitespace for the changed files with `git diff --check`.

## Surprises & Discoveries

- Observation: The working tree already had unrelated modifications, including `AGENTS.md`, the Xcode project, API files, tests, ASO metadata, and rank files.
  Evidence: `git status --short` listed those files before these workflow edits. This plan avoids reverting or modifying unrelated changes.

- Observation: The current command sandbox was rooted in `marketing/appstore/aso/ranks`, but the durable workflow belongs in the parent project root.
  Evidence: The repo-local skill directory had to be created at `/Users/ao/Documents/projects/porizo/.agents/skills/porizo-swiftui-release-workflow`.

- Observation: `.agents/skills/*` is ignored by default, with explicit carve-outs for tracked Porizo skills.
  Evidence: `git check-ignore -v .agents/skills/porizo-swiftui-release-workflow/SKILL.md` pointed at the `.agents/skills/*` rule before the carve-out was added.

## Decision Log

- Decision: Add a repo-local skill instead of only adding prose to `AGENTS.md`.
  Rationale: A skill is reusable by future agents and can trigger on SwiftUI, release, simulator, accessibility, and App Store screenshot work.
  Date/Author: 2026-06-09 / Codex

- Decision: Keep Xcode 27 beta as a compatibility lane, not a shipping lane.
  Rationale: Xcode 27 beta has beta-only constraints and device-debugging changes. Stable App Store/TestFlight builds should stay on stable Xcode unless Ambrose or Apple requires otherwise.
  Date/Author: 2026-06-09 / Codex

- Decision: Put the operational checklist into `docs/pre-testflight-distribution-checklist.md`.
  Rationale: Release gates need to live where release work already happens, not only in a standalone reference document.
  Date/Author: 2026-06-09 / Codex

- Decision: Make `.sheet(item:)` and `.fullScreenCover(item:)` the default for selected-payload flows.
  Rationale: This avoids stale or empty launch payloads in SwiftUI presentation flows and matches existing project instructions.
  Date/Author: 2026-06-09 / Codex

- Decision: Add a `.gitignore` exception for `porizo-swiftui-release-workflow`.
  Rationale: The workflow needs to be tracked and shared like the existing Porizo-specific local skills.
  Date/Author: 2026-06-09 / Codex

## Outcomes & Retrospective

The workflow has been implemented as documentation and agent process, not app code. No user-facing app behavior changes yet. The next app feature or release candidate can now use the new skill and checklist to produce consistent preview, accessibility, simulator, performance, localization, and App Store asset evidence.

## Context and Orientation

Porizo is a SwiftUI iOS app backed by a Node/Fastify API. The app creates personalized songs and poems with strict constraints around user-voice output, share-once device claim, app-only saving, and auditability. SwiftUI changes often affect App Store screenshots, onboarding, create, reveal, paywall, playback, and share flows, so the workflow must connect product correctness, visual quality, simulator testing, and release readiness.

The key files for this work are:

- `.agents/skills/porizo-swiftui-release-workflow/SKILL.md`: the reusable workflow skill.
- `docs/ios-swiftui-release-workflow.md`: the human-readable project workflow.
- `docs/pre-testflight-distribution-checklist.md`: the release gate.
- `AGENTS.md`: the root instructions future agents read.

## Plan of Work

Add a repo-local skill that names the companion SwiftUI, performance, simulator, screenshot, icon, and localization skills. Add a project document that explains stable Xcode versus beta compatibility lanes, SwiftUI implementation gates, preview matrix, accessibility, performance, simulator/device checks, Organizer metrics, App Store assets, and localization. Add a release checklist section so the workflow is enforced before TestFlight. Add root agent instructions so future sessions know to use the workflow.

## Concrete Steps

The implementation edits are complete. To inspect them from the repository root:

    git diff -- AGENTS.md docs/pre-testflight-distribution-checklist.md docs/ios-swiftui-release-workflow.md .agents/skills/porizo-swiftui-release-workflow/SKILL.md docs/plans/2026-06-09-swiftui-release-workflow-adoption.md

To validate whitespace:

    git diff --check

## Validation and Acceptance

Acceptance is documentation-level because no executable app code changed.

The workflow is accepted when:

- `AGENTS.md` instructs agents to use `porizo-swiftui-release-workflow` for SwiftUI work.
- `.agents/skills/porizo-swiftui-release-workflow/SKILL.md` exists and names the companion skills and gates.
- `docs/ios-swiftui-release-workflow.md` defines the stable and beta Xcode lanes plus SwiftUI release gates.
- `docs/pre-testflight-distribution-checklist.md` includes the Xcode and SwiftUI release gate.
- `.gitignore` permits tracking `.agents/skills/porizo-swiftui-release-workflow/**`.
- `git diff --check` reports no whitespace errors.

## Idempotence and Recovery

These changes are additive. Re-running validation is safe. If the workflow needs rollback, remove the new skill directory, remove `docs/ios-swiftui-release-workflow.md`, remove this plan file, and delete the added sections from `AGENTS.md` and `docs/pre-testflight-distribution-checklist.md`. Do not revert unrelated existing worktree changes.

## Artifacts and Notes

The new workflow intentionally avoids changing app source, Xcode project configuration, or package scripts. That keeps the adoption reversible and prevents beta Xcode policy from affecting production code paths prematurely.

## Interfaces and Dependencies

The workflow depends on the existing local skills named in `porizo-swiftui-release-workflow`: `swiftui-ui-patterns`, `swiftui-pro`, `swiftui-performance-audit`, `porizo-simulator-testing`, `app-store-screenshots`, `screenshot-optimization`, `app-icon-optimization`, and `localization`. It also depends on existing release and simulator docs in `docs/pre-testflight-distribution-checklist.md` and `docs/dev/simulator-testing.md`.
