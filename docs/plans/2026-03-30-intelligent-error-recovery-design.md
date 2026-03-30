# Intelligent Error Recovery System — Design Document

## Overview

Replace Porizo's terminal-error pattern (49 `sendError` calls in story routes, 33 `throw new Error` in V3 engine) with an intelligent recovery system that **resolves issues instead of giving up**. Two tracks: system errors auto-resolve silently; user input needs are guided with clear, contextual prompts — never generic error dialogs.

## Problem

Today, when the story confirmation fails because "needs one more detail," the user sees a modal dialog: **"Error — Failed to confirm story."** No context, no guidance, no recovery path. The user has to guess what went wrong. This pattern repeats across the entire pipeline — lyrics generation, render failures, voice conversion, provider rejections all surface as generic errors.

This is wrong. The system knows *exactly* what's wrong (missing detail, policy word, low quality score). It should either fix the problem itself or tell the user precisely what to do.

## Design Philosophy

**Two-track recovery based on who can fix it:**

1. **System errors → auto-resolve silently.** Provider policy rejection? Rewrite the flagged lyrics and re-submit. Timeout? Retry with backoff. Incomplete output? Retry with adjusted params. The user sees a progress indicator, not an error.

2. **User input needed → guide with a clear, contextual prompt.** Missing story detail? Show a friendly follow-up question in the conversation flow. Content moderation on user text? Help them rephrase with suggestions. Never an error dialog — always inline guidance.

**The golden rule:** The system gets 2 auto-resolve attempts before involving the user. Only after exhausting auto-resolve does it escalate to user guidance. Terminal failures (genuine 500s, unrecoverable states) get a clear, specific message — never "Something went wrong."

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
| **General** | Use "we" not "you" for system errors; never show raw codes | All user-facing copy uses empathetic framing |

## The Recovery Contract

### API Response Shape

Instead of generic errors, the API returns a **structured recovery envelope** when something goes wrong:

**Track A — Auto-resolve succeeded (user never knew):**
Normal success response. The recovery happened invisibly. Optional metadata for debugging:
```json
{
  "status": "success",
  "data": { ... },
  "_recovery": { "attempts": 1, "original_error": "E302_SUNO_POLICY_ERROR", "action": "lyrics_rewrite" }
}
```

**Track B — User guidance needed:**
```json
{
  "status": "needs_input",
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

**Track C — Terminal failure (genuine unrecoverable):**
```json
{
  "status": "error",
  "error": "SERVICE_UNAVAILABLE",
  "message": "Our music service is temporarily down. We've saved your progress — try again in a few minutes.",
  "retry_after": 300,
  "preserves_state": true
}
```

### iOS Client Contract

The iOS app handles three response shapes:

1. **`status: "success"`** → Normal flow. Render the result.
2. **`status: "needs_input"`** → Render `recovery.message` inline in the conversation/flow (not a modal). Show `recovery.suggestions` as tappable chips. POST the user's answer to `recovery.endpoint`.
3. **`status: "error"`** → Show `message` (not raw error codes). If `retry_after` is set, show countdown. If `preserves_state: true`, reassure the user their work is saved.

**Never show:** Raw error codes, "Failed to X", modal error dialogs for recoverable states, "Something went wrong" without context.

## Failure Classification Matrix

### Classification Axes

Every failure is classified on two axes before deciding the recovery strategy:

| | Transient (retry will likely fix it) | Permanent (retry won't help) |
|-|--------------------------------------|------------------------------|
| **System can fix** | Auto-retry silently (provider timeout, 5xx, network) | Auto-rewrite/adjust (policy rejection, quality gate) |
| **User must act** | "We're having trouble, trying again..." then prompt if retry fails | Clear guidance: "Tell me more about..." or "Try rephrasing..." |

### Pipeline-Specific Classification

#### Story Flow

| Failure | Classification | Recovery |
|---------|---------------|----------|
| Missing required detail | User-must-act, permanent | `needs_input` with specific follow-up question from `missingBlocks` |
| `can_confirm === false` (close enough) | System-can-fix, permanent | Auto-resolve: lower threshold if within 1 optional detail, confirm anyway |
| Semantic integrity check fails | System-can-fix, transient | Auto-resolve: re-run `ensureSemanticStoryIntegrity` after detail extraction |
| LLM reasoning timeout | System-can-fix, transient | Auto-retry with shorter context (reduce `maxRetainedDetails`) |
| Story version conflict | System-can-fix, transient | Auto-retry once (optimistic concurrency) |
| Content moderation on user input | User-must-act, permanent | `needs_input` with rephrasing suggestions |

#### Lyrics Generation

| Failure | Classification | Recovery |
|---------|---------------|----------|
| LLM unavailable | System-can-fix, transient | Auto-retry with backoff, fall back to alternative model |
| Generated lyrics fail moderation | System-can-fix, permanent | Auto-rewrite flagged sections via `sanitizeLyricsForProviderPolicy` |
| Story not confirmed | User-must-act, permanent | `needs_input` redirecting to confirmation flow |
| Style incompatible with story | System-can-fix, permanent | Auto-adjust style parameters |

#### Render Pipeline

| Failure | Classification | Recovery |
|---------|---------------|----------|
| Provider policy rejection (Suno/ElevenLabs) | System-can-fix, permanent | Auto-rewrite lyrics, remove flagged terms, re-submit |
| Provider timeout / 5xx | System-can-fix, transient | Auto-retry with exponential backoff (already exists) |
| Incomplete audio output | System-can-fix, transient | Retry up to 2x with adjusted params |
| Voice conversion quality low | System-can-fix, transient | Retry with adjusted `similarity_strength` |
| FFmpeg processing error | System-can-fix, transient | Retry once, escalate if persistent |
| Quality gate failure | System-can-fix, transient | Retry with adjusted style, up to 2 attempts |
| Missing stems/inputs | System-can-fix, transient | Re-download from provider URL if not expired |
| Source URL expired | User-must-act, permanent | `needs_input`: "The audio source has expired. Please create a new version." |
| Insufficient credits | User-must-act, permanent | `needs_input` with upgrade path |

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
   - Input: error object + pipeline context (step, state, retry count, user data)
   - Output: `{ track: "auto_resolve" | "guide_user" | "terminal", action: { type, params, userMessage, suggestions } }`
   - This is the brain — one function with the classification matrix encoded

2. **`autoResolve(action, context)`**
   - Executes the auto-fix: rewrites lyrics, adjusts params, retries with different provider
   - Hard cap: 2 auto-resolve attempts per request (prevents infinite loops)
   - Returns `{ success: true, data }` or `{ success: false, escalate: "guide_user" | "terminal" }`

3. **`buildUserGuidance(action, state)`**
   - Constructs the `needs_input` response envelope
   - Uses story state to generate contextually relevant suggestions (not generic)
   - Follows the error message formula: [What happened] + [Why] + [Next step]

### Integration Pattern

Every catch block in the pipeline changes from terminal error to recovery delegation:

**Current (terminal):**
```
catch (err) {
  sendError(reply, 400, "STORY_CONFIRM_FAILED", "Failed to confirm story.");
}
```

**New (recovery):**
```
catch (err) {
  const recovery = await handleWithRecovery(err, { step, state, userId }, async (action) => {
    // auto-resolve callback — re-run the operation with adjusted params
    return await writer.confirmStory(sessionId, action.adjustedParams);
  });
  reply.send(recovery.response);
}
```

The `handleWithRecovery` wrapper orchestrates: classify → auto-resolve (if applicable) → build response.

### Error Copy Guidelines

All user-facing messages follow these rules (from NN/g + Google research):

1. **Use "we" not "you"** for system errors — removes blame
2. **Never show raw error codes** — E302_SUNO_POLICY_ERROR is for logs, not users
3. **Never use "try again" as the entire message** — say what to try differently
4. **Preserve the user's work** — never wipe state on error; always confirm state is saved
5. **One sentence max** unless an example genuinely helps
6. **Empathetic framing** — "Almost there!" not "Error"

### Recovery Attempt Limits

| Recovery Type | Max Attempts | Escalation |
|---------------|-------------|------------|
| Silent retry (transient) | 3 | Guide user or terminal |
| Auto-rewrite (permanent) | 2 | Guide user |
| User guidance prompt | 1 per specific issue | Terminal if user can't/won't fix |
| Provider fallback | 1 switch | Terminal with clear message |

## System-Wide Impact

- **iOS app changes:** Must handle `status: "needs_input"` responses. Render recovery messages inline (not modals). Handle `suggestions` array as tappable chips. Follow `endpoint` for user's response.
- **Error logging:** All auto-resolve attempts logged with `[Recovery:AutoResolve]` prefix. All user guidance prompts logged with `[Recovery:UserGuide]`. Terminal failures logged with `[Recovery:Terminal]`.
- **Backwards compatibility:** Old iOS versions receiving `status: "needs_input"` will see it as an unknown response. Include `error` field as fallback: `{ status: "needs_input", error: "STORY_NEEDS_DETAIL", message: "...", recovery: { ... } }`.
- **Render pipeline:** Auto-resolve for provider rejections means the render step handler needs access to lyrics rewrite utilities. The `sanitizeLyricsForProviderPolicy` function already exists but only runs pre-submit.

## Scope & Phasing

### Phase 1: Story Flow (immediate)
- Recovery engine core (`classifyRecovery`, `autoResolve`, `buildUserGuidance`)
- Story confirm: convert `can_confirm === false` to `needs_input` with follow-up question
- Story continue: convert moderation blocks to rephrasing guidance
- iOS: handle `needs_input` in story chat flow

### Phase 2: Lyrics + Render (next sprint)
- Provider policy auto-rewrite on rejection (not just pre-submit)
- Lyrics moderation auto-fix
- Render step auto-retry with adjusted params
- iOS: handle `needs_input` in render status polling

### Phase 3: Voice Enrollment + Billing (future)
- QC failure guidance (specific recording tips)
- Credit/entitlement guidance (upgrade paths)
- iOS: enrollment flow recovery prompts

## Success Criteria

- Zero "Failed to X" error dialogs in the story flow
- Provider policy rejections auto-resolve without user intervention in >80% of cases
- Story confirmation succeeds on first attempt in >95% of cases (auto-resolve closes the gap)
- Every user-facing error message follows the [What] + [Why] + [Next step] formula
- No raw error codes visible to end users
