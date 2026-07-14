---
name: porizo-execution-loop
description: Execute substantial Porizo implementation, refactoring, production, or release work in bounded slices with scoped preflight, agent deadlines, watchdogs, risk-tiered validation, consolidated review, and explicit handoff evidence.
metadata:
  version: 1.0.0
---

# Porizo Execution Loop

Use this skill for work expected to exceed 15 minutes, touch multiple files, use parallel agents, affect production, or create a release candidate. Follow `AGENTS.md` and `docs/agent-execution-policy.md`.

## 1. Establish The Package

State the objective, visible proof, risk, owned paths, unrelated dirty paths, elapsed-time range, and first proof point. Run:

    npm run agent:preflight -- --scope <owned-path>

Create or update the task plan. Keep one step in progress. If the objective differs materially from the session's original deliverable, checkpoint current work and recommend a fresh session.

## 2. Slice And Assign

Prefer one main implementation path. Use up to three agents only when assignments are independent. For each agent, record:

- Owned files or read-only review lens.
- Required artifact.
- Initial result deadline: 10 minutes.
- Hard deadline: 20 minutes.

Do not let agents commit, push, deploy, or edit overlapping files. Collect the result and close the agent immediately. Terminate a stalled agent at the hard deadline after preserving useful output.

## 3. Execute With Watchdogs

Run focused checks while editing. Wrap commands expected to exceed two minutes:

    npm run agent:watch -- --estimate-minutes <n> -- <command> <args>

At five silent minutes, investigate. At the hard limit, terminate, preserve the log, narrow the command, and update the plan. Give Ambrose a progress report every 10 minutes with phase, percentage, elapsed/expected time, current operation, and timeout action.

## 4. Integrate And Validate

Integrate one bounded slice at a time. Run focused tests first and the affected module suite after integration. Use the surface-specific validation ladder in `docs/agent-execution-policy.md`; do not run unrelated suites. Record each successful gate and rerun it only if later edits can invalidate it.

## 5. Review Once

After focused tests pass, review the integrated diff with only relevant lenses. Convert every accepted finding into a regression test or concrete verification. Run one final review only for high-risk changes or material redesign caused by review fixes.

## 6. Commit And Release

Stage explicit files only, then run strict scope preflight and inspect `git diff --cached --check` plus the staged summary. Strict preflight warns about unrelated unstaged work and fails only for staged paths outside ownership. Complete all local release gates before uploading or deploying. Produce one integrated release candidate, wait for external processing with a bounded poll, and report that waiting separately.

## 7. Close Out

Close all agents and stop unnecessary processes. Update the plan. Report completed scope, remaining external evidence, validations, findings fixed, commit/deployment identifiers, residual risk, and elapsed wall time.
