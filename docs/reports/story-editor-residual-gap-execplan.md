# Close Story Editor Residual Gaps

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain a checked-in `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, the story creator remains the same visible flow from the user’s point of view: users still start in the same create entry, draft through conversation, review the story, and continue into song or poem creation. The difference is that review becomes a real draft editor. Users will be able to make structured changes, see revision history and a before/after draft diff, understand when the draft needs clarification, see which draft version downstream creation will use, and recover cleanly when the server draft changed while they were away. The backend will expose explicit revision operations and stronger lifecycle semantics so these behaviors are honest instead of simulated.

## Progress

- [x] (2026-03-07 02:44Z) Re-read the planning standard and refreshed the current story-editor code paths.
- [x] (2026-03-07 02:44Z) Captured the implementation sequence in this ExecPlan.
- [x] (2026-03-07 04:20Z) Expanded the backend draft contract with explicit lifecycle states, structured revision operations, history, diff, provenance, and resume metadata.
- [x] (2026-03-07 05:35Z) Threaded the expanded contract through Swift models, session persistence, and engine state.
- [x] (2026-03-07 07:10Z) Upgraded the review screen into a fuller draft editor with structured actions, history, diff, clarification states, fact inventory, conflict UI, and final-notes editing.
- [x] (2026-03-07 07:50Z) Preserved song and poem continuity while surfacing exact draft provenance in the downstream flow.
- [ ] Fix the remaining in-scope Swift warnings that still surfaced during device builds.
- [ ] Run full end-to-end runtime QA through revise, clarify, confirm, song, and poem flows.
- [x] (2026-03-07 12:31Z) Reduced review-screen hang risk by debouncing whole-session persistence and moving per-keystroke draft syncing off the main session mutation path.

## Surprises & Discoveries

- Observation: The current V3 backend already stores more editorial state than the app uses, including `narrative_revisions`, `integration_history`, `open_conflicts`, and `revision_requests`.
  Evidence: `src/writer/v3/state.js`, `src/writer/v3/index.js`.

- Observation: The current confirmation view is now capable of inline review revisions, which means the remaining work should build on that surface rather than replacing it.
  Evidence: `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`.

- Observation: The most credible freeze source in the current review flow is write amplification, not the editor text field itself. `StoryConfirmationView` was mutating `engine.session` on every keystroke, while `V2StoryEngine` was persisting the full `V2Session` on every published session update.
  Evidence: `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`, `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`, `PorizoApp/PorizoApp/V2Story/V2SessionStore.swift`.

- Observation: Device builds still succeed, but the remaining warning surface is concentrated outside the story editor, especially in `AuthManager.swift`.
  Evidence: iOS device build output on 2026-03-07.

## Decision Log

- Decision: Keep the existing create -> conversation -> review -> song/poem shape and evolve the internal contract additively.
  Rationale: Ambrose explicitly wants the current flow preserved while making the editor robust and honest.
  Date/Author: 2026-03-07 / Codex

- Decision: Start with backend contract expansion before deeper UI work.
  Rationale: The remaining UI gaps are mostly symptoms of missing payloads and lifecycle/state semantics. Patching UI first would create more local-only behavior.
  Date/Author: 2026-03-07 / Codex

## Outcomes & Retrospective

The story editor now behaves more like a real draft surface and less like a forward-only wizard. The major contract gaps have been closed across backend, client state, and review UI while preserving the visible create -> draft -> review -> song/poem flow. Device and simulator builds both pass, and the updated app has been installed on Ambrose's iPhone for direct validation.

The latest stability pass addressed the highest-probability hang path in this feature: full-session persistence and engine-session mutation on every editor keystroke. `V2StoryEngine` now debounces session persistence, and `StoryConfirmationView` now keeps revision/final-notes text locally hot and syncs it back to `engine.session` on a short debounce plus on disappear/submit.

Remaining work should focus on runtime QA and the warning surface that still appears in device builds, particularly `AuthManager.swift`, rather than reopening the story-editor contract itself.

## Context and Orientation

The story creation flow spans both the Node backend and the SwiftUI app.

The backend story entry points live in `src/routes/story.js`. They delegate to `src/writer/index.js`, which routes story operations to the V3 story runtime in `src/writer/v3/index.js`. The durable draft state lives inside `v2_state_json` on `story_sessions`, accessed through `src/database/story-repository.js`. The V3 state shape is defined in `src/writer/v3/state.js`.

On iOS, the API contract is mirrored in `PorizoApp/PorizoApp/Models/StoryModels.swift`. Runtime session state lives in `PorizoApp/PorizoApp/V2Story/V2StoryTypes.swift` and `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`. The main review/editor surface is `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`. The create-flow container that switches between drafting, review, and downstream creation lives in `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`.

In this plan, “draft lifecycle” means the canonical state of the story draft as it moves between active drafting, review-ready, confirmed, and reopened editing. “Revision operation” means a user edit with explicit intent such as append, replace, remove, resolve conflict, or final notes. “Provenance” means the exact story draft version and engine metadata used to generate a song or poem.

## Plan of Work

The first milestone is the contract layer. `src/writer/v3/state.js` will gain explicit draft lifecycle and revision-operation metadata instead of only coarse `status` and freeform revision text. `src/writer/v3/index.js` will persist a normalized revision entry for every review edit, store snapshots needed for diff/history, expose conflict and provenance metadata, and return resume comparison data. `src/routes/story.js` and `src/writer/index.js` will expose these new fields through additive response properties so existing flows keep working.

The second milestone is the app model layer. `StoryModels.swift`, `V2StoryTypes.swift`, `V2SessionStore.swift`, and `V2StoryEngine.swift` will adopt the expanded payloads, keep backward compatibility for persisted sessions, and record resume comparison state. `finishEarly()` will become a true lifecycle transition to review-ready rather than a local-only shortcut.

The third milestone is the review/editor surface. `StoryConfirmationView.swift` will be extended rather than replaced. It will add structured revision actions, a fact inventory, a conflict panel, dedicated final notes, revision history, and a before/after diff card while preserving the existing chat/story tabs and continue action. `CreateFlowView.swift` will keep the same flow shape but expose exact draft-provenance text into downstream song and poem transitions.

The fourth milestone is downstream provenance and validation. Song and poem creation views will surface which draft version they are using, and end-to-end simulator QA will verify the full path from story revision through downstream generation.

The final milestone is technical debt cleanup. The unrelated Swift concurrency warnings called out in the build will be fixed so the build surface is clean enough to trust future story-editor changes.

## Concrete Steps

Work from the repository root: `/Users/ao/Documents/projects/porizo`.

Read and search before each milestone:

    rg -n "review_ready|confirmed|revision|provenance|finishEarly|lastIntegrationDelta" src PorizoApp/PorizoApp

Backend validation after backend changes:

    npm run lint
    npm test

Swift validation after Swift changes:

    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build

Simulator QA after the code lands:

    Use XcodeBuildMCP build/run tools to launch the app and manually verify:
      1. Start a story.
      2. Finish into review.
      3. Apply a structured review edit.
      4. Resolve a clarification request if asked.
      5. Confirm and continue into song.
      6. Repeat from story into poem.

## Validation and Acceptance

Acceptance is behavior, not only passing tests.

The work is done when all of the following are true:

Users can review a story draft and choose a structured edit intent such as add, replace, remove, or resolve conflict without leaving the review screen.

The review screen shows revision history and a readable before/after view for the most recent change.

If a revision needs clarification, the UI shows that as an explicit pending state and keeps the user in a coherent review-edit loop.

`finishEarly()` produces a canonical review-ready state on the server. Reopening a confirmed draft creates a visible reopened editing state rather than pretending the prior confirmation never happened.

The app can tell the user when the server draft version changed during resume, and it handles that case explicitly instead of silently overwriting or ignoring it.

Song and poem creation continue to work from the same user-visible flow, and the UI shows the exact draft version that will be used downstream.

The repo validations pass:

    npm run lint
    npm test
    iOS simulator build succeeds

The simulator QA pass should produce a short evidence log showing that revise, clarify, confirm, song, and poem flows all still work.

## Idempotence and Recovery

All contract changes must be additive so existing persisted sessions can still decode on iOS and existing clients can still call the backend. New response fields must be optional from the Swift side until the migration is complete. If a specific UI surface fails during rollout, the recovery path is to keep the current conversation drafting and review flow working while hiding only the new structured-editor affordances. No step should require destructive data resets.

## Artifacts and Notes

This plan will be updated with evidence snippets as milestones land.

## Interfaces and Dependencies

The backend story contract must continue to flow through `src/routes/story.js` -> `src/writer/index.js` -> `src/writer/v3/index.js` -> `src/database/story-repository.js`.

The iOS story contract must continue to flow through `PorizoApp/PorizoApp/APIClient+Story.swift` -> `PorizoApp/PorizoApp/Models/StoryModels.swift` -> `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift` -> SwiftUI views.

By the end of this work, the backend must expose explicit draft lifecycle metadata, structured revision entries, revision history, diff payloads, open conflicts, resume comparison metadata, and downstream provenance. The iOS app must decode and present those fields without breaking older cached sessions.
