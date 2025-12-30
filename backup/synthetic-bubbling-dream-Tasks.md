# Task Breakdown v2 (MVP Sequence + Risks)

## Assumptions
- Providers selected: ElevenLabs (music + guide vocal, primary), Soundverse (music fallback).
- Voice embedding + conversion: Replicate API (primary, no MVP fallback); no self-hosted GPU.
- MVP output is 45-60s; preview is 15-25s; validation target p95 <4 min end-to-end; stretch targets preview p95 <90s, full p95 <180s.
- Device binding is first-claim wins; web is stream-only; app-only saving uses encrypted HLS.
- Full render uses billing hold/capture when enabled; preview-only mode is supported by feature flag.
- Single default language; no social feed or public discovery in MVP.

## Task Breakdown (sequence, person-days)

### Phase 0: Validation + Policy (3-5d)
**Validation checklist (POC):**
- Confirm ElevenLabs returns instrumental + guide vocal artifacts.
- Validate Replicate conversion quality on 30-60s samples; measure artifact score.
- Verify end-to-end MVP latency under 4 min p95.
- Confirm provider data policies and commercial terms.

**Policy + guardrails:**
- Define fallback thresholds (music only) and retry strategy.
- Finalize consent, deletion, and anti-impersonation policy.
- Define share-once and device-binding requirements (App Attest/Play Integrity).

### Phase 1: Core Infrastructure (5-8d)
- Provision Postgres, S3 + KMS, SQS/SNS, Temporal, CloudFront.
- Implement core schema + migrations (users, voice_profiles, enrollment_sessions, tracks, track_versions, jobs, share_tokens, audit logs, entitlements, billing_holds).
- Configure S3 layout + lifecycle policies; signed URL uploads; HLS key handling.
- API scaffold: auth validation, rate limits, OpenAPI request validation, job status polling.

### Phase 2: Enrollment Pipeline (8-12d)
- Mobile recording flow for spoken + sung prompts; consent capture.
- Chunk uploads with session TTL and metadata tracking.
- QC worker (VAD, clipping, SNR) + re-record UX.
- Replicate embedding extraction + verification; voice profile activation.
- Deletion workflow (GDPR) + audit events.

### Phase 3: Track + Lyrics Flow (6-9d)
- Track creation endpoint; moderation checks; risk scoring.
- Lyrics generation + user editing/approval; message anchor enforcement.
- Music plan generation (BPM/key/section map).

### Phase 4: Preview Render Pipeline (10-14d)
- ElevenLabs instrumental + guide vocal for chorus-only preview.
- Replicate voice conversion with artifact scoring and retry rules.
- Mix/master/encode + watermark + provenance.
- Idempotent workflow steps and dedupe by params_hash.
- Notifications + status updates; metrics for p95 latency.

### Phase 5: Full Render + Rerolls + Billing (11-15d)
- Section-by-section processing; full-length instrumental plan.
- Billing hold/capture/release; feature flag for preview-only mode.
- Reroll workflows (lyrics/beat/vocals/section) with reuse of artifacts.
- Retention cleanup for intermediate assets.

### Phase 6: Sharing + Device Binding (7-10d)
- Share token creation (creator only), one token per track; revoke support.
- Web playback with short-lived stream-only URLs.
- App claim flow binds token to device; enforce app-only saving with encrypted HLS.
- Share access audit logging + abuse signals.

### Phase 7: Hardening + Observability (6-9d)
- Load/perf tests (preview + full render) and failure-mode tests.
- Provider outage handling and circuit breakers.
- Rate limit enforcement by risk level.
- Security review: impersonation patterns, retention policy validation, audit log integrity.

**Estimated Total:** 56-82 person-days

## Milestone Acceptance Criteria
- **Enrollment:** QC rejects low-quality samples; voice profile verifies; deletion pipeline completes.
- **Preview:** Watermark + provenance generated; p95 <4 min end-to-end target achieved.
- **Full Render:** Billing hold works; section rendering completes; preview-only flag blocks full renders.
- **Sharing:** Share-once enforced; first-claim device binding; app-only saving; web stream-only access.
- **Compliance:** Audit logging is complete; data retention policies enforced.

## Risk Register (Providers + Compliance)

| Risk | Likelihood | Impact | Detection | Mitigation | Owner |
|------|------------|--------|-----------|------------|-------|
| ElevenLabs guide vocal output is inconsistent or unavailable | Medium | High | POC failures | Validate output format early; maintain Soundverse fallback | Eng |
| Replicate conversion quality or availability issues (no MVP fallback) | High | High | POC + runtime error rates | Tight retries; raise sample quality thresholds; plan Kits AI upgrade path | Eng |
| Provider TOS restricts commercial voice conversion | Medium | High | Contract review | Written approvals; feature gate by region | PM/Legal |
| Latency exceeds 4 minutes p95 | Medium | Medium | Job metrics | Optimize parallelism, reduce retries, simplify arrangements | Eng |
| Share-once bypass via link forwarding | Medium | High | Access logs | Device binding + revoke + short-lived URLs | Eng |
| Device binding fails due to integrity signal issues | Medium | Medium | Claim error rates | Graceful retries; fallbacks for transient failures | Mobile/BE |
| Consent or deletion pipeline incomplete | Low | High | Audit review | Central consent records; deletion workflow tests | PM/Eng |
| HLS key leakage enables off-app saving | Low | High | Security review | Key TTL, device binding checks, watermarking | Eng |
| Cost overruns from retries and failed generations | Medium | Medium | Cost dashboards | Pre-QC, retry caps, budget alerts | PM |
| Moderation misses harmful content | Low | High | User reports | Blocklists, re-check lyrics, manual review queue | PM/Eng |
