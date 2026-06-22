# Adversarial Compliance Verification Report

**Date:** 2026-06-22  
**Auditor:** Compliance/Reliability specialist (adversarial verification pass)  
**Scope:** 10 findings from feature-audit/raw/ — READ actual code before every verdict.  
**Rule:** Findings may be wrong. Evidence wins over assertion.

---

## Summary Table

| #   | Finding                                    | Verdict            | Severity | Minimal Fix                                                                                                                                                                                                                             |
| --- | ------------------------------------------ | ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GDPR deletion soft-only — PII not erased   | **CONFIRMED**      | P0       | Extend `deleteUserAccount` transaction: null PII fields on `users`, add `DELETE FROM user_contacts WHERE user_id=?`, `DELETE FROM track_library_entries WHERE user_id=?`, schedule async storage purge job                              |
| 2   | GDPR data export endpoint missing          | **CONFIRMED**      | P1       | Add `GET /account/data-export` route that assembles and streams a JSON archive of all user-owned rows, then emails a download link; `logDataExportRequest()` already exists for the audit trail                                         |
| 3   | Enrollment audio not purged after 7 days   | **CONFIRMED**      | P1       | Add cron/scheduled job (e.g. `src/jobs/enrollment-audio-purge.js`) that queries `enrollment_sessions WHERE created_at < NOW()-7d AND status=COMPLETED` and deletes `storage/enrollment/raw/{userId}/{sessionId}/`                       |
| 4   | Gift delivery retry runner missing         | **FALSE POSITIVE** | —        | No fix needed — `src/jobs/gift-dispatch.js:125,157` sweeps `gift_delivery_outbox` with `COALESCE(next_retry_at, send_at) <= ?`; also polled at `server.js:2988–3006`                                                                    |
| 5   | Share follow-ups no-op                     | **FALSE POSITIVE** | —        | No fix needed — `src/jobs/share-followups-daily.js` polls `share_followups WHERE send_at <= ?`, marks `sent_at`; registered at `server.js:5480` every 5 min                                                                             |
| 6   | `receiver_claim_tokens` scaffolded-unwired | **FALSE POSITIVE** | —        | No fix needed — issue route at `sharing.js:1048`, redemption at `sharing.js:1131`, SSE stream at `sharing.js:1266`; table fully wired                                                                                                   |
| 7   | Apple webhook DLQ — no auto-replay         | **PARTIALLY TRUE** | P2       | Manual admin replay endpoint exists (`server.js:4254`); add a scheduled job (e.g. every 30 min) that auto-replays rows `WHERE created_at > NOW()-24h AND reprocessed_at IS NULL`                                                        |
| 8   | Voice provider job exhaustion silent       | **CONFIRMED**      | P1       | In `voice-provider-profile-service.js:652`, when `attempts >= max_attempts`, transition profile to `status='provider_error'` and enqueue a push/email notification to the user                                                          |
| 9   | ElevenLabs orphan voice on crash           | **CONFIRMED**      | P1       | In caller of `createVoiceClone`, record `voice_id` to a `pending_el_voices` staging row BEFORE the EL API call, then promote on success or delete via a nightly reconciliation job that calls `GET /v1/voices` and prunes untracked IDs |
| 10  | Circuit breaker state in-memory only       | **CONFIRMED**      | P2       | Persist circuit state to a `circuit_breaker_state` DB table (or Redis key) with TTL; load on startup so a Railway deploy does not re-hammer a tripping provider                                                                         |

---

## Detailed Evidence

### Finding 1 — GDPR Deletion Soft-Only (CONFIRMED, P0)

**Evidence:** `src/services/auth-service.js`

- Line 932: `deleteUserAccount(userId)` runs a DB transaction
- Line 984: `DELETE FROM share_tokens WHERE track_id IN (SELECT id FROM tracks WHERE user_id = ?)` — share_tokens ARE deleted (indirectly via track ownership), so the claim about share_tokens is **partially wrong**
- Lines 1029–1044: soft-deletes `voice_profiles` via `deleted_at`; does NOT null PII columns on `users` (name, email, phone)
- **Not touched anywhere:** `user_contacts`, `track_library_entries`, filesystem/S3 audio under `storage/enrollment/` and `storage/tracks/`

**What the claim got wrong:** share_tokens are deleted (via track cascade). What it got right: `users` PII fields are not nulled/pseudonymised, `user_contacts` is never touched, audio storage files have no async deletion job.

**Blast radius:** GDPR Art. 17 erasure obligation unmet. On regulatory audit, this is a direct violation. Downstream: any user lookup by email on a deleted account can still surface PII. Regression risk of fix: medium — the transaction is long; adding `user_contacts` delete + async storage trigger needs care around FK order.

---

### Finding 2 — GDPR Data Export Missing (CONFIRMED, P1)

**Evidence:**

- `src/services/gdpr-audit-service.js`: `logDataExportRequest()` inserts one row into `audit_logs` with `action = 'DATA_EXPORT_REQUESTED'` — no data is assembled
- Full grep across `src/routes/` for `export|data-export|portability|my-data` found only one hit: `admin.js:5323` — a cold-email contacts CSV export (admin-only, unrelated)
- No route in `src/routes/` delivers user-owned data (tracks, voice profile, messages, audit logs) to the requesting user

**Blast radius:** GDPR Art. 20 portability right is entirely unmet. If a user submits a subject access request there is no fulfilment path. Low regression risk — adding a new read-only route does not touch existing paths.

---

### Finding 3 — Enrollment Audio Never Purged (CONFIRMED, P1)

**Evidence:**

- Grep for `cron|schedule|setInterval|7.day|purge.*enroll` across all of `src/` returned zero relevant hits
- `src/jobs/` directory contains `gift-dispatch.js`, `share-followups-daily.js` — no enrollment audio purge job
- CLAUDE.md spec states: _"Raw recordings auto-deleted after 7 days"_
- `gdpr-audit-service.js` metadata documents `retention_policy: { raw_recordings: "7_days" }` — but there is no enforcement

**Blast radius:** Raw voice recordings accumulate indefinitely on Railway's ephemeral filesystem (or future S3). GDPR Art. 5(1)(e) storage-limitation principle violated. If filesystem fills up, new enrollments fail. Fix requires a new cron job + storage delete helper.

---

### Finding 4 — Gift Delivery Retry Runner Missing (FALSE POSITIVE)

**Evidence:**

- `src/jobs/gift-dispatch.js:125`: `AND COALESCE(go.next_retry_at, go.send_at) <= ?` — sweeps pending outbox rows on schedule
- `src/jobs/gift-dispatch.js:157`: second sweep for direct outbox rows
- `server.js:2988`: inline poller with `COALESCE(next_retry_at, send_after) <= ?` processes due outbox rows and updates `next_retry_at` on failure (line 3300)
- `attempt_count` is incremented; max-attempts guard at `server.js:2677`

The gift delivery outbox is fully wired with retry logic. The audit finding is wrong.

---

### Finding 5 — Share Follow-ups No-Op (FALSE POSITIVE)

**Evidence:**

- `src/jobs/share-followups-daily.js:4`: _"Every N minutes, finds rows in share_followups whose send_at has arrived"_
- Line 85–91: `FROM share_followups sf ... AND sf.send_at <= ?` — correct sweep query
- Lines 143–150: updates `sent_at` on success, `skip_reason` on skip
- `server.js:5480`: _"Share follow-up email job: polls share_followups every 5 min for rows"_ — confirms registration
- `src/services/share-service.js:329`: `INSERT INTO share_followups` on share creation

The 3-stage nurture sequence is fully wired: DB rows are created on share, polled every 5 min, and emails dispatched. The audit finding is wrong.

---

### Finding 6 — receiver_claim_tokens Scaffolded-Unwired (FALSE POSITIVE)

**Evidence:**

- `src/routes/sharing.js:1048`: `GET /receiver-handoff/:handoffId` — issues token, returns `receiver_claim_token`
- `src/routes/sharing.js:1131`: `POST /receiver-claim/:claimToken` — redeems token, stamps `consumed_at`
- `src/routes/sharing.js:1266`: `GET /receiver-claim/:claimToken/stream` — SSE stream for real-time claim status

The table is fully wired with issuance, redemption (idempotent via `consumed_at`), and a streaming status endpoint. The audit finding is wrong.

---

### Finding 7 — Apple Webhook DLQ No Auto-Replay (PARTIALLY TRUE, P2)

**Evidence:**

- `server.js:4254`: admin endpoint that manually replays individual jobs from `dead_letter_queue` by resetting `status = 'queued'` and updating `dead_letter_queue.reprocessed_at`
- `runner.js:2228–2276`: runner-side reconciliation reads from `dead_letter_queue` on invocation

**What is missing:** No scheduled timer that auto-replays rows. If the admin forgets to manually replay, permanently lost Apple receipt webhooks accumulate silently. Entitlement grants dependent on those webhooks are never delivered.

**Blast radius:** Missed Apple IAP webhooks mean subscription renewals or purchases are never credited. High revenue impact if volume grows. Fix is a small scheduled job (30-min interval, replay rows younger than 24h).

---

### Finding 8 — Voice Provider Job Exhaustion Silent (CONFIRMED, P1)

**Evidence:**

- `src/services/voice-provider-profile-service.js:533`: `AND attempts < max_attempts` — guard prevents further attempts
- Line 652: `retryable && attempts < maxAttempts ? STATUS.PENDING : STATUS.FAILED` — job status moves to FAILED
- **But** the voice _profile_ (in `voice_profiles` or `voice_provider_profiles`) is never transitioned to a user-visible terminal state when job is exhausted; no notification path found in the service
- Line 355: the service queries `status IN ('pending_provider', 'active')` — exhausted profiles stay `pending_provider` indefinitely

**Blast radius:** Users whose voice provider job silently exhausts see a spinner/pending state forever. No self-service recovery path. Support ticket surface area is high once user base grows.

---

### Finding 9 — ElevenLabs Orphan Voice on Crash (CONFIRMED, P1)

**Evidence:**

- `src/providers/elevenlabs-voice.js:49`: `fetch(ELEVENLABS_API_BASE + '/v1/voices/add', ...)` — external API call happens first
- Line 64: logs `Voice clone created: ${result.voice_id}` — voice now exists in ElevenLabs
- Line 67: returns `voice_id` to caller — **caller then writes to DB**
- A crash, timeout, or transaction rollback between line 67 and the DB write leaves an untracked ElevenLabs voice that is billed but never used or deleted

**Blast radius:** ElevenLabs bills per voice slot. Accumulated orphans inflate costs. No reconciliation job exists to detect and delete them. Fix: write a `pending_el_voices` staging row before the API call; reconcile on failure.

---

### Finding 10 — Circuit Breaker In-Memory Only (CONFIRMED, P2)

**Evidence:**

- `src/workflows/circuit-breaker.js`: `this.providers = new Map()` — state is a plain JavaScript Map on the class instance
- No database read/write anywhere in the file
- On every Railway deploy (Node process restart), `this.providers` is re-initialised to an empty Map with all circuits `closed`

**Blast radius:** After a deploy, all circuit breakers reset to closed regardless of prior failure history. If ElevenLabs or Seed-VC was tripping before the deploy, the new process immediately hammers it again until the in-memory counter rebuilds. In a multi-instance horizontal scale scenario, each instance has its own independent breaker state — a 20% failure rate visible to one instance (threshold=5) requires 25 failures per instance before any circuit opens. Fix: persist state to a `circuit_breaker_state` table with TTL, or use a Redis key.

---

## Most Legally Risky Confirmed Issue

**Finding 1 (P0)** — `deleteUserAccount` in `auth-service.js` soft-deletes the user row but leaves PII fields (name, email, phone), `user_contacts` rows, and all audio files intact. This is a direct GDPR Article 17 (right to erasure) violation that is provably incomplete on audit: a regulator can query `SELECT email FROM users WHERE deleted_at IS NOT NULL` and retrieve PII. Fine exposure under GDPR is up to €20M or 4% of global annual turnover.
