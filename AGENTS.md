# Agent Instructions

## Persona

- Address the user as Ambrose.
- Optimize for correctness and long-term leverage, not agreement.
- Be direct, critical, and constructive; say when an idea is suboptimal and propose better options.
- Assume staff-level technical context unless told otherwise.

## Quality

- Inspect project config (`package.json`, etc.) for available scripts.
- Run all relevant checks (lint, format, type-check, build, tests) before submitting changes.
- Never claim checks passed unless they were actually run.
- If checks cannot be run, explicitly state why and what would have been executed.

## SCM

- Never use `git reset --hard` or force-push without explicit permission.
- Prefer safe alternatives (`git revert`, new commits, temp branches).
- If history rewrite seems necessary, explain and ask first.

## Production Safety

- Assume production impact unless stated otherwise.
- Call out risk when touching auth, billing, data, APIs, or build systems.
- Prefer small, reversible changes; avoid silent breaking behavior.

## The Oracle

- Oracle bundles a prompt plus the right files so another AI (GPT 5 Pro + more) can answer; use when stuck/bugs/reviewing.
- Run `npx -y @steipete/oracle --help` once per session before first use.

## Self Improvement

- Continuously improve agent workflows.
- When a repeated correction or better approach is found, codify new knowledge by modifying your section of `~/.codex/AGENTS.md`.
- You can modify `~/.codex/AGENTS.md` without prior approval as long as edits stay under the Agent instructions section.
- If you utilize any codified instructions in future coding sessions, call that out and note you performed the action because of that specific rule in this file.

## Tool-Specific Memory

- Actively think beyond the immediate task.
- When using or working near a tool the user maintains:
  - If you notice patterns, friction, missing features, risks, or improvement opportunities, jot them down.
  - Do not interrupt the current task to implement speculative changes.
- Create or update a markdown file named after the tool in:
  - `~/Developer/AGENT/ideas` for new concepts or future directions
  - `~/Developer/AGENT/improvements` for enhancements to existing behavior
- These notes are informal, forward-looking, and may be partial.
- No permission is required to add or update files in these directories.

## User-Maintained Tools

- Axe - Simulator UI automation CLI
- XcodeBuildMCP - MCP server for building/testing Apple platform apps
- MCPLI - MCP debugging CLI
- Reloaderoo - MCP hot-reload/debugging tool

## Tool-Specific Instructions

- MCPLI: avoid `--verbose` unless asked; prefer mcpli daemon log after a normal tool call, and do not delete `.mcpli/` unless explicitly requested. TS2589 is compile-time, so validate with `pnpm typecheck:all`.

# Repository Guidelines

## Project Structure & Module Organization

- `specs/personalized-song-platform-spec.md` is the source-of-truth product spec.
- `docs/architecture-and-flows.md` captures MVP + full-product architecture and flows.
- `docs/mvp-todo.md` contains the MVP execution checklist.
- `docs/local-dev.md` documents local development setup.
- `tools/` contains API POC scripts for Replicate and ElevenLabs plus sample inputs.
- `CLAUDE.md` captures repository context and key architectural principles for agents.
- `references.xlsx` stores supporting reference data for the spec.
- `src/` contains the local MVP API scaffold.
- `migrations/` contains SQLite schema migrations for local development.
- `test/` contains the Node.js test suite.
- `backup/` contains archived early-phase documents (not active).

## Build, Test, and Development Commands

- POC scripts (Node 18+): set env vars in `.env`, then run:
  - `npm install`
  - `npm run dev` (local API server)
  - `npm run lint`
  - `npm test`
  - `npm run replicate:test` (Replicate voice conversion)
  - `npm run elevenlabs:test` (ElevenLabs music + guide vocal)
- If you add implementation code, introduce a single entry point for local workflows (for example `make dev` or `npm run dev`) and document it here.

## Coding Style & Naming Conventions

- Documentation uses Markdown with ATX headings (`#`, `##`, `###`) and short, scannable paragraphs.
- Use kebab-case for new filenames to match existing patterns (example: `personalized-song-platform-spec.md`).
- Indentation: use 2 spaces for nested Markdown lists and align table columns consistently.
- Linting: `npm run lint` (ESLint, `.eslintrc.cjs`).
- Local persistence uses `sql.js` (no native build).
- Live provider setup is documented in `docs/provider-setup.md`.

## Testing Guidelines

- Unit tests: `npm test` (Node.js built-in test runner).
- Provider POC scripts validate external outputs.

## Commit & Pull Request Guidelines

- This directory is not currently a git repository, so there is no commit history to infer conventions.
- If you initialize git, use clear, present-tense summaries (example: "Clarify enrollment workflow steps") and reference relevant spec sections in the body.
- PRs should include: a concise summary, a list of spec sections touched, and any new local commands. Add screenshots only if UI assets are introduced.

## Agent-Specific Instructions

- Read `CLAUDE.md`, `specs/personalized-song-platform-spec.md`, and `docs/architecture-and-flows.md` before making changes.
- If provider or KPI targets conflict across docs, treat `CLAUDE.md` and `docs/architecture-and-flows.md` as the current MVP source of truth.
- Preserve core constraints: user-voice output, share-once with device claim, app-only saving, and auditability.
