---
title: "fix: Close web funnel launch QA"
date: 2026-07-15
type: fix
origin: web-funnel/design/QA-FINDINGS-2026-07-15.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: refreshed-design-package
execution: code
depth: standard
---

# Close the web funnel launch QA findings

This ExecPlan is a living document maintained in accordance with `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, a buyer can enter `/create` without stale checkout state trapping them, pass an honestly configured bot check, move through the intended compact quiz, experience accurate generation and preview states, and finish on a share-first success page. The refreshed `web-funnel/design/` package and `docs/design/2026-07-15-web-funnel-design-spec.md` are the visual and behavioral source of truth. The older browser capture in `QA-FINDINGS-2026-07-15.md` is evidence, not a replacement source snapshot.

## Goal Capsule

- **Objective:** Resolve every repo-owned launch finding, add the missing regressions, and prove the integrated page at 390×844 and 1440×900.
- **Authority:** Refreshed design package, design behavior spec, CODEX brief, then `specs/web-funnel-spec.md`; the curated QA report supplies observed defects.
- **Execution profile:** Test-first fixes in bounded slices, one integrated Compound code review, then focused, module, full, and browser gates.
- **Stop conditions:** Do not implement the separately owned U1–U3 backend endpoints or extend the app/server Occasion enum. Stop deployment work because this plan authorizes code and a scoped commit, not production release.
- **Tail ownership:** This session owns tests, documentation, browser evidence, review fixes, strict preflight, and a scoped commit.

## Progress

- [x] (2026-07-15 01:25Z) Read the refreshed design/spec package, curated QA report, current implementation, project instructions, and relevant Compound/Impeccable skills.
- [x] (2026-07-15 01:38Z) Run scoped preflight and classify all 17 findings against current HEAD rather than blindly replaying the older review.
- [x] (2026-07-15 01:45Z) Create the trackable status ledger in `web-funnel/design/QA-TODO-2026-07-15.md`.
- [x] (2026-07-15 02:02Z) Review this plan with coherence, feasibility, design, scope, security, and adversarial lenses; incorporate accepted findings before implementation.
- [x] (2026-07-15 03:12Z) U1: add regressions and fix fresh-entry recovery, reset placement/confirmation, entry layout, and success re-entry behavior.
- [x] (2026-07-15 03:28Z) U2: add typed Turnstile failures, dev/preview test-key configuration, and production build validation.
- [x] (2026-07-15 03:44Z) U3: correct generation progress thresholds and close theater/API lifecycle coverage.
- [x] (2026-07-15 03:58Z) U4: finish preview, lyric-sheet, font, animation, and copy fidelity without reworking already-correct rails or dim choreography.
- [x] (2026-07-15 04:08Z) U5: repair homepage prefill and dependency reproducibility.
- [x] (2026-07-15 04:36Z) Run one consolidated Compound code review, implement accepted findings, and rerun only invalidated focused gates.
- [x] (2026-07-15 05:09Z) Run affected frontend gates, root release gate, integrated browser QA, strict preflight, explicit staging, and scoped commit preparation. The commit identifier is recorded after creation.

## Surprises & Discoveries

- Observation: The QA report was captured at commit `2d437de2`, while current HEAD includes later polish in `3215dee2` and site integration in `6cb2071c`.
  Evidence: relationship auto-advance and the 900ms dim/reduced-motion choreography are present in current source; their missing targeted proofs remain, but their production implementations must not be repeated.
- Observation: Occasion prefill already follows the intended sequential state machine on a cold entry.
  Evidence: `resolveInitialState` preselects the answer but leaves `activeStep` at recipient; `funnelReducer` advances sequentially and `QuizFlow` still renders the selected Occasion chip and date field.
- Observation: Backend U1–U3 endpoints and an official API mock mode remain external process dependencies.
  Evidence: the QA report marks them “for the backend track, not Codex,” and CODEX-BRIEF forbids backend edits in this slice.
- Observation: The integrated review found that a resumable draft could be overwritten by typing before the user chose Resume/Start over, and that a resumed Theater did not reattach its polling loop.
  Evidence: the pickup input is now disabled until the explicit choice, and an App regression proves a resumed generation reattaches by job id.
- Observation: There is no backend endpoint for the Theater's 150-second hold-email action.
  Evidence: the component exposes and tests the affordance only when an actionable callback exists; production omits the false promise until the separately owned endpoint is available.
- Observation: The final browser journey is request-intercepted because the backend-owned `/web/*` surface is not present in this branch.
  Evidence: same-origin shell/layout evidence is live, while the quiz-through-preview path is explicitly recorded as stubbed frontend proof rather than live integration.

## Decision Log

- Decision: Classify findings as OPEN, IMPLEMENTED—PROOF MISSING, VERIFIED BEHAVIOR—TEST MISSING, PARTIAL, or EXTERNAL instead of treating the old QA list as current state.
  Rationale: This prevents duplicate work and regressions while preserving missing proof as launch work.
  Date/Author: 2026-07-15 / Codex.
- Decision: Route precedence is explicit: success plus `session_id` enters success; `cancelled=1` plus valid offer artifacts restores offer; an unexpired non-terminal draft is offered through the S0 “Pick up {recipient}'s song where you left off” card; a terminal/stale order phase never hijacks plain entry. Stored drafts carry a seven-day timestamp. Resume restores the candidate, while start over clears only funnel state and preserves guest credentials.
  Rationale: This satisfies checkout recovery and resume safety without letting terminal browser storage override fresh route intent or abuse controls.
  Date/Author: 2026-07-15 / Codex.
- Decision: Repoint the homepage Father's Day pill to `?occasion=Custom` and keep its visible label until the family enum is extended in the separately owned app/server track.
  Rationale: The live marketing promise remains visible while the funnel receives a valid, reviewable selection instead of silently dropping it.
  Date/Author: 2026-07-15 / Codex.
- Decision: Use Cloudflare's always-pass site key only in Vite development and preview modes; make ordinary production builds throw when `VITE_TURNSTILE_SITE_KEY` is absent.
  Rationale: Local QA must work without a secret, while production must never ship a funnel blocked at step zero.
  Date/Author: 2026-07-15 / Codex.
- Decision: Reject Cloudflare test keys in ordinary production builds, not merely empty keys. `.env.development` and `.env.preview` may contain the always-pass key; preview is built explicitly with `vite build --mode preview`. Docker accepts a public build argument named `VITE_TURNSTILE_SITE_KEY` and must reject missing or test values.
  Rationale: A presence-only guard would allow the local bypass to ship as production security configuration.
  Date/Author: 2026-07-15 / Codex.
- Decision: The exact Turnstile messages are “This page isn't configured to start a song. Please try again later.” for configuration, “We couldn't connect to the security check. Check your connection and try again.” for loading/network, and “We couldn't verify this request. Please try again.” for bot-check rejection/expiry/timeout.
  Rationale: Claude's accepted finding requires distinct honest taxonomy; fixing the strings in the reviewed plan prevents implementation-time copy invention.
  Date/Author: 2026-07-15 / Codex.
- Decision: Keep the requested reset controls because the curated QA explicitly authorizes “Start over” confirmation and delivered “Make another song.” Confirmation copy is “Your song for {recipient} will be lost.” Reset replaces the URL with `/create#recipient`, stops polling, clears only funnel state, and preserves guest access/refresh tokens.
  Rationale: This later user-directed QA requirement resolves the interaction/copy gap left by the earlier mockup, while preserving abuse counters and preventing success-route resurrection.
  Date/Author: 2026-07-15 / Codex.

## Context and Orientation

`web-funnel/src/App.tsx` owns route initialization, guest-session creation, generation, checkout, and top-level phase rendering. `web-funnel/src/state/initial-state.ts` resolves storage, query prefill, and success deep links. `QuizFlow.tsx`, `Theater.tsx`, `LyricSheet.tsx`, `Preview.tsx`, and `Success.tsx` render the buyer journey. `turnstile.ts` is the bot-check boundary. `web-funnel/design/tokens.css`, `base.css`, and the mockups are the pixel contract; `src/styles.css` contains runtime-only composition. `public/index.html` owns landing entry links. The status ledger records which findings require production code and which require proof only.

## Plan of Work

### U1. Make route intent and destructive actions safe

Add a timestamped resume-candidate model and failing route-matrix tests: `/create/success?session_id=` enters success; `/create?cancelled=1` with valid offer artifacts restores offer; an unexpired quiz/theater/lyrics/preview draft remains resumable; plain entry with terminal or expired state renders S0 plus the saved-progress card where eligible; malformed state restarts. Keep the existing cold-success regression instead of duplicating it. Ensure initialization does not overwrite the saved candidate before Resume/Start over is chosen. Remove the global top control; put the explicitly authorized confirmed reset where it cannot collide with site navigation and “Make another song” below delivered sharing. Both actions clear only the funnel cache, preserve access/refresh tokens, stop order/job polling, and replace the URL with `/create#recipient`. First reproduce the mobile scroll and dead-void defect in a browser; retain the pixel-truth autofocus if it can focus with `preventScroll`, and remove it only if the evidence requires a source amendment. Fix entry-only shell/footer sizing without changing post-entry focus mode.

### U2. Make Turnstile configuration explicit

Introduce a small typed `TurnstileError` with configuration, loading/network, and verification codes and map the exact reviewed strings from the Decision Log in `App.tsx`. Prove every failure prevents `/web/session`, removes any widget/container, and permits a later retry. Add tracked `.env.development` and `.env.preview` files using Cloudflare's always-pass key plus `build:preview`/`preview` scripts that build with `--mode preview`. Export a pure environment validator used by Vite config: development/preview allow a documented test key, ordinary production rejects missing and every documented Cloudflare test key. Thread a public builder-stage `ARG`/`ENV VITE_TURNSTILE_SITE_KEY` through Docker, document it, and add source/build contracts without committing a production value.

### U3. Repair and prove the generation lifecycle

Extract the pure job-to-stage mapper and compare percentage values at 20/40/60/80, with table tests including 100. Preserve the already-green API silent-retry and second-failure tests; add only missing Theater monotonic/150-second tests, App wiring from the second failure to the visible retry card, and exact `/versions` plus `/lyrics/generate` request bodies. Do not modify backend status or response schemas already verified compatible.

### U4. Complete refreshed-design fidelity

Change the recipient placeholder to “Their name”; style only the recipient span in the lyric heading with the existing coral token; preserve the already-fixed absence of repeated kickers because refreshed `s6-preview.html` has none; add elapsed/total timecodes; test a preview source rerender and only add reset code if a reachable stale state fails; prove manual-scroll suppression and second-listen pulse; fix the animation iteration count; and preload both self-hosted variable fonts. Keep the already-correct horizontal choice rails, stacked summaries, centered shell, real site chrome, and dim choreography intact. Add source/browser assertions for the dim and reduced-motion branch rather than rewriting them.

### U5. Repair entry contracts and reproducibility

Map the homepage Father's Day link to `Custom`, update source and state tests so every advertised prefill resolves validly, replace every `latest` dependency with the exact installed compatible range from `package-lock.json`, and move build tooling to `devDependencies`. Regenerate the nested lockfile with npm; do not upgrade packages in this fix.

## Concrete Steps

From `/Users/ao/Documents/projects/porizo`, run focused tests after each red/green slice:

    npm --prefix web-funnel test -- --run src/App.test.tsx src/state/funnel.test.ts src/turnstile.test.ts
    npm --prefix web-funnel test -- --run src/steps/QuizFlow.test.tsx src/steps/Theater.test.tsx src/steps/Preview.test.tsx src/steps/LyricSheet.test.tsx src/steps/Success.test.tsx
    npm --prefix web-funnel test -- --run src/api/funnel.test.ts src/contracts/source.test.ts

Then run the affected module gate:

    npm --prefix web-funnel run lint
    npm --prefix web-funnel test
    npm --prefix web-funnel run build:preview
    npm --prefix web-funnel run build

The second command must fail without a key and must also fail with Cloudflare's always-pass key. Run the successful production gate with a non-test CI fixture accepted by the pure validator, then build Docker with the same public build argument when a Docker daemon is available. Never use the always-pass key for an ordinary production or Docker proof.

Start the main site with the repository watchdog. Separate same-origin entry/static evidence from a clearly labelled frontend journey whose absent `/web/*` responses are intercepted with deterministic fixtures; never call stubbed checkout live integration. Exercise `/create` at 390×844 and 1440×900 and save screenshots plus console/network evidence. Complete keyboard, contrast, and VoiceOver S6/R1 checks. Record TikTok iOS, Instagram iOS, Safari iOS, Chrome Android, and desktop Chrome/Safari as required launch evidence; unavailable real-device/webview rows remain explicit external evidence and block a claim that the launch gate is complete. Finally run the root validation command once because integration files include `public/index.html` and `Dockerfile`:

    npm run lint
    npm run agent:watch -- --estimate-minutes 10 -- npm test

Before commit:

    npm run agent:preflight -- --strict --scope web-funnel --scope public/index.html --scope Dockerfile --scope docs/plans/2026-07-15-002-fix-web-funnel-launch-qa-plan.md --scope tasks/lessons.md
    git diff --check
    git diff --cached --check

## Validation and Acceptance

Acceptance requires: the route matrix preserves unexpired non-terminal drafts and cancel returns, offers pickup at S0, expires candidates after seven days, and never lets terminal state hijack plain entry; `/create/success?session_id=x` still confirms/polls; reset preserves guest credentials, clears URL/order timers, and survives refresh; Birthday prefill remains visibly selected on S2 with the date input; relationship advances after 250ms while reduced motion keeps a Next fallback; production Turnstile validation rejects missing and test keys while preview accepts the test key; all Turnstile failures use the reviewed taxonomy, clean up, and never POST a session; progress 100 maps to Mixing without 1% doing so; entry has no involuntary scroll or footer void; the existing 900ms dim and reduced-motion instant branch both compute correctly; Father's Day enters Custom; preview exposes correct timecodes, pauses auto-scroll after manual movement, and pulses exactly once after the second listen; delivered “Make another song” is below sharing; lint, all frontend tests, bundle budget, root lint, and full root tests pass. Stubbed journey evidence is labelled, and the required accessibility/webview matrix is either complete or reported as remaining launch-blocking evidence.

## Idempotence and Recovery

Tests, Vite builds, and lockfile regeneration are safe to rerun. Do not delete or restore unrelated dirty files. If a dependency edit changes installed versions, restore only the four manifest/lockfile hunks from this task and reapply exact current versions. Browser servers must be stopped by PID after evidence is captured. Production deployment and backend endpoint creation are not recovery steps for this plan.

## Artifacts and Notes

The working ledger is `web-funnel/design/QA-TODO-2026-07-15.md`. The immutable evidence source is `web-funnel/design/QA-FINDINGS-2026-07-15.md`. Record focused red/green results, review dispositions, viewport screenshots, bundle size, full-test counts, and final commit here as work completes.

## Interfaces and Dependencies

The Turnstile boundary ends with `acquireTurnstileToken(): Promise<string>` and throws a typed error whose code is one of `configuration`, `network`, or `verification`. The stage mapper accepts the existing `JobStatus` and returns a zero-based Theater stage. `Success` receives a callback for “Make another song”; it does not reach into storage. No backend route, database schema, price, Occasion enum, or autoplay behavior changes.

## Outcomes & Retrospective

All 13 repo-owned open findings are implemented. The three behaviors that were already correct (#4 occasion prefill, #5 relationship auto-advance, and #8 dim choreography) received regression/browser proof without duplicate production rewrites, and the already-fixed kicker cleanup (#12) remains intact. The integrated review additionally hardened pickup-state ownership, resumed polling, Turnstile CDN stalls, checkout cancellation/idempotency, non-overlapping order polling, retry-stage reset, and failed/refunded recovery.

Current proof: 16 frontend files / 91 tests pass; frontend and root lint pass; preview and production-fixture builds pass; JavaScript is 147,933 bytes gzipped under the 153,600-byte budget; the full repository suite passes 3,223 tests with 23 skipped in 552 seconds; strict scoped preflight passes with zero staged paths outside scope; 390×844 and 1440×900 Chromium renders show a centered integrated site shell, zero initial scroll, compact entry/footer rhythm, horizontal choice rails, visible occasion prefill, and correct dim/reduced-motion behavior.

External launch evidence remains explicit: provision a real production Turnstile key, deliver the backend `/web/*` and hold-email endpoints, and complete Safari/iOS/Android webview plus VoiceOver/keyboard/contrast coverage. A local Docker daemon was unavailable, so Docker propagation is source/build-contract proof rather than a run image.
