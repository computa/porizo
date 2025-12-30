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
