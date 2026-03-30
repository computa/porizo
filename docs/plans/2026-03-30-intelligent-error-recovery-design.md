# Intelligent Error Recovery System — Design Document

**Reviewed:** 2026-03-30 by correctness, reliability, and API contract reviewers (26 findings incorporated)

## Overview

Replace Porizo's terminal-error pattern (~102 `sendError` calls in story routes, 33 `throw new Error` in V3 engine) with an intelligent recovery system that **resolves issues instead of giving up**. Two tracks: system errors auto-resolve silently; user input needs are guided with clear, contextual prompts — never generic error dialogs.

## Problem

Today, when the story confirmation fails because "needs one more detail," the user sees a modal dialog: **"Error — Failed to confirm story."** No context, no guidance, no recovery path. The user has to guess what went wrong. This pattern repeats across the entire pipeline — lyrics generation, render failures, voice conversion, provider rejections all surface as generic errors.

This is wrong. The system knows *exactly* what's wrong (missing detail, policy word, low quality score). It should either fix the problem itself or tell the user precisely what to do.

## Design Philosophy

**Two-track recovery based on who can fix it:**

1. **System errors → auto-resolve silently.** Timeout? Retry with backoff. Incomplete output? Retry with adjusted params. The user sees a progress indicator, not an error.

2. **User input needed → guide with a clear, contextual prompt.** Missing story detail? Show a friendly follow-up question in the conversation flow. Content moderation on user text? Help them rephrase with suggestions. Never an error dialog — always inline guidance.

**Critical constraints (from reviews):**

- **Sync routes (story confirm, continue):** Auto-resolve limited to **instant fixes only** (<100ms — parameter adjustments, threshold overrides). No LLM re-calls in the sync path. If recovery requires an LLM call, return `needs_input` immediately instead of making the user wait 30+ seconds.
- **Async pipeline (render steps):** Multi-attempt auto-resolve is fine — latency is hidden behind progress indicator.
- **Global attempt budget:** Recovery engine + job runner + DLQ auto-reprocessor share a single attempt ceiling to prevent retry multiplication (2×6×3 = 36 attempts without a cap).
- **Recovery engine self-failure:** The `handleWithRecovery` wrapper MUST have an unconditional outer try/catch that falls back to `sendError` — a bug in recovery cannot swallow the original error.

## Industry Patterns Incorporated

| Source | Pattern | How We Apply It |
|--------|---------|-----------------|
| **Stripe** | Hard/soft decline classification — classify before deciding recovery strategy | Every error classified on two axes: transient vs permanent, silent vs visible |
| **Stripe** | Smart Retries — vary retry timing by error type | Voice conversion needs longer cooldown than network blips |
| **TikTok** | Auto-save to Drafts on upload failure — never destroy work | Failed renders preserve completed steps as resumable drafts |
| **ChatGPT** | "Regenerate" button appears inline where response would be, not in a modal | Recovery prompts appear in the conversation flow, not alert dialogs |
| **WhatsApp** | Failed messages persist with retry icon — failure is a visible state | Failed renders show inline with "Tap to retry" — don't disappear |
| **NN/g + Google** | Error formula: [What happened] + [Why] + [Next step] | Every user-facing message follows this formula |
| **Smashing Magazine** | Optimistic UI rollback within 2 seconds of action | Low-stakes actions (reroll, regenerate) use optimistic UI |

## The Recovery Contract

### HTTP Status Codes (REVISED per API contract review)

| Track | HTTP Status | Rationale |
|-------|------------|-----------|
| **A: Auto-resolve success** | **200** | Normal success response with optional `_recovery` metadata |
| **B: User guidance needed** | **422** | Semantically correct ("understood but can't process without more input"). Old iOS already handles 422 in poem gap flow. Old clients decode `error`+`message` via `APIError` — degraded but functional (toast instead of inline). |
| **C: Terminal failure** | **400/500/503** | Existing error status codes with enhanced copy |

### Response Shapes

**Track A — Auto-resolve succeeded (user never knew):**
Normal success response shape (e.g., `{ confirmed: true, narrative: "..." }`). Optional debug metadata:
```json
{
  "confirmed": true,
  "narrative": "...",
  "_recovery": { "attempts": 1, "original_error": "E302_SUNO_POLICY_ERROR", "action": "lyrics_rewrite" }
}
```

**Track B — User guidance needed (HTTP 422):**

CRITICAL (per correctness review): Must include the original response model's required fields (e.g., `confirmed: false`) so old iOS `Codable` decoders don't crash. The `recovery` object is an additive optional field.

```json
{
  "confirmed": false,
  "status": "needs_input",
  "error": "STORY_NEEDS_DETAIL",
  "message": "Your story is almost ready! Tell me a bit more about what makes Chioma special to you.",
  "recovery": {
    "type": "missing_detail",
    "message": "Your story is almost ready! Tell me a bit more about what makes Chioma special to you.",
    "field": "follow_up_answer",
    "suggestions": ["A memory that always makes you smile", "Something only you two share"],
    "endpoint": "/story/{id}/continue",
    "context": { "detail_type": "emotional_significance", "coverage_pct": 85 }
  }
}
```

**Track C — Terminal failure:**
```json
{
  "error": "SERVICE_UNAVAILABLE",
  "message": "Our music service is temporarily down. We've saved your progress — try again in a few minutes.",
  "retry_after": 300,
  "preserves_state": true
}
```

### iOS Client Contract

**Old iOS (pre-recovery):** HTTP 422 → `APIClient.validateResponse()` decodes `APIError` from body → `ErrorHandler` shows `message` as toast. Degraded but functional — no crash.

**New iOS:** HTTP 422 → detect `status: "needs_input"` → decode `RecoveryEnvelope` → inject recovery message inline in conversation as an AI message with suggestion chips. No modal, no error state.

**Existing precedent:** `POST /story/:id/continue` already returns `{ error, next_question }` within a 200 response (story.js line 1891-1906). The iOS engine already handles this inline. This validates the approach.

**Phase 1 simplification (per API contract review):** The `recovery.endpoint` field is informational only — the iOS client always uses the existing `/continue` endpoint. The user's answer to a recovery prompt is just another story answer. `RecoveryActionDispatcher` only needed in Phase 2.

## Failure Classification Matrix

### Classification Axes

| | Transient (retry will likely fix it) | Permanent (retry won't help) |
|-|--------------------------------------|------------------------------|
| **System can fix** | Auto-retry silently (provider timeout, 5xx, network) | Auto-rewrite/adjust (policy rejection, quality gate) |
| **User must act** | "We're having trouble, trying again..." then prompt if retry fails | Clear guidance: "Tell me more about..." or "Try rephrasing..." |

### IMPORTANT: Derive from `step-classification.js` (per correctness review)

The classification matrix MUST be derived from `src/utils/step-classification.js` — the existing source of truth for error categories and retryability. Do not maintain a parallel classification. The recovery engine should call `classifyError()` first, then map its output to recovery tracks.

### Pipeline-Specific Classification

#### Story Flow

| Failure | Classification | Recovery |
|---------|---------------|----------|
| Missing required detail (`can_confirm === false`) | User-must-act, permanent | `needs_input` with specific follow-up question from `missingBlocks` data |
| Semantic integrity needs user input | User-must-act, permanent | Use existing exhaustion override mechanism (`MAX_REPEAT_SEMANTIC_ASKS = 1`). If user already answered once, the system auto-overrides. Don't bypass the ask — it's a quality signal. |
| `STORY_REVISION_CLARIFY_REQUIRED` | User-must-act, permanent | Already a proto-`needs_input` pattern (returns `follow_up_question` in details). Upgrade to recovery envelope format. |
| LLM reasoning timeout | System-can-fix, transient | Auto-retry with shorter context — BUT only in async path. For sync confirm route, return `needs_input` immediately. |
| Story version conflict | System-can-fix, transient | Auto-retry once (optimistic concurrency) — instant, no latency concern |
| Content moderation on user input | User-must-act, permanent | `needs_input` with rephrasing suggestions |

**REVISED (per correctness review):** `can_confirm` is boolean (`missingBlocks.length === 0 && songMapRepair.report.valid`), NOT a relaxable numeric threshold. The existing exhaustion override (`MAX_REPEAT_SEMANTIC_ASKS = 1`) already handles "close enough" — don't add a new threshold mechanism.

**REVISED (per correctness review):** `confirmStoryV3` currently throws a bare string (`"Story still needs one more detail before confirmation"`). The engine MUST be changed to either return `{ confirmed: false, recovery: { missingBlocks, question, coveragePct } }` or throw a `StoryNeedsDetailError` class carrying structured data. The existing `buildSemanticClarificationPrompt` function already produces the right question — it just needs to be surfaced through the confirm path.

#### Lyrics Generation

| Failure | Classification | Recovery |
|---------|---------------|----------|
| LLM unavailable | System-can-fix, transient | Auto-retry with backoff, fall back to alternative model |
| Generated lyrics fail moderation | System-can-fix, permanent | Auto-rewrite flagged sections. NOTE: `sanitizeLyricsForProviderPolicy` is regex-only — sufficient for pre-generation moderation but NOT for post-provider-rejection. |
| `LYRICS_FIDELITY_LOW` | System-can-fix, permanent | Auto-resolve: regenerate with increased fidelity weight |
| Story not confirmed | User-must-act, permanent | `needs_input` redirecting to confirmation flow |

#### Render Pipeline

| Failure | Classification | Recovery |
|---------|---------------|----------|
| Provider policy rejection (Suno) | System-can-fix, permanent | **Phase 2 requires new LLM-powered rewriter** (see below). Regex sanitizer cannot fix opaque post-rejection failures. |
| `E301_ELEVENLABS_VALIDATION` | System-can-fix, permanent | Different from lyrics policy — the *composition plan* is wrong. Needs composition plan adjustment, not lyrics rewrite. |
| Provider timeout / 5xx | System-can-fix, transient | Auto-retry with exponential backoff (already exists in runner) |
| Seed-VC GPU abort | System-can-fix, transient | Auto-retry with 15s × attempt delay (already exists) |
| Incomplete audio output (`E302_SUNO_INCOMPLETE_OUTPUT`) | System-can-fix, transient | Retry up to 2x |
| Voice conversion quality low | System-can-fix, transient | Retry with adjusted `similarity_strength` |
| FFmpeg timeout/spawn (`E301_FFMPEG_TIMEOUT/SPAWN`) | System-can-fix, transient | Retry once |
| FFmpeg generic error (`E301_FFMPEG_ERROR`) | Terminal | Do NOT retry — generic FFmpeg errors are deterministic |
| Quality gate failure (`E302_QUALITY_GATE_FAILED`) | System-can-fix, transient | Already classified as `retryable: true` in step-classification.js |
| Download errors (`download_error:*`) | System-can-fix, transient | Already classified as `provider_transient` |
| Source URL expired | **Terminal with retry affordance** | NOT `needs_input` (user can't provide input to fix an expired URL). Show "Tap to retry" which re-queues the render from the upstream step. |
| Insufficient credits | User-must-act, permanent | `needs_input` with upgrade path |

**CRITICAL (per correctness review):** Post-rejection auto-rewrite requires a **new LLM-powered lyrics rewriter** — NOT re-running `sanitizeLyricsForProviderPolicy` (which is regex-only). The existing sanitizer already ran pre-submit; re-running it produces identical output. Phase 2 must build a new capability: take Suno's rejection reason + current lyrics → LLM rewrites the offending content. This is new development, not "extending existing function."

#### Voice Enrollment

| Failure | Classification | Recovery |
|---------|---------------|----------|
| Audio too noisy (SNR < 15dB) | User-must-act, permanent | `needs_input`: "The recording was a bit noisy. Try a quieter spot." |
| Audio clipping (>5%) | User-must-act, permanent | `needs_input`: "The recording was too loud. Hold the phone a bit further away." |
| Embedding extraction failed | System-can-fix, transient | Auto-retry once |
| Quality score < 70 | User-must-act, permanent | `needs_input`: "We need a clearer recording. Try speaking naturally in a quiet room." |

## Recovery Engine Architecture

### Components

**`src/utils/recovery-engine.js`** — Three functions:

1. **`classifyRecovery(error, context)`**
   - Calls `classifyError()` from `step-classification.js` first (single source of truth)
   - Maps the classification to a recovery track: `auto_resolve`, `guide_user`, or `terminal`
   - Returns `{ track, action: { type, params, userMessage, suggestions } }`

2. **`autoResolve(action, context)`** (ASYNC PIPELINE ONLY — per reliability review)
   - Executes the auto-fix: adjusts params, retries
   - Checks **global attempt budget** before acting (see below)
   - Returns `{ success: true, data }` or `{ success: false, escalate: "guide_user" | "terminal" }`
   - **Must operate on a cloned state** — only persist if retry succeeds (per reliability review)

3. **`buildUserGuidance(action, state)`**
   - Constructs the `needs_input` response envelope
   - Uses story state to generate contextually relevant suggestions
   - Follows the error message formula: [What happened] + [Why] + [Next step]
   - Includes the original response model's required fields (e.g., `confirmed: false`) for backwards compatibility

### Self-Failure Protection (MANDATORY — per reliability review)

```
handleWithRecovery MUST have an unconditional outer try/catch:

try {
  // classify → auto-resolve → build response
} catch (recoveryErr) {
  console.error('[Recovery:SelfFailure]', recoveryErr);
  // Fall back to existing sendError pattern — never swallow the original error
  sendError(reply, 500, 'SERVICE_ERROR', 'Something went wrong. Your progress is saved.');
}
```

### Global Attempt Budget (CRITICAL — per reliability review)

Three independent retry layers exist: recovery engine, job runner, DLQ auto-reprocessor. Without coordination, worst case is 2 × 6 × 3 = 36 provider API calls for a single user action.

**Solution:** Add `total_recovery_attempts` field to jobs table. All three layers increment this counter before acting. Hard ceiling: **10 total attempts** across all layers. The recovery engine checks this BEFORE auto-resolve; the DLQ checks it BEFORE re-queuing.

| Layer | Current Behavior | With Budget |
|-------|-----------------|-------------|
| Recovery auto-resolve | 2 attempts per request | Check budget first; decrement from global cap |
| Job runner retry | 3-6 attempts per job | Already increments `attempts`; also check global budget |
| DLQ auto-reprocessor | 2 re-queues (resetting attempts to 0) | Check global budget; do NOT reset if budget exhausted |

### Lyrics Rewrite Architecture (Phase 2 — NEW CAPABILITY)

**Per correctness review:** The existing `sanitizeLyricsForProviderPolicy` is a regex rewriter that cannot fix post-rejection failures. Phase 2 requires a new LLM-powered rewriter:

- Input: rejected lyrics + provider rejection reason (opaque string from Suno/ElevenLabs)
- Process: LLM analyzes what might have triggered the rejection, rewrites the offending sections while preserving story fidelity
- Output: cleaned lyrics that should pass provider policy
- Track `policy_rewrite_count` per track-version spanning both pre-submit sanitization and post-rejection LLM rewrites. Hard cap: 3 total rewrites, then escalate to manual review / user notification via push.

### Two Integration Surfaces (per reliability review)

Do NOT build one `autoResolve` function for both contexts:

1. **Sync route recovery** (story confirm, continue): Returns HTTP responses. Limited to instant fixes only (<100ms). No LLM re-calls. Auto-resolve = parameter adjustments, threshold overrides. If fix requires LLM, return `needs_input` immediately.

2. **Async job recovery**: Integrates into the runner's existing `classifyError` → retry loop. The runner already has all the context. Auto-resolve mutates persisted job state (lyrics, params) so subsequent retries use corrected input. Must persist rewrites to DB so re-queued jobs don't re-read stale data.

### State Mutation Safety (per reliability review)

Auto-resolve MUST operate on a **clone** of state:

```
1. Clone state
2. Apply recovery adjustments to clone
3. Retry with clone
4. If success → persist clone
5. If failure → discard clone, escalate (original state untouched)
```

Critical for story flow where `v2State` contains full conversation history.

### Error Copy Guidelines

All user-facing messages follow these rules (from NN/g + Google research):

1. **Use "we" not "you"** for system errors — removes blame
2. **Never show raw error codes** — E302_SUNO_POLICY_ERROR is for logs, not users
3. **Never use "try again" as the entire message** — say what to try differently
4. **Preserve the user's work** — never wipe state on error; always confirm state is saved
5. **One sentence max** unless an example genuinely helps
6. **Empathetic framing** — "Almost there!" not "Error"

### Recovery Attempt Limits

| Recovery Type | Max Attempts | Escalation | Global Budget |
|---------------|-------------|------------|---------------|
| Sync auto-resolve (instant fixes) | 1 | `needs_input` immediately | Counted |
| Async auto-resolve (retries) | 2 per step execution | Guide user or terminal | Counted |
| Lyrics LLM rewrite (Phase 2) | 3 total per track-version | Manual review + push notification | Counted |
| Job runner retry | 3-6 per job | DLQ | Counted |
| DLQ re-queue | 2 | Terminal | Checked |
| **Global ceiling** | **10 total** | Terminal with clear user notification | — |

## Monitoring & Observability (per reliability review)

### Structured Log Schema

Every recovery event emits a structured log line:

| Prefix | Fires When |
|--------|------------|
| `[Recovery:AutoResolve]` | Auto-resolve attempted (with outcome: success/failure) |
| `[Recovery:UserGuide]` | `needs_input` response returned |
| `[Recovery:Terminal]` | Unrecoverable failure surfaced to user |
| `[Recovery:SelfFailure]` | Recovery engine itself threw an error |
| `[Recovery:BudgetExhausted]` | Global attempt budget hit ceiling |

### Metrics to Track

- Auto-resolve success rate by error category (target: >80% for transient, >50% for permanent)
- Mean attempts before resolution by category
- Escalation rate (auto-resolve → guide_user → terminal)
- False positive detection: stories where lyrics were auto-rewritten (flag for manual spot-check)
- Latency impact: p95 response time for sync routes with recovery vs without

## System-Wide Impact

- **iOS app changes (Phase 1):** ~128 lines across 7 files. New `RecoveryEnvelope` model, 422 handling in `APIClient+Story.swift`, `StoryRecoveryNeeded` error type, inline recovery messages in `V2StoryEngine` catch blocks. Existing conversation view already supports AI messages + suggestion chips.
- **Server changes (Phase 1):** New `src/utils/recovery-engine.js` (~200 lines). Modify `confirmStoryV3` to return structured recovery data instead of bare string throws. Replace ~12 `sendError` calls in story routes with `handleWithRecovery`.
- **Backwards compatibility:** HTTP 422 + `error`/`message` at top level + original model fields (e.g., `confirmed: false`) ensures old iOS decodes without crashing (shows toast instead of inline guidance).
- **Jobs table:** Add `total_recovery_attempts` column for global budget tracking.

## Scope & Phasing

### Phase 1: Story Flow (immediate)
- Recovery engine core (`classifyRecovery`, `buildUserGuidance`, sync-only auto-resolve)
- Structured error from `confirmStoryV3` (replace bare string throw with `StoryNeedsDetailError`)
- Story confirm: convert `can_confirm === false` to `needs_input` with follow-up question from `missingBlocks`
- Story continue: convert moderation blocks to rephrasing guidance
- Story revision: upgrade `STORY_REVISION_CLARIFY_REQUIRED` to recovery envelope
- iOS: `RecoveryEnvelope` model, 422 handling, inline recovery messages in conversation
- Global attempt budget column + checks

### Phase 2: Lyrics + Render (next sprint)
- **NEW: LLM-powered lyrics rewriter** for post-provider-rejection (cannot reuse regex sanitizer)
- Async job recovery integration (into runner's retry loop, not separate wrapper)
- Policy rewrite counter per track-version
- Composition plan adjustment for ElevenLabs validation errors
- `LYRICS_FIDELITY_LOW` auto-regeneration
- iOS: handle `needs_input` in render status polling

### Phase 3: Voice Enrollment + Billing (future)
- QC failure guidance (specific recording tips)
- Credit/entitlement guidance (upgrade paths)
- iOS: enrollment flow recovery prompts

## Success Criteria

- Zero "Failed to X" error dialogs in the story flow
- Story confirmation: `needs_input` with contextual question replaces generic error in 100% of recoverable cases
- Provider policy rejections auto-resolve without user intervention in >80% of cases (Phase 2, with LLM rewriter)
- Every user-facing error message follows the [What] + [Why] + [Next step] formula
- No raw error codes visible to end users
- Global attempt budget prevents >10 total retries for any single user action
- Recovery engine self-failure rate < 0.1% (monitored via `[Recovery:SelfFailure]` logs)
