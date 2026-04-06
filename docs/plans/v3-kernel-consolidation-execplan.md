# Consolidate Writer V3 Into Kernel-Driven Turn Processing

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain a repo-local `PLANS.MD`, so this document follows `~/.codex/PLANS.MD` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a multi-turn story conversation will behave like a consistent software system instead of a large prompt that happens to work sometimes. A user will be able to answer several questions without the system circling the same semantic area, and the server will be able to explain why it asked the next question. The user-visible result is fewer repeated questions, fewer prompt overflows, more predictable completion, and clearer production diagnostics when a conversation does go wrong.

The durable goal is to make `src/writer/v3` kernel-dependent. “Kernel-dependent” in this plan means that the source of truth for turn-to-turn behavior is the typed state, deterministic gap analysis, deterministic planning, and explicit completion policy. Large prompts become narrow adapters that extract structured deltas or phrase wording. They no longer decide the overall turn flow.

This plan keeps the public `v3` runtime and its battle-tested behavior, but it changes the internal control path so `continueStoryV3` becomes capture -> ingest -> merge state -> plan -> compose, with telemetry and hard prompt budgets. This is a structural refactor, not a prompt-tuning pass.

## Progress

- [x] (2026-04-06 16:40Z) Reviewed `~/.codex/PLANS.MD` and confirmed the required ExecPlan format for this repository.
- [x] (2026-04-06 16:43Z) Re-read the key `v3` files that govern state, planning, prompts, and turn orchestration: `src/writer/v3/state.js`, `src/writer/v3/index.js`, `src/writer/v3/prompts/builder.js`, and `src/writer/v3/reasoner.js`.
- [x] (2026-04-06 16:51Z) Created this detailed ExecPlan in `docs/plans/v3-kernel-consolidation-execplan.md`.
- [x] (2026-04-06 15:05Z) Extracted canonical kernel types into `src/writer/v3/kernel/types.js` and made `TurnDecision` construction explicit via `createTurnDecision()`.
- [x] (2026-04-06 15:07Z) Extracted the deterministic planner into `src/writer/v3/kernel/planner.js` and switched `src/writer/v3/index.js` to delegate planner logic there.
- [x] (2026-04-06 15:10Z) Built the offline replay harness in `test/writer/v3/replay-harness.test.js` so narrow ingestion could be validated before live turn wiring.
- [x] (2026-04-06 15:14Z) Implemented `src/writer/v3/kernel/ingestor.js` as a narrow extraction stage using an ingest projection and structured delta parsing.
- [x] (2026-04-06 15:16Z) Implemented `src/writer/v3/kernel/projections.js` so ingest and composition stages use allowlisted state views instead of the raw full state.
- [x] (2026-04-06 15:18Z) Implemented `src/writer/v3/kernel/composer.js` so the LLM now phrases the planner’s chosen action instead of deciding it.
- [x] (2026-04-06 15:31Z) Rewired `continueStoryV3` to the kernel path and kept the old `reasonWithFallback()` path only as an emergency fallback.
- [x] (2026-04-06 15:24Z) Implemented `src/writer/v3/kernel/budgeter.js` and `src/writer/v3/kernel/telemetry.js` and attached stage-budget and planner telemetry to the new turn flow.
- [x] (2026-04-06 15:35Z) Simplified `continueStoryV3` further by extracting turn execution and state stabilization helpers so the main loop reads as capture -> execute turn -> stabilize -> resolve -> persist -> return.
- [x] (2026-04-06 15:36Z) Re-ran full repo validation after the simplification pass: `npm run lint` passed and `npm test` passed with `343 tests, 336 pass, 0 fail, 7 skipped`.

## Surprises & Discoveries

- Observation: `v3` already contains the hard parts of the intended architecture. The typed state model is in `src/writer/v3/state.js`, and deterministic target planning is already present in `src/writer/v3/index.js`.
  Evidence: `createInitialState()` in `src/writer/v3/state.js` already stores facts, atoms, primitives, beats, evaluation, narrative versions, and revision state. `getElementTargetLedger()`, `scoreQuestionTargetCandidate()`, `rankQuestionTargetCandidates()`, and `shouldForceForwardProgressConfirm()` already exist in `src/writer/v3/index.js`.

- Observation: the architectural failure is not “missing state,” it is “prompt stages do not trust the state.” The broad prompt builders still re-inject too much overlapping context.
  Evidence: `buildContextPrompt()` in `src/writer/v3/prompts/builder.js` injects narrative, facts, atoms, primitives, motifs, dials, beats, gap targeting, conversation history, already-known, already-asked, and question targeting. `buildSelectionPrompt()` and `buildOutlinePrompt()` also still include large state and conversation sections. `buildWriterStagePrompt()` in `src/writer/v3/reasoner.js` then stacks base prompt + selection JSON + outline JSON.

- Observation: the first high-risk behavior change is not planner extraction; it is narrow ingestion. That stage can miss facts that the current broad pass accidentally recovers.
  Evidence: `continueStoryV3()` currently calls `reasonWithFallback()` once for a large all-in-one reasoning pass, then `applyReasoningResult()`, `enforceGrounding()`, deterministic fallback extraction, semantic integrity repair, and completed story package repair. Narrowing ingestion changes what enters that pipeline first.

- Observation: the simplest durable shape for `continueStoryV3()` is not “one giant orchestrator function” but “a small orchestrator over named steps.” The first kernel refactor improved boundaries but still left too much ceremony in the middle of the turn loop until helper extraction was done.
  Evidence: after the initial kernel wiring, `continueStoryV3()` still carried inline kernel/legacy branching plus package-repair and condensation bookkeeping. Extracting `executeTurnFlowWithFallback()` and `stabilizeTurnStateAfterFlow()` reduced the main loop to the actual lifecycle steps and cut more inline control noise out of `src/writer/v3/index.js`.

- Observation: the prompt-builder tests exposed a real coupling bug that predated the kernel refactor. The selection prompt templates implicitly depended on `already_known` content but the current template no longer included the placeholder consistently.
  Evidence: validation surfaced failures in `builder.js` and `reason-v3-selection.md`; the fix was to restore `{{already_known}}` in the selection template and only inject anti-repetition rule text in `buildContextPrompt()` when story-state guidance is actually present.

## Decision Log

- Decision: keep the runtime version as `v3` and refactor internals rather than building a parallel `v4` runtime first.
  Rationale: the existing `v3` state kernel, planner logic, gap analysis, and completion policy already exist and are covered by a large test suite. Rebuilding them in a parallel runtime would spend time recreating reliable behavior instead of fixing the real failure, which is prompt discipline and responsibility separation.
  Date/Author: 2026-04-06 / Codex

- Decision: define a canonical `TurnDecision` type before any behavior-changing refactor.
  Rationale: the current decision shape already mostly exists around `buildDecisionResult()` in `src/writer/v3/index.js`, but it is implicit. The migration will be safer if planner, composer, telemetry, and orchestration all speak one validated internal contract from day one.
  Date/Author: 2026-04-06 / Codex

- Decision: require an offline replay harness before the new ingestor is allowed to govern live turn flow.
  Rationale: the narrow ingestor is the first place where the new architecture can silently lose extraction quality. A replay harness compares old-path versus new-path state deltas without doubling live LLM costs in production.
  Date/Author: 2026-04-06 / Codex

- Decision: the first user-visible milestone is the question loop path, not the later story drafting/editor path.
  Rationale: question targeting and completion instability are the current product failures. Story drafting can remain more prompt-heavy temporarily as long as the conversation loop becomes kernel-driven and predictable.
  Date/Author: 2026-04-06 / Codex

- Decision: simplify the orchestrator after the kernel modules are in place rather than stopping once behavior is correct.
  Rationale: the user requirement is not only correctness but elegance. The first kernel pass improved responsibility boundaries but left `continueStoryV3()` more procedural than necessary. Extracting named helpers for turn execution and stabilization reduced the mental load of the main control path without changing behavior.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

This plan was implemented. The core result is that the normal `continueStoryV3()` path is now kernel-driven: capture the new turn, ingest a narrow structured delta, merge it into state, plan deterministically, compose wording, then run the existing integrity and package-repair safety rails. The old broad `reasonWithFallback()` path is still present, but it is now an emergency fallback instead of the normal turn engine.

The code is materially simpler than the starting point, but not because there are fewer modules. It is simpler because the responsibilities are more legible. `src/writer/v3/index.js` is no longer the sole owner of types, planner logic, ingestion, composition, budgeting, and telemetry. Those concerns now live under `src/writer/v3/kernel/`, and the main turn loop reads like the actual system lifecycle instead of a long sequence of incidental details.

Validation evidence for the implemented state:

- `node --test test/writer/v3/decision-arbitration.test.js test/writer/v3/question-targeting.test.js test/writer/v3/question-enforcement.test.js test/writer/v3/orchestration.test.js`
- `node --test test/writer/v3/replay-harness.test.js test/writer/v3/story-state-tracking.test.js test/writer/v3/story-state-hydration.test.js`
- `npm run lint`
- `npm test`

The last full-suite run passed with `343 tests, 336 pass, 0 fail, 7 skipped`.

What remains intentionally not “perfectly minimal” is the safety net. `continueStoryV3()` still retains the legacy reasoning fallback and the downstream grounding/semantic/package repair passes. That is deliberate. Removing those now would make the code shorter but less durable. The current state is a better trade: the normal path is cleaner and kernel-driven, while the recovery rails remain in place until enough production evidence exists to remove more of the old path safely.

## Context and Orientation

The current `v3` story runtime lives in `src/writer/v3`. The highest-impact files for this plan are `src/writer/v3/index.js`, which currently orchestrates story start, continue, confirmation, deterministic turn arbitration, semantic repair, and package repair; `src/writer/v3/state.js`, which defines the durable typed state; `src/writer/v3/reasoner.js`, which runs the current multi-stage LLM pipeline; and `src/writer/v3/prompts/builder.js`, which assembles the broad prompt stages.

The current turn flow for `continueStoryV3()` in `src/writer/v3/index.js` works like this. It captures the latest answer, adds it to conversation state, computes retained details, calls `reasonWithFallback()` in `src/writer/v3/reasoner.js`, applies the returned structured result through `applyReasoningResult()`, enforces grounding, runs deterministic fallback extraction, runs semantic integrity repair, repairs the completed story package, computes gap analysis, and then runs deterministic turn arbitration through helpers in the same file before returning a question or confirmation. The important problem is that the LLM reasoning stages do both extraction and control-flow influence while being given too much shared context.

The term “kernel” in this plan means the software-owned state, gap analysis, planner logic, completion logic, and telemetry contracts. The term “ingestor” means a narrow LLM-assisted extraction stage that reads the latest answer and returns a structured delta. The term “composer” means a narrow LLM-assisted wording stage that phrases a question or confirmation after the planner has already decided the action and target. The term “projection” means a strict allowlisted subset of the full state model prepared for one specific stage. The term “replay harness” means an offline test runner that replays stored real turns through old and new code paths and compares extracted state and decisions.

The existing test surface in `test/writer/v3` is large and should be treated as an asset. The most relevant current tests for this plan are `decision-arbitration.test.js`, `question-targeting.test.js`, `question-enforcement.test.js`, `reasoner-budget.test.js`, `story-state-hydration.test.js`, `semantic-integrity.test.js`, `e2e-story-flow.test.js`, `e2e-adversarial.test.js`, and `orchestration.test.js`. Full-suite counts should be recorded as they exist at the time of each implementation slice rather than assumed from this document.

## Interfaces and Dependencies

At the end of this work, the following new modules must exist under `src/writer/v3/kernel/`.

`types.js` must export JSDoc-backed validators and constructor helpers for at least these shapes: `TurnDecision`, `TurnDelta`, `PlannerCandidate`, `StageProjection`, and `StageBudgetResult`. `TurnDecision` must contain `action`, `targetElement`, `targetSlot`, `reason`, `alternatives`, `confidence`, and `source`. `TurnDelta` must contain only structured state changes from the latest answer, such as facts to add, atoms to patch, primitives to patch, evaluation hints, evidence links, and uncertainty or ambiguity flags. `PlannerCandidate` must represent scored candidate targets with all numbers needed to explain ranking. `StageProjection` must be an explicit object returned by allowlist builders, not a filtered copy of the full state object.

`planner.js` must own deterministic question targeting and completion escape logic. It will receive the current canonical state and computed gap analysis and return a validated `TurnDecision`. It must not call the LLM. The functions extracted from `src/writer/v3/index.js` should be moved here first with zero intentional behavior change. Only after extraction is validated should planner behavior itself be tuned.

`ingestor.js` must own the LLM call that converts the latest answer into a `TurnDelta`. It depends on `projections.js`, `types.js`, and a thin LLM adapter from `reasoner.js` or a small wrapper extracted from it. The ingestor prompt must not include full conversation history, full facts inventory, or large broad-context prompt sections. It should receive only the latest answer, the previous asked question, recipient and occasion, a small canonical narrative summary, and the minimum slot/evidence context needed to map the answer safely.

`projections.js` must export at least `buildIngestProjection()`, `buildPlannerProjection()`, `buildQuestionComposeProjection()`, and `buildConfirmComposeProjection()`. Each function must be an allowlist. If a new property is needed later, that property must be added explicitly rather than by passing through a larger parent object.

`composer.js` must own question and confirmation phrasing. The composer depends on `TurnDecision`, the relevant projection, and a small prompt template. It must not return or mutate the next action. The planner remains authoritative.

`budgeter.js` must estimate token usage for each prompt block before the prompt is assembled. It must rank blocks by priority and drop lower-priority blocks deterministically when a stage budget is exceeded. Stage budgets should exist for `ingest`, `questionCompose`, `confirmCompose`, and any later story compose path that is migrated.

`telemetry.js` must log structured kernel diagnostics. It depends on the planner, projections, budgeter, and orchestrator. It must log enough to explain why a question was asked and what prompt blocks were included or dropped, without logging unsafe raw full transcripts beyond the already accepted preview/truncation pattern used elsewhere in the repo.

The current modules that remain but change responsibilities are `src/writer/v3/index.js`, which becomes an orchestrator; `src/writer/v3/reasoner.js`, which becomes a thin LLM adapter layer and should stop governing turn selection; and `src/writer/v3/prompts/builder.js`, which should eventually stop participating in turn-to-turn selection and broad context assembly for the normal `continue` path.

## Plan of Work

The work begins by making the kernel contract real. Add `src/writer/v3/kernel/types.js` and extract the current implicit decision shape around `buildDecisionResult()` into an explicit validated object. This first slice must not change behavior. It should only make the current planner contract visible and enforced. Update `src/writer/v3/index.js` to construct and return `TurnDecision` objects through the new helper so later modules have a fixed contract to depend on.

Once the type contract exists, extract deterministic planning into `src/writer/v3/kernel/planner.js`. Move the pure functions that compute ledgers, candidate scores, repeated-question detection, forward-progress confirm, and target ranking out of `src/writer/v3/index.js`. Keep the exported function signatures narrow: planner input should be the current state, computed gap analysis, and any direct target hints; planner output should be a validated `TurnDecision` plus candidate metadata. During this phase, keep imports and orchestration in `index.js` simple wrappers so behavior remains unchanged.

Before building the new ingestor, add an offline replay harness in `test/writer/v3/replay/`. The harness should load captured turn fixtures that include recipient metadata, previous question, latest answer, pre-turn state, and current expected outputs. It should be able to run the current old path and, later, the new narrow ingestion path on the same fixture and report diffs for facts, atoms, primitives, readiness-affecting state, and planner input. Start with a few replay fixtures from known repeated-question sessions and known good multi-turn sessions. The replay harness is the gate that allows the narrow ingestor to go live.

After the replay harness exists, add `src/writer/v3/kernel/projections.js` and define the exact projection builders the new stages will use. Build `buildIngestProjection()` first. It should expose recipient name, occasion, a short narrative summary, the previous asked question, recent unanswered or weak slots, a small evidence summary for the most relevant slots, and no broad transcript history. Then build `buildPlannerProjection()` for telemetry and debugging, although planner logic itself can operate on full state internally because it is deterministic and local. Add question and confirm compose projections next, each with only the fields required to phrase wording.

Then add `src/writer/v3/kernel/ingestor.js`. The ingestor should call a new narrow prompt path through the LLM adapter layer. It should not reuse the old `buildContextPrompt()` or the old stage stack from `reasoner.js`. Instead, add a dedicated ingestion prompt builder with a small schema and a parser that returns `TurnDelta`. The orchestrator in `src/writer/v3/index.js` should initially run this ingestor behind a temporary internal flag or guarded code path and compare its output to the current old reasoning output through the replay harness and targeted tests. Do not let the ingestor become the only live path until replay parity is acceptable.

Once ingestion quality is acceptable, add `src/writer/v3/kernel/composer.js`. Start with question composition only. The input should be the planner’s `TurnDecision` and a question compose projection. The output should be one question string and optional suggestion strings if those are still required by the current API. The composer prompt must explicitly say that the target element and action are already decided and must not be changed. A confirmation composer should follow the same pattern, taking a confirm decision and confirm projection and returning wording only.

With ingestor, planner, projections, and composer ready, rewire `continueStoryV3()` in `src/writer/v3/index.js` to the new orchestrated sequence. The revised flow should be: capture the user answer and update conversation; build ingest projection; run the ingestor to get `TurnDelta`; merge the delta into canonical state through existing state update helpers or a new small merger module; run grounding, semantic integrity, and package repair as needed; compute gap analysis; run the deterministic planner to get `TurnDecision`; run the composer to phrase the chosen action; return the composed wording and preserve the current response shape expected by the rest of the app. Keep the deterministic fallback extraction path until replay and production logs show the ingestor is stable.

After the new turn path works, add `src/writer/v3/kernel/budgeter.js` and `src/writer/v3/kernel/telemetry.js`. The budgeter must run before prompt assembly for each new stage. The telemetry module should log the ingest projection size, dropped prompt blocks, planner candidates, chosen reason, suppressed repeated targets, and any completion overrides. Once these are in place, retire the legacy broad-context prompt path for normal `continue` flow. Leave any remaining drafting/editor prompt paths alone until a later phase if they are not on the critical user loop.

The final cleanup step is to make sure the old broad turn path cannot accidentally re-enter through future edits. Remove or strongly deprecate the code paths in `src/writer/v3/reasoner.js` and `src/writer/v3/prompts/builder.js` that still govern question selection or broad-context arbitration for normal `continue` flow. Keep only what is still required for later story drafting paths that have not yet been migrated. Update tests so they assert the new kernel stages are the path used for normal turn progression.

## Concrete Steps

All commands below are run from the repository root:

    cd /Users/ao/Documents/projects/porizo

Before touching code, re-open the files that define the current turn path:

    sed -n '1,260p' src/writer/v3/state.js
    sed -n '2260,2485p' src/writer/v3/index.js
    sed -n '300,860p' src/writer/v3/prompts/builder.js
    sed -n '980,1165p' src/writer/v3/reasoner.js

The first implementation slice adds `src/writer/v3/kernel/types.js` and `src/writer/v3/kernel/planner.js` without changing behavior. After those files are created and `index.js` is updated to use them, run focused planner and orchestration tests:

    node --test test/writer/v3/decision-arbitration.test.js test/writer/v3/question-targeting.test.js test/writer/v3/question-enforcement.test.js test/writer/v3/orchestration.test.js

Expect all selected tests to pass. The exact counts may change over time; record the actual numbers when run.

The second implementation slice adds the replay harness. Create replay fixtures under `test/writer/v3/replay/fixtures/` and a harness test such as `test/writer/v3/replay-harness.test.js`. Run:

    node --test test/writer/v3/replay-harness.test.js

Expect fixture loads to pass and diff output to be empty or explicitly accepted for known tolerated differences. A short expected transcript for a passing replay harness should look like this:

    TAP version 13
    # Subtest: replay harness preserves core extraction fields for repeated-question session
    ok 1 - replay harness preserves core extraction fields for repeated-question session
    1..1
    # pass 1

The third implementation slice adds `kernel/projections.js` and `kernel/ingestor.js`. At first, wire the ingestor into tests only. Add targeted tests for delta extraction and projection scoping, then run:

    node --test test/writer/v3/story-state-tracking.test.js test/writer/v3/story-state-hydration.test.js test/writer/v3/replay-harness.test.js

Only after replay parity is acceptable should `continueStoryV3()` begin to use the ingestor in the live path. When that wiring lands, run:

    node --test test/writer/v3/e2e-story-flow.test.js test/writer/v3/e2e-adversarial.test.js test/writer/v3/orchestration.test.js test/writer/v3/semantic-integrity.test.js

The fourth implementation slice adds `kernel/composer.js`, rewires `continueStoryV3()` to capture -> ingest -> merge -> plan -> compose, and preserves the current safety rails. Run:

    node --test test/writer/v3/decision-arbitration.test.js test/writer/v3/question-targeting.test.js test/writer/v3/question-enforcement.test.js test/writer/v3/e2e-story-flow.test.js test/writer/v3/e2e-adversarial.test.js

The fifth implementation slice adds `kernel/budgeter.js` and `kernel/telemetry.js`, then retires the old broad turn path. At that point, run the full writer suite and then the full repo suite:

    node --test test/writer/v3/*.test.js
    npm run lint
    npm test

When production rollout is reached, deploy in the same safe pattern used elsewhere in this repo: commit the isolated changes, create a clean temporary worktree at that commit if the main worktree is dirty, and deploy from the clean worktree. After deployment, inspect Railway logs for the new planner and budget telemetry fields and replay at least one real multi-turn conversation.

## Validation and Acceptance

The work is complete only when a real multi-turn conversation demonstrates that the system no longer circles the same semantic area even after multiple detailed answers, and production logs can explain why the next question was asked. The acceptance behavior is user-visible, not merely structural.

Acceptance for the extraction and planner phases is that existing deterministic question-targeting tests stay green and the replay harness shows that the narrow ingestor preserves the facts, atoms, and primitives needed for the planner to behave correctly. A repeated-question fixture that currently loops should either shift to a different unresolved slot or trigger confirm earlier under the existing completion policy.

Acceptance for the live turn refactor is that `continueStoryV3()` no longer depends on broad `buildContextPrompt()`-style turn processing for normal question selection. A production or replayed session with at least three `continue` turns should show, in logs, that the planner chose a target based on unresolved or weak slot pressure, and that the composer only phrased that target rather than replacing it.

Acceptance for budgeting is that no normal multi-turn `selection`-equivalent stage overflows because prompt blocks are dropped before assembly rather than compacted after the fact. Production logs should show block breakdown and dropped blocks whenever a stage approaches its budget. The expected operational sign is fewer `MAX_TOKENS` failures in question flow stages.

Acceptance for telemetry is that one log line can explain a turn in plain language. It should answer: what changed in state after the user answer, what the planner considered, why the winning target won, what alternatives lost, whether any repeated-target suppression happened, and what prompt blocks were included or dropped.

## Idempotence and Recovery

The extraction-only phases are safe to repeat. Creating `kernel/types.js`, `kernel/planner.js`, and the replay harness should not alter runtime behavior if done correctly. If a planner extraction PR behaves differently, roll back by restoring `index.js` to its pre-extraction imports and wrappers while leaving the extracted module in place for later correction. That rollback is safe because the planner extraction phase is supposed to be mechanical.

The first risky phase is the ingestor rollout. Do not delete the old fallback extraction path until the replay harness is trusted and new e2e tests are green. If the new ingestor misses important facts in live behavior, the safe recovery path is to route `continueStoryV3()` back to the old reasoning path while keeping the replay harness and new modules intact for debugging. That rollback is a small orchestrator change, not a data migration.

The composer rollout is also recoverable. If thin composition produces low-quality or awkward questions, the safe rollback is to keep the planner authoritative but temporarily restore the older wording path while preserving the new planner and projections. Do not let the rollback reintroduce LLM action authority.

Budgeter and telemetry changes should be idempotent. If a budget threshold is too aggressive and harms output quality, adjust the stage budget or block priorities without removing the budgeting module itself. The rule is to tune limits, not to restore unbounded prompt assembly.

## Artifacts and Notes

The most important evidence snippets to preserve during implementation are the before-and-after orchestration shapes. For the current state, the critical evidence is that `continueStoryV3()` in `src/writer/v3/index.js` presently calls `reasonWithFallback()` with a broad retained-details context and then applies the result through multiple repair stages. That proves the current coupling between extraction and decision. For the target state, the most important snippet is the new orchestrator shape, which should read conceptually like this:

    captureTurn(...)
    const ingestProjection = buildIngestProjection(state, previousQuestion)
    const delta = await ingestTurn(ingestProjection, answer)
    state = mergeTurnDelta(state, delta)
    state = enforceGrounding(state)
    state = ensureSemanticStoryIntegrity(state)
    const gapAnalysis = computeStoryGapAnalysis(state)
    const decision = planNextTurn({ state, gapAnalysis, forceConfirm })
    const output = await composeTurn(decision, buildQuestionComposeProjection(state, decision))

Another important artifact is the replay diff report. Preserve a concise example that shows parity on a previously problematic session:

    session: repeated-easter-story
    old facts added: 3
    new facts added: 3
    old targetElement: evaluation
    new targetElement: orientation
    difference accepted: yes, because new planner correctly promotes unresolved slot

The final artifact to preserve is a production log example after rollout that shows planner and budget telemetry. The exact field names may evolve, but a healthy log line should contain the decision source, target reason, alternatives, block breakdown, and dropped blocks.

## Dependency and Sequencing Narrative

The dependency order in this plan is strict and should not be rearranged casually. `kernel/types.js` comes first because planner, ingestor, composer, telemetry, and orchestration all need a shared contract. `kernel/planner.js` comes second because extracting deterministic logic is low risk and gives the rest of the refactor a stable boundary. The replay harness comes third because the next phase, narrow ingestion, is the first real behavior change and must be validated before rollout.

`kernel/ingestor.js` depends on `types.js` and `projections.js`, so the ingest projection should exist before or alongside the ingestor. The composer depends on both the planner’s `TurnDecision` and the compose projections, so it should not land before those boundaries are in place. Rewiring `continueStoryV3()` is deliberately late because it is the first time the new modules govern live user behavior. Budgeter and telemetry come after the new path exists because they need the new stage boundaries to instrument. Retirement of the old broad-context prompt path is last because deleting it earlier would remove the safety net before parity is proven.

This sequencing also preserves user value. The first changes are invisible but de-risk the migration. The first user-visible improvement should arrive when the new turn path goes live: fewer repeated questions and more consistent completion behavior. Prompt budget stability and richer telemetry then follow immediately behind that, because they depend on the existence of the new narrow stages.

## Milestones

The first milestone is “make the kernel contract explicit.” The goal is to define the canonical decision and candidate shapes and extract the planner without changing behavior. The work is `kernel/types.js` and `kernel/planner.js`. The result is that question targeting logic becomes an isolated module with the same outputs as before. The proof is unchanged focused test behavior and `index.js` using the extracted planner module rather than hosting the logic directly.

The second milestone is “make extraction narrow and measurable.” The goal is to replace the current broad reasoning extraction step with a narrow ingestor that updates state rather than deciding the next action. The work is the replay harness, projections, and `kernel/ingestor.js`. The result is a structured delta stage with parity evidence against stored real turns. The proof is passing replay tests and acceptable diff outputs on real problematic sessions.

The third milestone is “make planning authoritative and composition thin.” The goal is to ensure the LLM no longer governs question control flow. The work is `kernel/composer.js` and orchestrator rewiring in `index.js`. The result is that the planner decides the action and target, and the composer only phrases it. The proof is that repeated-question behavior improves in e2e tests and the prompt builders used in the live turn path no longer include broad transcript replay.

The fourth milestone is “make the turn path observable and budgeted.” The goal is to prevent prompt blowups by design and to explain each turn in logs. The work is `kernel/budgeter.js`, `kernel/telemetry.js`, and removal of the old broad turn path. The result is that the live turn path is both smaller and explainable. The proof is fewer prompt overflows in live logs and structured planner/budget telemetry on real sessions.

## Revision Note

This initial version of the ExecPlan incorporates two explicit adjustments from review. First, it elevates the internal turn-decision contract into a real code-level type module instead of leaving it as a prose-only contract. Second, it makes the replay harness a hard dependency before the narrow ingestor is allowed to drive production behavior. These changes reduce the highest migration risk without diluting the first-principles architecture.
