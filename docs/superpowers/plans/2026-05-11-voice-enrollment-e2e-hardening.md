# Voice Enrollment E2E Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crack My Voice enrollment end to end: capture audio that matches Suno’s real persona requirements, silently recover provider-side failures when it is safe, preserve any existing usable My Voice during replacement attempts, and ask the user to re-record only when local evidence says the capture itself is unusable.

**Architecture:** Keep the existing `voice_provider_jobs` lane. Add an idempotency-aware Suno failure classifier, split generated-source recovery into alternate-track retry and bounded fresh-cover regeneration, expose current-active and pending-replacement readiness separately, and update iOS so “ready” only means an active remote Suno persona exists.

**Tech Stack:** Node.js/Fastify API, existing SQLite/Postgres-compatible migrations, Suno persona provider adapter, SwiftUI iOS client.

---

## Plan Review Findings Applied

The review specialist found five material gaps. This plan has been updated to address them:

- Existing active voice must survive replacement enrollment until the new Suno provider profile is active.
- Network/timeout/unknown failures after `generatePersona` may have reached Suno must not be blindly retried because duplicate remote personas and cleanup obligations are possible.
- Bad generated source music is not the same as bad user capture; retry alternate generated tracks and bounded fresh cover tasks before escalating.
- Source URL/token lifecycle must be explicit when creating a fresh cover task after the enrollment token has been revoked.
- `/voice/profile` must not collapse “current active provider” and “pending replacement provider” into a single latest provider profile.

---

## File Structure

- Create `src/services/suno-persona-failure-classifier.js`: classify provider failures with explicit idempotency flags.
- Modify `src/services/suno-voice-persona-service.js`: use classifier, perform safe source-audio recovery, and avoid unsafe retry after ambiguous provider request failures.
- Modify `src/services/voice-provider-profile-service.js`: add metadata patch helpers and replacement-safe query helpers.
- Modify `src/routes/enrollment.js`: preserve existing active profile during replacement enrollment; expose richer `/voice/profile` readiness.
- Modify `src/services/audio-quality.js`: keep singing detection wired, remove debug logs, and keep sung-QC metrics available.
- Modify `PorizoApp/PorizoApp/Models/EnrollmentModels.swift`: decode current-active and pending-replacement readiness.
- Modify `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift`: show preparing state without claiming ready; only prompt recapture for server `user_action=recapture`.
- Modify `PorizoApp/PorizoApp/Components/VoiceBanner.swift` and `PorizoApp/PorizoApp/Components/VoiceProfileView.swift`: reflect `ready`, `preparing`, `retrying_provider`, `needs_recapture`, and `failed_provider`.
- Test `test/suno-voice-persona-service.test.js`: classifier, idempotency, source-track retry, fresh-cover retry, exhaustion.
- Test `test/voice-enrollment.test.js`: replacement safety and `/voice/profile` readiness.
- Test `test/workflows/resolve-suno-persona-for-render.test.js`: render uses existing active persona while replacement is pending/failed.
- Test `test/audio-quality.test.js`: singing detection remains wired.

---

## Contracts

### Provider Readiness

Use these server-side readiness values:

- `ready`: active Suno provider profile exists and has `provider_profile_id`.
- `preparing`: provider profile is preparing and the job is immediately runnable.
- `retrying_provider`: provider job is pending with `next_attempt_at` in the future.
- `needs_recapture`: local sung QC failed. This state is not used for provider-generated-source failures unless local sung metrics also prove the user capture is bad.
- `failed_provider`: provider/config/manual-review failure that the user cannot fix by immediately re-recording.
- `setup_required`: no consented provider profile exists.

### Failure Classifier Shape

The classifier returns:

```js
{
  category: "transient" | "source_audio_retryable" | "source_audio_exhausted" | "local_capture_terminal" | "policy" | "auth_config" | "cancelled" | "unknown",
  safeToRetry: boolean,
  safeToRetryAfterGenerateRequestStarted: boolean,
  recoveryScope: "same_task_audio" | "fresh_cover_task" | "job_retry" | "manual_review" | "none",
  userAction: "wait" | "recapture" | "contact_support",
  reason: "provider_not_ready" | "bad_source_music" | "provider_source_recovery_exhausted" | "bad_sung_audio" | "provider_auth" | "provider_policy" | "cancelled" | "unknown",
}
```

Important rule: `timeout`, `fetch failed`, generic `network`, and `unknown` can be safe before a provider mutation request, but are not safe after `generatePersona` may have reached Suno.

### Replacement Enrollment Contract

Existing active `voice_profiles` and active Suno provider profiles are not deleted when a new enrollment completes local QC. They remain the render source until the new provider profile becomes active. Only after the replacement provider profile is active may the old active provider/profile be soft-deleted.

---

## Task 0: Preserve Existing Active My Voice During Replacement

**Files:**
- Modify: `src/routes/enrollment.js`
- Modify: `src/services/voice-provider-profile-service.js`
- Test: `test/voice-enrollment.test.js`
- Test: `test/workflows/resolve-suno-persona-for-render.test.js`

- [ ] **Step 1: Write replacement safety tests**

Add a test in `test/voice-enrollment.test.js`:

```js
it("keeps existing active My Voice usable while replacement persona is pending or failed", async () => {
  const userId = uniqueUserId("replacement_safe");
  const oldVoiceProfileId = crypto.randomUUID();
  const oldProviderProfileId = `vpp_old_${Date.now()}`;
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, 'active', ?, 92, 'excellent', ?, 'embed_stub', 'ios_v1', ?, ?, ?)",
  ).run(oldVoiceProfileId, userId, `voice_profiles/${userId}/old/embedding.bin`, JSON.stringify({ average_score: 92 }), now, now, now);

  await db.prepare(
    "INSERT INTO voice_provider_profiles (id, voice_profile_id, user_id, provider, provider_profile_id, status, model, consent_scope, metadata_json, created_at, updated_at, activated_at) VALUES (?, ?, ?, 'suno', 'persona_live_old', 'active', 'V5_5', ?, '{}', ?, ?, ?)",
  ).run(oldProviderProfileId, oldVoiceProfileId, userId, REQUIRED_CONSENT_SCOPE, now, now, now);

  const replacementVoiceProfileId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at) VALUES (?, ?, 'pending_provider', ?, 95, 'excellent', ?, 'embed_stub', 'ios_v1', ?, ?, ?)",
  ).run(replacementVoiceProfileId, userId, `voice_profiles/${userId}/replacement/embedding.bin`, JSON.stringify({ average_score: 95 }), now, now, now);

  const replacementProvider = await createPendingProviderProfile(db, {
    voiceProfileId: replacementVoiceProfileId,
    userId,
    provider: "suno",
    consentScope: REQUIRED_CONSENT_SCOPE,
    metadata: { source: "replacement" },
  });

  const response = await app.inject({
    method: "GET",
    url: "/voice/profile",
    headers: { "x-user-id": userId },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.my_voice_ready, true);
  assert.equal(body.voice_provider_profile.provider_profile_id, "persona_live_old");
  assert.equal(body.pending_voice_provider_profile.id, replacementProvider.id);
  assert.equal(body.pending_voice_provider_profile.readiness, "preparing");
});
```

- [ ] **Step 2: Add `pending_provider` to local schemas if needed**

If SQLite/Postgres status constraints reject `pending_provider`, add migrations that extend `voice_profiles.status` to include `pending_provider`. If status is unconstrained in the active database, skip migration and keep the test.

- [ ] **Step 3: Change replacement transaction**

In `src/routes/enrollment.js`, when `shouldEnqueuePersona` is true and an existing active profile exists, insert the new local profile as `pending_provider` instead of deleting the existing active profile immediately:

```js
const newVoiceStatus = shouldEnqueuePersona ? "pending_provider" : "active";
```

Use `newVoiceStatus` in the `INSERT INTO voice_profiles` call. Do not call `cancelVoiceProviderJobsForVoiceProfile`, `softDeleteProviderProfilesForVoiceProfile`, or update the old profile to `deleted` until the replacement provider profile is active.

- [ ] **Step 4: Promote replacement only after provider active**

In `markProviderProfileActive` flow, after the provider profile is active, soft-delete older active profiles/provider profiles for the same user/provider, excluding the newly active `voice_profile_id`. Then set the replacement local voice profile status to `active`.

- [ ] **Step 5: Run tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/voice-enrollment.test.js test/workflows/resolve-suno-persona-for-render.test.js
```

Expected: existing active My Voice remains usable while replacement provider setup is pending or failed.

---

## Task 1: Add Idempotency-Aware Suno Failure Classifier

**Files:**
- Create: `src/services/suno-persona-failure-classifier.js`
- Test: `test/suno-voice-persona-service.test.js`

- [ ] **Step 1: Write classifier tests**

Add:

```js
const {
  classifySunoPersonaFailure,
} = require("../src/services/suno-persona-failure-classifier");

test("classifies Suno persona failures with idempotency flags", () => {
  assert.deepEqual(
    classifySunoPersonaFailure(new Error("Music does not exist")),
    {
      category: "transient",
      safeToRetry: true,
      safeToRetryAfterGenerateRequestStarted: true,
      recoveryScope: "job_retry",
      userAction: "wait",
      reason: "provider_not_ready",
    },
  );

  assert.deepEqual(
    classifySunoPersonaFailure(new Error("Current music failed to generate persona")),
    {
      category: "source_audio_retryable",
      safeToRetry: true,
      safeToRetryAfterGenerateRequestStarted: true,
      recoveryScope: "same_task_audio",
      userAction: "wait",
      reason: "bad_source_music",
    },
  );

  assert.deepEqual(
    classifySunoPersonaFailure(new Error("fetch failed")),
    {
      category: "transient",
      safeToRetry: true,
      safeToRetryAfterGenerateRequestStarted: false,
      recoveryScope: "manual_review",
      userAction: "contact_support",
      reason: "provider_not_ready",
    },
  );

  assert.deepEqual(
    classifySunoPersonaFailure(new Error("E107_SUNG_AUDIO_REQUIRED")),
    {
      category: "local_capture_terminal",
      safeToRetry: false,
      safeToRetryAfterGenerateRequestStarted: false,
      recoveryScope: "none",
      userAction: "recapture",
      reason: "bad_sung_audio",
    },
  );
});
```

- [ ] **Step 2: Implement classifier**

Create `src/services/suno-persona-failure-classifier.js`:

```js
function text(error) {
  return String(error?.message || error || "").toLowerCase();
}

function result(category, safeToRetry, safeAfterGenerate, recoveryScope, userAction, reason) {
  return {
    category,
    safeToRetry,
    safeToRetryAfterGenerateRequestStarted: safeAfterGenerate,
    recoveryScope,
    userAction,
    reason,
  };
}

function classifySunoPersonaFailure(error) {
  const message = text(error);

  if (message.includes("cancelled") || message.includes("cancellation_requested")) {
    return result("cancelled", false, false, "none", "wait", "cancelled");
  }
  if (message.includes("api key") || message.includes("unauthorized") || message.includes("forbidden") || message.includes("callback_not_configured")) {
    return result("auth_config", false, false, "manual_review", "contact_support", "provider_auth");
  }
  if (message.includes("policy") || message.includes("blocked words") || message.includes("violates")) {
    return result("policy", false, false, "manual_review", "contact_support", "provider_policy");
  }
  if (message.includes("current music failed to generate persona") || message.includes("bad source music")) {
    return result("source_audio_retryable", true, true, "same_task_audio", "wait", "bad_source_music");
  }
  if (message.includes("music does not exist") || message.includes("music is still generating") || message.includes("ensure the music generation task is fully completed") || message.includes("create persona error")) {
    return result("transient", true, true, "job_retry", "wait", "provider_not_ready");
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("econnreset") || message.includes("fetch failed") || message.includes("network")) {
    return result("transient", true, false, "manual_review", "contact_support", "provider_not_ready");
  }
  if (message.includes("sung_calibration_unavailable") || message.includes("e107_sung_audio_required") || message.includes("too speech-like")) {
    return result("local_capture_terminal", false, false, "none", "recapture", "bad_sung_audio");
  }
  return result("unknown", false, false, "manual_review", "contact_support", "unknown");
}

module.exports = {
  classifySunoPersonaFailure,
};
```

- [ ] **Step 3: Run classifier tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/suno-voice-persona-service.test.js
```

Expected: classifier tests pass.

---

## Task 2: Use Classifier Without Weakening Generate-Persona Safety

**Files:**
- Modify: `src/services/suno-voice-persona-service.js`
- Modify: `src/services/voice-provider-profile-service.js`
- Test: `test/suno-voice-persona-service.test.js`

- [ ] **Step 1: Preserve existing unsafe-retry test**

Keep or add:

```js
test("does not auto-retry ambiguous network failure after generate-persona request may have reached Suno", async () => {
  const providerProfile = await createPendingProviderProfile(db, {
    voiceProfileId: "voice_1",
    userId: "user_1",
    provider: "suno",
    consentScope: REQUIRED_CONSENT_SCOPE,
  });
  await markProviderProfilePersonaSubmitted(db, providerProfile.id, {
    sourceTaskId: "task_123",
    sourceAudioId: "audio_456",
    model: "V5_5",
  });
  const providerJob = await createVoiceProviderJob(db, {
    voiceProfileId: "voice_1",
    userId: "user_1",
    provider: "suno",
    voiceProviderProfileId: providerProfile.id,
    maxAttempts: 3,
    step: "generate_persona",
    stepData: { enrollment_session_id: "sess_1", source_audio_name: "suno-persona.wav" },
  });

  await assert.rejects(
    runSunoVoicePersonaJob({
      db,
      jobId: providerJob.id,
      config: baseSunoConfig(),
      sunoClient: {
        uploadFileUrl: async () => { throw new Error("should not upload"); },
        submitUploadCoverTask: async () => { throw new Error("should not submit cover"); },
        pollUploadCoverForAudio: async () => { throw new Error("should not poll"); },
        generatePersona: async () => { throw new Error("fetch failed"); },
      },
    }),
    /MANUAL_RECOVERY|fetch failed/,
  );

  const job = db.prepare("SELECT status, next_attempt_at FROM voice_provider_jobs WHERE id = ?").get(providerJob.id);
  const profile = db.prepare("SELECT status, metadata_json FROM voice_provider_profiles WHERE id = ?").get(providerProfile.id);
  assert.equal(job.status, "failed");
  assert.equal(job.next_attempt_at, null);
  assert.equal(profile.status, "failed");
  assert.equal(JSON.parse(profile.metadata_json).last_user_action, "contact_support");
});
```

- [ ] **Step 2: Add metadata patch helper**

In `src/services/voice-provider-profile-service.js`:

```js
async function patchProviderProfileMetadata(db, id, patch = {}, error = null) {
  const existing = await getProviderProfileById(db, id);
  if (!existing) return null;
  const metadata = parseJson(existing.metadata_json, {}, "metadata_json") || {};
  const updatedAt = nowIso();
  await db.prepare(
    `UPDATE voice_provider_profiles
        SET metadata_json = ?, last_error = COALESCE(?, last_error), updated_at = ?
      WHERE id = ?`,
  ).run(
    JSON.stringify({ ...metadata, ...patch }),
    error ? sanitizeProviderError(error) : null,
    updatedAt,
    id,
  );
  return getProviderProfileById(db, id);
}
```

Export `patchProviderProfileMetadata`.

- [ ] **Step 3: Integrate classifier in catch block**

In `src/services/suno-voice-persona-service.js`, import the classifier and metadata helper. When `generatePersonaRequestStarted` is true:

```js
const classification = classifySunoPersonaFailure(err);
const retryable = classification.safeToRetryAfterGenerateRequestStarted;
const failedJob = await markVoiceProviderJobFailed(db, jobId, err, {
  step: "generate_persona",
  retryable,
});
await patchProviderProfileMetadata(db, providerProfile.id, {
  last_failure_category: classification.category,
  last_failure_reason: classification.reason,
  last_user_action: classification.userAction,
  last_recovery_scope: classification.recoveryScope,
  last_provider_retry_at: failedJob?.next_attempt_at || null,
}, err);
```

Only call `markProviderProfileFailed(...)` when `failedJob?.status === "failed"`.

- [ ] **Step 4: Run tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/suno-voice-persona-service.test.js
```

Expected: transient known readiness errors retry; ambiguous network failures after generate request do not.

---

## Task 3: Recover Bad Generated Source Music Before Blaming Capture

**Files:**
- Modify: `src/services/suno-voice-persona-service.js`
- Test: `test/suno-voice-persona-service.test.js`

- [ ] **Step 1: Test alternate-track retry from same cover task**

Add:

```js
test("bad source music rejects current audio id and retries another track from same cover task", async () => {
  const providerProfile = await createPendingProviderProfile(db, {
    voiceProfileId: "voice_1",
    userId: "user_1",
    provider: "suno",
    consentScope: REQUIRED_CONSENT_SCOPE,
  });
  await markProviderProfilePersonaSubmitted(db, providerProfile.id, {
    sourceTaskId: "task_123",
    sourceAudioId: "audio_bad",
    model: "V5_5",
    metadata: { suno_source_audio_duration_sec: 28 },
  });
  const providerJob = await createVoiceProviderJob(db, {
    voiceProfileId: "voice_1",
    userId: "user_1",
    provider: "suno",
    voiceProviderProfileId: providerProfile.id,
    maxAttempts: 8,
    step: "generate_persona",
    stepData: { enrollment_session_id: "sess_1", source_audio_name: "suno-persona.wav" },
  });

  await assert.rejects(runSunoVoicePersonaJob({
    db,
    jobId: providerJob.id,
    config: baseSunoConfig(),
    sunoClient: {
      uploadFileUrl: async () => { throw new Error("should not upload"); },
      submitUploadCoverTask: async () => { throw new Error("should not submit"); },
      pollUploadCoverForAudio: async () => { throw new Error("should retry next attempt"); },
      generatePersona: async () => {
        throw new Error("Current music failed to generate persona");
      },
    },
  }));

  const job = db.prepare("SELECT status, step, next_attempt_at FROM voice_provider_jobs WHERE id = ?").get(providerJob.id);
  const profile = db.prepare("SELECT status, source_task_id, source_audio_id, metadata_json FROM voice_provider_profiles WHERE id = ?").get(providerProfile.id);
  const metadata = JSON.parse(profile.metadata_json);
  assert.equal(job.status, "pending");
  assert.equal(profile.status, "cover_submitted");
  assert.equal(profile.source_task_id, "task_123");
  assert.equal(profile.source_audio_id, null);
  assert.deepEqual(metadata.suno_rejected_source_audio_ids, ["audio_bad"]);
  assert.equal(metadata.last_user_action, "wait");
});
```

- [ ] **Step 2: Test fresh cover task after same-task candidates exhausted**

Add a test with metadata `suno_rejected_source_audio_ids: ["audio_a", "audio_b"]` and current `source_audio_id: "audio_c"`. After the error, assert:

```js
assert.equal(profile.status, "upload_submitted");
assert.equal(profile.source_task_id, null);
assert.equal(profile.source_audio_id, null);
assert.equal(JSON.parse(profile.metadata_json).source_music_regenerations, 1);
assert.equal(JSON.parse(profile.metadata_json).last_failure_reason, "bad_source_music");
```

- [ ] **Step 3: Implement two-stage recovery**

In bad-source handling:

```js
const rejectedIds = collectRejectedSourceAudioIds(providerProfile);
const nextRejected = Array.from(new Set([...rejectedIds, providerProfile.source_audio_id].filter(Boolean)));
const metadata = withProviderMetadata(providerProfile, {
  suno_bad_source_music: true,
  suno_rejected_source_audio_ids: nextRejected,
  last_failure_category: "source_audio_retryable",
  last_failure_reason: "bad_source_music",
  last_user_action: "wait",
});
```

If `nextRejected.length < 3`, set status to `cover_submitted`, clear `source_audio_id`, keep `source_task_id`.

If `nextRejected.length >= 3` and `source_music_regenerations < 2`, set status to `upload_submitted`, clear `source_task_id` and `source_audio_id`, preserve `source_upload_url` if it exists, and increment `source_music_regenerations`.

If `source_upload_url` is missing, rotate the enrollment access token and re-run `uploadFileUrl` from `suno-persona.wav` before submitting the fresh cover task.

- [ ] **Step 4: Exhaustion does not automatically mean recapture**

When same-task and fresh-cover budgets are exhausted, mark:

```js
{
  last_failure_category: "source_audio_exhausted",
  last_failure_reason: "provider_source_recovery_exhausted",
  last_user_action: "contact_support",
}
```

Do not set `needs_recapture` unless local sung QC failed.

- [ ] **Step 5: Run tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/suno-voice-persona-service.test.js
```

Expected: bad generated source music retries internally; terminal exhaustion is provider/manual-review, not user-blaming recapture.

---

## Task 4: Strengthen Sung Capture Contract Before Job Creation

**Files:**
- Modify: `src/services/audio-quality.js`
- Modify: `src/routes/enrollment.js`
- Test: `test/audio-quality.test.js`
- Test: `test/voice-enrollment.test.js`

- [ ] **Step 1: Assert local sung failure returns recapture action**

In the existing `E107_SUNG_AUDIO_REQUIRED` test:

```js
assert.equal(response.json().details.reason, "sung_calibration_unavailable");
assert.equal(response.json().details.user_action, "recapture");
assert.equal(response.json().details.failed_stage, "local_sung_qc");
```

- [ ] **Step 2: Remove audio-quality debug logs**

Delete:

```js
console.log("[AudioQuality] Buffer size:", buffer?.length, "First 12 bytes:", buffer?.slice(0, 12)?.toString("ascii"));
console.log("[AudioQuality] Assessment success:", { snr: metrics.snr_db.toFixed(1), duration: metrics.duration_sec.toFixed(1) });
```

- [ ] **Step 3: Keep sung metrics in quality JSON**

Ensure `assessAudioQuality()` returns `metrics.is_singing` and `metrics.singing_confidence`, and `validateEnrollmentWithGrading()` persists `chunk_quality_json` for each prompt. This is already partly implemented; tests must cover it.

- [ ] **Step 4: Run tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/audio-quality.test.js test/voice-enrollment.test.js
```

Expected: speech-like sung prompts fail before provider jobs are created.

---

## Task 5: Expose Current Active And Pending Replacement Readiness

**Files:**
- Modify: `src/routes/enrollment.js`
- Modify: `src/services/voice-provider-profile-service.js`
- Test: `test/voice-enrollment.test.js`

- [ ] **Step 1: Add profile contract tests**

Add tests for these cases:

```js
assert.equal(body.my_voice_ready, true);
assert.equal(body.voice_provider_profile.readiness, "ready");
assert.equal(body.pending_voice_provider_profile.readiness, "preparing");
```

and:

```js
assert.equal(body.my_voice_ready, true);
assert.equal(body.voice_provider_profile.readiness, "ready");
assert.equal(body.pending_voice_provider_profile.readiness, "failed_provider");
assert.equal(body.pending_voice_provider_profile.user_action, "contact_support");
```

- [ ] **Step 2: Add readiness helper**

In `src/routes/enrollment.js`:

```js
function buildVoiceProviderReadiness(providerProfile, providerJob) {
  if (!providerProfile) return { readiness: "setup_required", user_action: "recapture" };
  const metadata = parseJson(providerProfile.metadata_json, {});
  if (providerProfile.status === "active" && providerProfile.provider_profile_id) {
    return { readiness: "ready", user_action: "wait" };
  }
  if (providerProfile.status === "failed") {
    const action = metadata.last_user_action || "contact_support";
    return {
      readiness: action === "recapture" ? "needs_recapture" : "failed_provider",
      user_action: action,
      failure_reason: metadata.last_failure_reason || "unknown",
    };
  }
  if (providerJob?.status === "pending" && providerJob.next_attempt_at) {
    return {
      readiness: "retrying_provider",
      user_action: "wait",
      next_attempt_at: providerJob.next_attempt_at,
    };
  }
  return { readiness: "preparing", user_action: "wait" };
}
```

- [ ] **Step 3: Query active and pending separately**

Use separate queries:

```sql
SELECT * FROM voice_provider_profiles
 WHERE user_id = ? AND provider = 'suno' AND status = 'active' AND deleted_at IS NULL
 ORDER BY activated_at DESC, created_at DESC
 LIMIT 1
```

```sql
SELECT * FROM voice_provider_profiles
 WHERE user_id = ? AND provider = 'suno' AND status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted', 'failed')
   AND deleted_at IS NULL
 ORDER BY created_at DESC
 LIMIT 1
```

Return active as `voice_provider_profile` and replacement as `pending_voice_provider_profile`.

- [ ] **Step 4: Run tests**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/voice-enrollment.test.js
```

Expected: failed replacement does not hide still-usable active persona.

---

## Task 6: Update iOS Readiness UX

**Files:**
- Modify: `PorizoApp/PorizoApp/Models/EnrollmentModels.swift`
- Modify: `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift`
- Modify: `PorizoApp/PorizoApp/Components/VoiceBanner.swift`
- Modify: `PorizoApp/PorizoApp/Components/VoiceProfileView.swift`

- [ ] **Step 1: Extend models**

In `VoiceProviderProfileStatus`, add optional properties:

```swift
let readiness: String?
let userAction: String?
let failureReason: String?
let nextAttemptAt: String?
```

Add coding keys:

```swift
case readiness
case userAction = "user_action"
case failureReason = "failure_reason"
case nextAttemptAt = "next_attempt_at"
```

In `VoiceProfileStatus`, add:

```swift
let pendingVoiceProviderProfile: VoiceProviderProfileStatus?
```

with coding key:

```swift
case pendingVoiceProviderProfile = "pending_voice_provider_profile"
```

- [ ] **Step 2: Update computed readiness**

Use current active profile for readiness and pending replacement for background copy:

```swift
var isMyVoicePreparing: Bool {
    if isMyVoiceReady { return false }
    let readiness = pendingVoiceProviderProfile?.readiness ?? voiceProviderProfile?.readiness
    return readiness == "preparing" || readiness == "retrying_provider"
}

var needsVoiceRecapture: Bool {
    let provider = pendingVoiceProviderProfile ?? voiceProviderProfile
    return provider?.userAction == "recapture" || provider?.readiness == "needs_recapture"
}

var didMyVoiceSetupFail: Bool {
    let provider = pendingVoiceProviderProfile ?? voiceProviderProfile
    return provider?.readiness == "needs_recapture" || provider?.readiness == "failed_provider" || provider?.status == "failed"
}
```

- [ ] **Step 3: Poll behavior**

In `pollForVoiceProfile`, only return to recording when `needsVoiceRecapture` is true:

```swift
if status.needsVoiceRecapture {
    await MainActor.run {
        errorMessage = "We captured your voice, but My Voice needs clearer sung audio. Please sing the last two prompts slowly and hold the notes."
        showingError = true
        currentStep = .welcome
    }
    return
}

if status.didMyVoiceSetupFail {
    await MainActor.run {
        errorMessage = "My Voice setup hit a provider issue. We are checking it in the background."
        showingError = true
        dismiss()
    }
    return
}
```

- [ ] **Step 4: Keep completion truthful**

Only show completed view after `status.isMyVoiceReady` is true. Do not show “Voice enrolled!” after local capture alone.

- [ ] **Step 5: Build iOS**

Run:

```bash
xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16' build
```

Expected: build succeeds.

---

## Task 7: Verification

**Files:**
- No production smoke script unless it asserts real My Voice contracts.

- [ ] **Step 1: Run focused backend checks**

Run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true node --test --test-concurrency=1 test/audio-quality.test.js test/voice-enrollment.test.js test/suno-voice-persona-service.test.js test/workflows/resolve-suno-persona-for-render.test.js
```

Expected: all pass.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: pass.

- [ ] **Step 3: Run iOS build**

Run:

```bash
xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16' build
```

Expected: build succeeds.

- [ ] **Step 4: Production trace after deploy**

After deployment, enroll one real test voice and verify Railway logs show:

```text
/voice/enrollment/complete -> provider_profile.status=pending
voice_provider_job -> upload_submitted -> cover_submitted -> persona_submitted -> active
/voice/profile -> my_voice_ready=true only after provider_profile_id is present
```

If the provider returns `Current music failed to generate persona`, verify logs show rejected `audioId`, retry in `voice_provider_jobs.next_attempt_at`, and no user-facing recapture until local sung QC has failed or provider exhaustion requires support/manual review.

---

## Acceptance Criteria

- Existing active My Voice remains usable while a replacement enrollment prepares or fails.
- Enrollment never shows “My Voice ready” until `/voice/profile.my_voice_ready === true`.
- Speech-like sung prompts fail locally before a Suno provider job is created.
- Known provider readiness failures retry silently through `voice_provider_jobs.next_attempt_at`.
- Ambiguous network/timeout failure after `generatePersona` may have reached Suno does not auto-retry.
- Suno “Current music failed to generate persona” first rejects generated source audio and retries alternate/fresh cover candidates.
- Provider-generated-source exhaustion does not blame the user’s capture unless local sung QC also failed.
- iOS only asks for recapture when server `user_action` is `recapture`.
- Focused backend tests, lint, and iOS build pass before commit.
