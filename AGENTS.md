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
## ExecPlan Standard
- For complex or multi-step work, use an ExecPlan that follows `~/.codex/PLANS.MD`.
- If this repository includes its own `PLANS.MD`, follow that file instead.



<claude-mem-context>
# Memory Context

# [porizo] recent context, 2026-05-06 8:02pm GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (14,602t read) | 408,935t work | 96% savings

### Apr 21, 2026
S2826 Upload Porizo app screenshots to App Store Connect using xcodebuildmcp for submission beyond TestFlight (Apr 21 at 8:37 PM)
13613 8:42p 🔵 Screenshot upload uses browser automation instead of Fastlane API
13615 8:51p 🔵 Mapped App Store screenshot upload interface structure
13616 " 🔵 Located and captured Media Manager interface
13617 8:54p ✅ iPhone 6.9" Screenshots Manually Updated in App Store Connect
S2827 App Store screenshot replacement - reviewing historical rejection context for iPad/iPhone screenshot requirements before uploading new Cal.com minimal design versions (Apr 21 at 8:56 PM)
13618 9:03p 🔵 Investigated screenshot archive structure showing rapid design iteration
13619 " 🔵 iPad screenshot archive investigation
S2828 Fix incorrect share screen/slide in Porizo app store marketing materials (Apr 21 at 9:04 PM)
13620 9:04p 🔵 Existing iPad App Store screenshots verified at 2048×2732
13621 " 🔵 Current iPhone screenshots verified without alpha channel
S2829 App Store screenshot workflow setup and validation review for Porizo iOS app (Apr 21 at 9:05 PM)
13622 9:08p 🔵 Porizo app configured as Universal (iPhone + iPad)
S2830 Porizo iPad screenshot evaluation and iPhone-only app strategy recommendation (Apr 21 at 9:08 PM)
13623 9:15p 🟣 PorizoApp iOS build and simulator launch successful
13624 " 🔵 Captured screenshot for design reference or documentation
S2831 iPad App Store screenshot capture - generating iPad-optimized reveal screen after reviewing Apple screenshot format requirements (Apr 21 at 9:20 PM)
13625 9:24p ⚖️ Proceed with existing iPad captures for App Store marketing
13626 9:25p ✅ Simulated tap on App Store Connect interface
13627 " ✅ Captured screenshot using Xcode MCP tool
13628 " 🔵 Porizo App Development Flags for Onboarding and Auth Bypass
13629 9:26p 🔵 Porizo app fixture states for App Store screenshot generation
13630 " 🟣 Launched Porizo iOS app in simulator with reveal-ready fixture for screenshot capture
S2832 Session continuation after screenshot generator completion - examining Porizo app launch arguments (Apr 21 at 9:27 PM)
13631 9:27p ✅ Captured iPad screenshot using xcrun simctl for App Store marketing
13632 " ✅ Simulator onboarding flag configured for screenshot capture
13633 9:28p 🔵 Captured iPad simulator screenshot for marketing evaluation
13634 " 🔵 Current iPad screenshot reviewed for reference
13635 9:29p ✅ iPad simulator launched for screenshot capture workflow
13636 " 🔵 Porizo Reveal Screen UI Structure and Features
13637 " ✅ iPad Screenshot Capture Initiated
13638 9:30p 🟣 App Store screenshot capture workflow active
13639 " ✅ Captured iPad simulator screenshot of Poems tab
13640 9:38p 🔄 Cleaned up marketing screenshot directory structure
13641 " 🔄 Cleaned up screenshot directory structure
13642 " 🔵 Checked iOS simulator status for screenshot generation
S2833 Systematic iPad screenshot capture at 2048x2732 resolution - capturing payoff/confirmation screen as part of complete iPad App Store screenshot set (Apr 21 at 9:40 PM)
13643 9:43p 🟣 Created task to capture iPad screenshot for emotional seed/story screen
13644 " ⚖️ Planning iPad screenshot upload to App Store Connect
13645 " ⚖️ iPad App Store screenshot production initiated
S2834 Automated iPad screenshot capture via iOS simulator - navigating app flow using xcodebuildmcp to reach and capture key screens at 2048x2732 resolution (Apr 21 at 9:43 PM)
13646 9:44p ✅ Initial iPad screenshot captured at 2048x2732 resolution
13647 " ✅ Save iPad onboarding pitch screenshot for App Store
13648 9:46p 🔵 Reviewed iPad screenshot state 02
13649 9:48p 🔵 Captured Porizo app onboarding pain points screen UI hierarchy
13650 9:49p ✅ Stopped Porizo iOS app in simulator
13651 9:51p 🔵 iPad UI shows inline occasion picker on Explore screen
13652 9:53p 🔵 Reviewed iPad birthday screen screenshot
13653 " ✅ UI navigation to Birthday screen initiated in iPad simulator
13654 9:54p ✅ iPad Onboarding Flow Screenshot Capture
13655 9:55p 🔵 Versioned onboarding completion system with legacy migration
13656 " ✅ Launched Porizo iOS app in simulator with auth bypass
13657 " 🟣 iPad screenshot capture initiated for App Store submission
13658 9:56p 🟣 iPad screenshot automation workflow completed
**13659** 9:57p ✅ **Captured iPad simulator screenshot of filled onboarding state**
User captured a screenshot of the Porizo iPad app in a filled/populated state, saving it as ipad-pick-filled.png. The filename suggests this captures the onboarding pain points screen after user selections have been made, contrasting with the previous empty state where all options were "Not selected". The command description "Check if Sarah typed" indicates this may be documenting a specific user interaction scenario, possibly showing text input or option selections attributed to a test user named Sarah. The screenshot provides a visual reference of the app state after user engagement with the onboarding flow.
~283t 🛠️ 959

**13660** 11:14p 🔵 **iPad screenshot storage locations identified**
User located historical iPad screenshot storage locations in the porizo project. The search identified two directories: `appstore/screenshots/current/raw-ipad` containing current/raw iPad screenshots for marketing materials, and `docs/appstore/ipad-screenshots` containing App Store documentation-related iPad screenshots. These directories serve as the archive for iPad screen captures used in app store listings and documentation.
~200t 🔍 5,180

**13661** " 🔵 **iPad Screenshot Storage Locations**
Search for iPad screenshot storage locations revealed multiple directories containing iPad assets within the Porizo project. The primary locations are `/docs/appstore/ipad-screenshots` for documentation and `/marketing/appstore/screenshots/current/raw-ipad` for marketing materials. Additional raw-ipad directories appear in nested PorizoApp paths (`PorizoApp/PorizoApp/marketing/appstore/screenshots/current/raw-ipad`), suggesting either asset duplication across app versions or a nested project structure with separate screenshot collections.
~251t 🔍 548

**13662** 11:15p 🔵 **iPad Screenshot Directories Are Empty**
Investigation of iPad screenshot storage locations in the Porizo project revealed that while the directory structure exists in both marketing and docs folders, both primary locations contain no files. The `/marketing/appstore/screenshots/current/raw-ipad/` and `/docs/appstore/ipad-screenshots/` directories are empty, indicating the iPad screenshots were either never populated in these locations, have been moved elsewhere, or were previously deleted. This suggests the "old iPad screens" the user is looking for are not in the expected standard locations.
~220t 🔍 1,125

**13663** " 🔵 **iPad screenshot files located across project directories**
User located iPad screenshot files stored across the porizo project. The docs/appstore/ipad-screenshots directory contains 5 PNG files showing core app functionality (01-explore.png, 02-create-choice.png, 03-create-song.png, 04-profile.png, 05-poems.png). The marketing/appstore/screenshots/current/raw-ipad directory contains 7 screenshots including onboarding flows (onboarding-1-pitch.png), value propositions (valueprop-1-dad.png), feature screens (05-occasion-picker.png, 09-reveal.png/jpg, home-tab.png). An additional ipad-subscription.png exists in the misc folder. These represent the complete archive of iPad screenshots for App Store listings and documentation.
~319t 🔍 1,651

S2835 Locating old iPad screenshot storage in Porizo project (Apr 21 at 11:15 PM)
**Investigated**: Git history searched for deleted iPad files. Project directories scanned for iPad-related folders. Contents of primary screenshot directories examined in both marketing and docs folders.

**Learned**: iPad screenshot directory structure exists in multiple locations: `/docs/appstore/ipad-screenshots` and `/marketing/appstore/screenshots/current/raw-ipad`, with additional nested copies in PorizoApp subdirectories. Both main directories are currently empty with no files present.

**Completed**: Identified the standard iPad screenshot storage locations within the Porizo project structure. Confirmed that expected directories exist but contain no files.

**Next Steps**: Investigation likely to continue checking nested PorizoApp directories or searching for iPad screenshot files in alternative locations, or determining if files were moved or renamed.


Access 409k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>