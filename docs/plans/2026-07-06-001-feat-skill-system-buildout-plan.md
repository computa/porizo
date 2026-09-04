---
title: "feat: Build recurring-pattern skills, rules, hooks + reconcile rules drift"
type: feat
date: 2026-07-06
status: in-progress # P0-P3 executed 2026-07-06; P4 cleanup awaiting user confirmation
depth: deep
origin: 4-scout audit of ~/Documents/projects + session histories (2026-07-06)
execution: code
---

# Skill/Rule/Hook Buildout + Rules-Drift Reconcile

Turn the audit's recurring-pattern findings into real artifacts. User asked for
**all 3 tiers**, emphasis on **enforcement mechanisms and self-improving loops**.

**Global-vs-project note:** Skills/rules/hooks live under `~/.claude/` (global,
outside this repo). Porizo-specific runbooks live in `~/Documents/projects/porizo/docs/`.
Nothing here is committed to the porizo git repo except the porizo docs + this plan.

---

## Phase 0 — Reconcile the rules drift (BLOCKS everything; do first)

The 2026-07-05 slim-down cut `~/.claude/CLAUDE.md` 183→56 lines and removed 14
rules from `~/.claude/rules/` WITHOUT folding their directives into CLAUDE.md.
Live `rules/` (7) is the correct injection channel (CLAUDE.md line 13 names it).
User decision: **reconcile — restore the important ones, drop the obsolete.**

- [ ] P0.1 — Restore safety/correction rules to `~/.claude/rules/` from `backup-2026-07-05-claudemd/rules-orig/`:
  - `porizo-feedback_no_openclaw_no_vercel.md` (safety: wrong-infra)
  - `porizo-project_song_transfer_checklist.md` (8-table atomic transfer)
  - `porizo-feedback_bypass_auth_launch.md`, `porizo-feedback_use_axi_not_mcp.md`,
    `porizo-feedback_verify_production_claims.md`, `porizo-feedback_consolidation_over_safety.md`
  - `no-haiku.md` + `agent-model-selection.md` (model discipline)
  - `use-scout-not-explore.md`, `proactive-delegation.md`
  - `karpathy-guidelines.md`
- [ ] P0.2 — Restore `porizo-workflow.md` (mandatory plan-first loop) — the rule whose absence let this very task skip planning.
- [ ] P0.3 — Deliberately DROP as obsolete (leave in backup only): `cross-terminal-db.md`, `dynamic-recall.md`, `agent-memory-recall.md`, `proactive-memory-disclosure.md` — confirm each is unused before dropping.
- [ ] P0.4 — Verify: fresh `ls ~/.claude/rules/` shows the restored set; spot-check one restored rule renders in a new session (or note it will on next start).

## Phase 1 — Tier 1 runbooks (highest frequency × direct pain)

- [ ] P1.1 — **Railway auth + prod-health** → new `~/.claude/rules/railway-auth.md` (rw-use first; validate with `projects{}` not `me{email}`; `rw-login` on revoke) + `~/Documents/projects/porizo/docs/dev/prod-health-check.md` runbook (rw-use → railway status → canned SQL row-counts → ASA spend pull). Source: this session + railway-profiles.zsh.
- [ ] P1.2 — **TestFlight/App Store release runbook** → `~/Documents/projects/porizo/docs/dev/testflight-release-runbook.md`. Consolidate 3 memory files: both version fields ×4 locations, `--release-type AFTER_APPROVAL`, explicit `-authenticationKey*` flags, `/appstore-review` gate.
- [ ] P1.3 — **tasks/ convention → global**: `~/.claude/rules/task-file-conventions.md` (todo.md + lessons.md Trigger→Mistake→Rule schema) + genericize `porizo-session-start.ts`/`porizo-pre-edit.ts` hooks to fire on ANY project with a `tasks/` dir (path-detect, not hardcoded porizo). Rebuild hooks after.

## Phase 2 — Enforcement mechanisms (user emphasis)

- [ ] P2.1 — **Tool-capability-claim hook** (PreToolUse/UserPromptSubmit): when about to assert "tool can't do X" then fall back, inject "test it first" reminder. Rule text already in CLAUDE.md; this adds the missing enforcement.
- [ ] P2.2 — **Migration semicolon-trap check**: add to porizo `migration-reviewer.md` agent — grep `^\s*--.*;` and reject; + boot-safety checklist item.
- [ ] P2.3 — **Dead-code pre-delete checklist** → extend `~/.claude/skills/dead-code/SKILL.md`: multi-form import grep (from-root + `./`/`../` + dynamic require/import) before "0 importers."
- [ ] P2.4 — **Pre-UI visual-source gate** → `~/.claude/rules/open-visual-source-before-ui.md`: open the real mockup/running-app screens before writing UI code.

## Phase 3 — Self-improving loops (user emphasis)

- [ ] P3.1 — **Terminal-state / financial-audit gate** → new skill `~/.claude/skills/terminal-state-audit/`: after any spend/credit/status-lock feature, enumerate terminal states, require a failure-path test each, grep status-locks lacking recovery. (User flagged this as skill-worthy in lessons.md and it was never built.)
- [ ] P3.2 — **Lessons→rules promotion loop**: make the "after correction → lessons.md → promote generic to rules/" loop real. A hook or skill that, at session end / on demand, scans new lessons.md entries and proposes rule promotions. This is the compounding mechanism that would have PREVENTED the drift.
- [ ] P3.3 — **spec-vs-reality audit skill** → `~/.claude/skills/spec-reality-audit/`: walk spec section-by-section, mark IMPLEMENTED/PARTIAL/MISSING w/ file:line, "Deviations" section. (Most-repeated doc shape.)

## Phase 4 — Tier 3 cleanups (condense existing lessons)

- [ ] P4.1 — Railway 502 triage rule (public proxy ≠ private network) — ~10 lines.
- [ ] P4.2 — Triple ignore-file audit shell helper (`scripts/check-ignore-files.sh`).

---

## Guardrails

- Phase 0 BLOCKS all others — no point writing rules into a channel until it's confirmed healthy.
- Each restored/created rule: verify it's not a duplicate of the live 7 or the 276 skills.
- Hooks: rebuild via `cd ~/.claude/hooks && ./build.sh` after any `.ts` change; test before relying.
- No porizo git commits unless explicitly requested (docs are untracked additions).
- Dogfood the plan-frontmatter convention (this file uses it).

## Sequencing

P0 → P1 → P2 → P3 → P4. P0 is the safety fix. P2/P3 are the user's emphasis (enforcement + self-improving). P1 is quick-win consolidation. P4 is cheap cleanup.
