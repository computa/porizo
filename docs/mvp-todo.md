# MVP TODO (Execution Order)

## Phase 0: Validation + Policy
- [ ] Confirm ElevenLabs outputs (instrumental + guide vocal).
- [ ] Validate Replicate conversion quality and artifact scoring on 30-60s samples.
- [ ] Verify end-to-end MVP latency p95 <4 min.
- [ ] Finalize provider terms, fallback thresholds (music only), and retry policy.
- [ ] Lock consent, deletion, and anti-impersonation policy.

## Phase 1: Core Infrastructure
- [ ] Provision Postgres, S3 + KMS, SQS/SNS, Temporal, CloudFront.
- [ ] Implement schema + migrations for core tables.
- [ ] Configure S3 layout + lifecycle policies + HLS key handling.
- [ ] API scaffold with auth, rate limits, OpenAPI validation, job polling.

## Phase 2: Enrollment Pipeline
- [ ] Recording flow for spoken + sung prompts with consent capture.
- [ ] Chunk upload flow with session TTL + metadata.
- [ ] QC worker (VAD, clipping, SNR) + re-record UX.
- [ ] Replicate embedding extraction + verification.
- [ ] Voice profile activation + deletion workflow with audit logs.

## Phase 3: Track + Lyrics Flow
- [ ] Track creation + moderation + risk scoring.
- [ ] Lyrics generation + user editing/approval + message anchor enforcement.
- [ ] Music plan generation (BPM, key, section map).

## Phase 4: Preview Render Pipeline
- [ ] ElevenLabs chorus-only instrumental + guide vocal.
- [ ] Replicate voice conversion with artifact scoring and retry rules.
- [ ] Mix/master/encode + watermark + provenance.
- [ ] Idempotent workflow steps and params_hash dedupe.
- [ ] Notifications + status updates + latency metrics.

## Phase 5: Full Render + Rerolls + Billing
- [ ] Section-by-section rendering + full-length instrumentals.
- [ ] Billing hold/capture/release + preview-only feature flag.
- [ ] Reroll workflows with artifact reuse.
- [ ] Retention cleanup for intermediate assets.

## Phase 6: Sharing + Device Binding
- [ ] Share token creation (creator only), one token per track.
- [ ] Web stream-only playback with short-lived URLs.
- [ ] App claim flow binds token to device; enforce app-only saving.
- [ ] Share access audit logs + abuse signals.

## Phase 7: Hardening + Observability
- [ ] Load/perf tests for preview + full render.
- [ ] Provider outage handling and circuit breakers.
- [ ] Rate limits by risk level.
- [ ] Security review: impersonation patterns, retention policies, audit integrity.
