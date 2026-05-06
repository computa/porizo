# Reviewer: iOS Swift (voice flow)

## Findings (12 total)

### HIGH

1. **[HIGH] EnrollmentFlowView.swift:604 — Unstructured upload Task has no cancellation handle**
   - Issue: Task at line 604 in `uploadCurrentRecording()` is fire-and-forget (not assigned to `enrollmentTask`/`pollingTask`/etc.). On view dismissal `onDisappear` cancels the three tracked tasks but this upload Task keeps running. After upload it advances `currentPromptIndex` or calls `finalizeEnrollment()` on a dismissed view; on error path sets `errorMessage`/`showingError` after sheet closed. Can also re-enter `currentStep = .processing` and start a new `pollingTask`.
   - Fix: Store the handle (`uploadTask = Task { ... }`) and cancel it in `.onDisappear`. Check `Task.isCancelled` before each `MainActor.run`.

2. **[HIGH] EnrollmentFlowView.swift:606 — File I/O on MainActor**
   - Issue: `Task { ... let data = try Data(contentsOf: url) ... }` — unstructured Task created from `@MainActor`-isolated view body inherits MainActor isolation. `Data(contentsOf:)` (potentially several MB synchronous read) runs on main, blocks UI / countdown timer / level meters during read. Same for `SHA256.hash(data:)`.
   - Fix: `Task.detached { let data = try Data(contentsOf: url); let checksum = ...; await MainActor.run { ... } }` to do disk read off main.

3. **[HIGH] EnrollmentFlowView.swift:653 — `pollingTask` reset on completion ignores prior task**
   - Issue: `finalizeEnrollment()` assigns `pollingTask = Task { ... }` after upload, no cancellation of any previously-running `pollingTask`. If completion path re-enters (user re-taps, interruption recovery), second polling task races first. Both call `apiClient.completeEnrollment(sessionId:)` — server idempotent, but second branch could overwrite `enrollmentOutcome`/`qualityScore` and call `currentStep = .completed` twice.
   - Fix: `pollingTask?.cancel(); pollingTask = Task { ... }` at line 653, mirroring pattern used elsewhere.

4. **[HIGH] EnrollmentFlowView.swift:691-744 — `pollForVoiceProfile` timeout dumps user back to `.welcome`**
   - Issue: After 60 polling attempts (2 min) or 5 consecutive failures, `currentStep = .welcome` resets screen as if nothing happened. User already uploaded all 6 phrases; server has session; chunks processed. Returning to `.welcome` and tapping "Start Recording" hits `apiClient.startEnrollment()` creating brand new session — wasted work, confusing UX. Existing session_id discarded.
   - Fix: Surface "Voice profile is still processing — check back from Settings" message and `dismiss()` the sheet, OR move to "preparing" state that parent flow already handles via `waitForMyVoiceReadiness`.

### MEDIUM

5. **[MEDIUM] EnrollmentFlowView.swift:597-601 — Missing upload URL is unrecoverable mid-flow**
   - Issue: If `uploadUrlsByChunkId[prompt.id]` is missing (server returned fewer presigned URLs than prompts), user shown error and stuck on recording screen. `isLoading` never set to true so record button enabled, but tapping record produces same error after recording. No retry of `startEnrollment` or fetching fresh upload URL.
   - Fix: Re-issue `startEnrollment()` to refresh upload URL set, or have server return `next_upload_url` in `ChunkUploadResponse` (already typed).

6. **[MEDIUM] WarmCanvasFlowView.swift:1664-1678 — `isVoiceEnrollmentRequired` and `handleVoiceEnrollmentRequiredError` duplicate the same code-list with diverging behavior**
   - Issue: Two helpers list same set of codes (`NO_VOICE_PROFILE`, `VOICE_PROFILE_REQUIRED`, `SUNO_VOICE_PERSONA_SETUP_REQUIRED`, `SUNO_VOICE_PERSONA_FAILED`) but `isVoiceEnrollmentRequired` ALSO checks `httpError 404 + body contains "NO_VOICE_PROFILE"`, while `handleVoiceEnrollmentRequiredError` only handles `serverError`. A 404 from track-creation path is silently routed to generic error toast instead of opening enrollment.
   - Fix: Extract single `voiceEnrollmentRequiredCode(from: Error) -> VoiceEnrollmentReason?` and reuse in both call sites.

7. **[MEDIUM] WarmCanvasFlowView.swift:1693-1717 — `flowTask` reassignment without cancelling prior unstructured Task races state mutations**
   - Issue: `handleVoiceEnrollmentDismissal` does `flowTask?.cancel()` then assigns new Task. Good. But if user opens enrollment, dismisses (post-completion triggers waitForMyVoiceReadiness → 18s polling), then immediately taps "My Voice" again, `handleMyVoiceRequested` (line 1637) cancels and re-assigns `flowTask` mid-poll. Previously-running poll's `MainActor.run` callbacks may still race — both write `songFlow.voiceMode` and `activeAlert`/`activeSheet`; old Task may flip state after new Task already committed.
   - Fix: Add `guard !Task.isCancelled else { return }` checks before each state mutation in `waitForMyVoiceReadiness` callers, OR use a token/generation counter pattern.

8. **[MEDIUM] AudioRecorder.swift:33 — `nonisolated(unsafe)` interruption observer is technically OK but undocumented**
   - Issue: `interruptionObserver` declared `nonisolated(unsafe)`. Class is `@MainActor`, observer set in `init()` (MainActor) and removed in `deinit` (any actor). Unsafe attribute silences compiler but doesn't prevent races. NotificationCenter retains the closure strongly until removeObserver, but `deinit` can race with notifications already being dispatched. Notification queued on `.main` so by the time queued block runs, observer pointer is gone but closure was retained — fine, but undocumented.
   - Fix: Acceptable as-is, but document why `nonisolated(unsafe)` is sound (NotificationCenter retains the block; `[weak self]` guards stale references). For strictness, hold as `@MainActor`-isolated property and unregister via MainActor-confined deinit helper.

9. **[MEDIUM] EnrollmentFlowView.swift:34, 530, 532 — Dead state (`consentGranted`, `promptSetId`, `recordingSettings`)**
   - Issue: `consentGranted = true` set but never read; `promptSetId` and `recordingSettings` written but never used downstream. Each unused `@State` triggers SwiftUI dependency tracking on body re-evaluation.
   - Fix: Remove them. If `recordingSettings.sampleRate` should override hardcoded 44100 in `AudioRecorder`, wire it through.

10. **[MEDIUM] EnrollmentFlowView.swift:691 — `pollForVoiceProfile` does not honor `enrollmentResponse.estimatedCompletionSec` hint**
    - Issue: Decoded response includes `estimatedCompletionSec`, but polling fallback uses fixed 2s interval / 60-attempt cap regardless of server hint. If server returns `estimated_completion_sec: 90`, code still bails at 120s with generic timeout — usually right at the moment profile becomes ready.
    - Fix: Use hint to bound the loop (`max(60, hint*2/2s_interval)`) or switch to exponential backoff.

11. **[MEDIUM] WarmCanvasFlowView.swift:1731 — Polling sleep is not cancellation-aware in body**
    - Issue: `try? await Task.sleep(for: .seconds(3))` IS cancellation-aware (sleep throws on cancel, `try?` swallows), but loop body does not `guard !Task.isCancelled else { return nil }` before next iteration. If `flowTask?.cancel()` fires during sleep, loop will run one more API call before exiting. Six attempts × 3s = 18s of zombie polling on cancel.
    - Fix: Add `if Task.isCancelled { return nil }` after the sleep.

### SUGGESTION

12. **[SUGGESTION] EnrollmentFlowView.swift:67 — body switch over `currentStep` produces heavy view-graph dependency**
    - Issue: Each step view (welcome/recording/processing/completed) reads many `@State` properties. Because entire body switches on `currentStep`, any state change anywhere invalidates whole tree even when only level meter or countdown ticked. Level meter timer ticks at 0.05s.
    - Fix: Extract each step into its own `View` struct that takes only state it needs (or `@Observable` view models per step). At minimum, move `levelMeter` and `countdownLabel` into separate small views so 20Hz audio level updates don't reinvalidate entire enrollment screen.

## Residual Risks

- **User-Agent change** from `"PorizoApp/1.0 (build 110; iOS)"` to `"PorizoApp/1.0(110)"`: server only matches against bot-crawler regexes; verify no analytics dashboards key off old format.
- **Server contract change**: `consent_scopes` and `voice_suno_persona_consent` are NEW required fields on a 110+ client; older clients (105–109) calling `/voice/enrollment/start` and `/voice/enrollment/complete` will silently get `consent_scopes: null` per server-side fallback in `enrollment.js:481-487`. **TestFlight users on build 108 cannot use My Voice until they update.**
- Old `VoiceEnrollmentView` referenced `APIClientWrapper` env object; new `EnrollmentFlowView` takes `apiClient` directly. No other call sites broke (Settings + V1Catalog updated). Confirmed via grep.

## Testing Gaps

- No test exercises upload-then-dismiss-mid-task path (finding #1).
- No test for polling timeout fallback returning to `.welcome` (finding #4).
- No test verifies `consent_scopes` payload shape against server validation (server expects `Array.isArray(consent_scopes)` — iOS sends `["voice_suno_persona_v1"]`, matches).
- No test for `SUNO_PERSONA_NOT_READY` 422 routing in `RenderController.swift:846-855` — verify new branch (`input_missing`/`wait_for_persona`) consumed correctly by mappers.
