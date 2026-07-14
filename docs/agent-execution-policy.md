# Agent Execution Policy

This document is the operational source of truth for completing Porizo work quickly without weakening review, testing, or release safety. `AGENTS.md` makes the policy binding; the `porizo-execution-loop` skill applies it; `scripts/agent/` provides mechanical checks.

## Work Package

Treat each deliverable as one bounded work package. Before implementation, record:

- The objective and user-visible proof.
- Owned files or directories and unrelated dirty paths.
- Risk: low, medium, or high.
- Expected elapsed time and the next proof point.
- Commands that may run longer than two minutes and their timeout.

Use these default ranges:

- Small, low-risk change: 15-45 minutes.
- Medium, cross-file change: 45-90 minutes.
- High-risk auth, billing, migration, data, or release change: 90-150 minutes.

Split a package if it cannot produce tested evidence within its range. Start a fresh session when the objective changes materially or repeated context compaction makes the current session expensive to reconstruct.

## Progress And Watchdogs

Report progress at least every 10 minutes. State the phase, percentage, elapsed versus expected time, current command or agent, and timeout action.

Wrap commands expected to exceed two minutes:

    npm run agent:watch -- --estimate-minutes 8 -- npm test

The watchdog emits a heartbeat every minute, warns after five minutes without output, and terminates at twice the estimate by default. Set explicit limits when needed:

    npm run agent:watch -- --estimate-minutes 15 --silent-seconds 300 --hard-seconds 2400 -- xcodebuild test ...

No-output warnings require investigation. A hard timeout requires preserving the useful log, terminating the process, and either narrowing the command or documenting the blocker.

## Parallel Agents

Use parallel agents only for independent work. Keep at most three active agents. Every assignment must name its owned files or read-only lens, expected artifact, initial deadline of 10 minutes, and hard deadline of 20 minutes.

Do not give multiple agents the same open-ended repository review. Prefer disjoint implementation slices or focused lenses such as security, concurrency, and contract compatibility. Collect useful output and close each agent immediately. A stalled agent is terminated after its hard deadline; do not let stale handles consume resources.

## Validation Ladder

Run the smallest gate capable of disproving the current change, then broaden once after integration.

1. During editing, run focused tests for changed behavior.
2. After integrating the slice, run the affected module suite and static checks.
3. After accepting review findings, rerun focused regressions affected by those fixes.
4. Before handoff, run one final full or release gate appropriate to the changed surfaces.

Surface-specific final gates:

- Backend JavaScript, API contract, or repository change: ESLint plus focused Node tests; run `npm test` once before handoff.
- PostgreSQL schema or behavior: migration parity plus focused PostgreSQL integration; run the required PostgreSQL suite once.
- iOS-only code: focused Xcode tests, full configured iOS suite once, and a stable-Xcode Release build. Do not run the Node suite unless backend files or contracts changed.
- Android-only code: focused Gradle tests, affected module tests, and one release build.
- Documentation or metadata only: format/schema/domain-specific checks; do not run unrelated product suites.
- Cross-surface contract change: focused tests on every changed consumer and provider, then each affected final gate once.

A successful expensive gate remains valid until a later edit touches its dependency surface. Record the command and result so it is not repeated by habit.

## Review Ladder

Review a substantial plan once before implementation. After focused tests pass, review the integrated diff once with the relevant lenses. Each accepted finding gets a focused regression test or a concrete verification step. High-risk changes receive one final review after fixes; low- and medium-risk changes do not repeat a full review unless the fixes materially alter architecture or contracts.

External cross-model review is useful but not a release blocker when unavailable or quota-limited. Record the failure and complete the available local review instead of polling indefinitely.

## Git And Release Discipline

Run a scope preflight before editing and strict preflight before committing. Strict mode reports all unrelated dirty paths but fails only when an out-of-scope path is staged:

    npm run agent:preflight -- --scope PorizoApp/PorizoApp
    npm run agent:preflight -- --strict --scope PorizoApp/PorizoApp --scope docs/plans/example.md

Use separate branches or worktrees for authentication, Android, marketing, and architecture initiatives. Stage explicit paths, run `git diff --cached --check`, and inspect the staged summary. Do not clean, revert, or include unrelated user work.

Produce a TestFlight or production candidate only after the integrated change passes local contract, simulator, available device, review, and release-build gates. Upload one release candidate per integrated fix set. External processing time is reported separately from implementation time.

## Handoff

The final report states:

- Completed behavior and remaining external evidence.
- Exact validations and whether they were focused, affected, or full gates.
- Review findings accepted and resolved.
- Commit, branch, deployment, and release identifiers.
- Residual risks and existing warnings.
- Elapsed wall time, without adding overlapping agent durations as if they were serial work.
