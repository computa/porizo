# Spec Audit: Implementation Status Report

**Date:** 2026-01-09
**Spec Document:** `specs/personalized-song-platform-spec.md`
**Codebase Version:** Git commit `a49cb21` (main branch)

---

## Executive Summary

The Porizo platform has a functional MVP with core song generation working. Key implementation gaps remain in production infrastructure (PostgreSQL, S3), sharing flow completion, poems feature, and subscription/billing.

| Category | Implemented | Partial | TODO | Total |
|----------|-------------|---------|------|-------|
| API Endpoints | 28 | 5 | 6 | 39 |
| Database Tables | 11 | 1 | 3 | 15 |
| Workflow Steps | 9 | 0 | 0 | 9 |
| iOS Features | 7 | 3 | 5 | 15 |

---

## 1. API Endpoints

### 1.1 Implemented Endpoints

| Endpoint | Spec Section | Notes |
|----------|--------------|-------|
| `GET /health` | 4.1 | Health check with provider status |
| `GET /jobs/:id` | 4.3 | Job status polling with progress |
| `GET /preview/:trackVersionId.mp3` | 4.5 | Preview audio (MP3 format) |
| `GET /preview/:trackVersionId.m4a` | 4.5 | Preview audio (M4A format) |
| `GET /full/:trackVersionId.m4a` | 4.5 | Full audio (authenticated) |
| `GET /guide/:trackVersionId` | 4.5 | Guide vocal with token auth |
| `GET /enrollment/:sessionId/clean.wav` | 4.2 | Clean enrollment audio |
| `PUT /storage/upload` | 4.2 | Presigned upload endpoint |
| `POST /voice/enrollment/start` | 4.2.1 | Start enrollment session |
| `POST /voice/enrollment/chunk_uploaded` | 4.2.2 | Confirm chunk upload |
| `POST /voice/enrollment/complete` | 4.2.4 | Complete enrollment |
| `GET /voice/profile` | 4.2.5 | Get voice profile status |
| `DELETE /voice/profile` | 4.2.6 | Delete voice profile |
| `POST /memory/questions` | 4.4.7 | Generate memory follow-up questions |
| `POST /tracks` | 4.4.1 | Create new track |
| `GET /tracks` | 4.4.2 | List user's tracks |
| `GET /tracks/:id` | 4.4.3 | Get track details |
| `DELETE /tracks/:id` | 4.4.4 | Soft delete track |
| `POST /tracks/:id/versions` | 4.4.5 | Create track version |
| `POST /tracks/:id/versions/:version/render_preview` | 4.4.6 | Render preview |
| `POST /tracks/:id/versions/:version/render_full` | 4.4.7 | Render full (with billing) |
| `POST /tracks/:id/versions/:version/reroll` | 4.4.8 | Reroll lyrics/beat/vocals |
| `GET /tracks/:id/versions/:version/lyrics` | 4.4.9 | Get lyrics JSON |
| `PUT /tracks/:id/versions/:version/lyrics` | 4.4.10 | Update lyrics |
| `POST /tracks/:id/versions/:version/lyrics/generate` | 4.4.11 | Generate lyrics |
| `POST /tracks/:id/versions/:version/lyrics/approve` | 4.4.12 | Approve lyrics |
| `GET /tracks/:id/versions` | 4.4.13 | List track versions |
| `GET /entitlements` | 4.6.1 | Get user entitlements |

### 1.2 Partial Implementations

| Endpoint | Spec Section | Status | Gap |
|----------|--------------|--------|-----|
| `POST /voice/reverify` | 4.2.7 | STUB | Returns challenge but doesn't process verification response |
| `POST /tracks/:id/share` | 4.5.1 | PARTIAL | Creates share token but no device binding enforcement |
| `GET /share/:shareId` | 4.5.2 | PARTIAL | Returns share info but web player not complete |
| `POST /share/:shareId/claim` | 4.5.3 | PARTIAL | Schema exists, device binding logic incomplete |
| `DELETE /tracks/:id/share` | 4.5.6 | PARTIAL | Revokes token but access log cleanup incomplete |

### 1.3 Missing Endpoints

| Endpoint | Spec Section | Priority | Notes |
|----------|--------------|----------|-------|
| `POST /poems` | 4.7.1 | Medium | Poem creation |
| `GET /poems` | 4.7.2 | Medium | List poems |
| `GET /poems/:id` | 4.7.3 | Medium | Get poem details |
| `PUT /poems/:id` | 4.7.4 | Medium | Update poem |
| `DELETE /poems/:id` | 4.7.5 | Medium | Delete poem |
| `POST /billing/purchase-credits` | 4.6.2 | High | Credit purchase flow |

---

## 2. Database Schema

### 2.1 Implemented Tables

| Table | Migration | Notes |
|-------|-----------|-------|
| `users` | 001_init.sql | Includes risk_level, locale |
| `voice_profiles` | 001_init.sql | Embedding ref, quality_score, consent |
| `enrollment_sessions` | 001_init.sql | Prompts, chunks, quality metrics |
| `tracks` | 001_init.sql | Title, occasion, recipient, style, voice_mode |
| `track_versions` | 001_init.sql | Full params_json, lyrics, moderation |
| `jobs` | 001_init.sql | Workflow tracking with step_data |
| `entitlements` | 001_init.sql | Tier, credits, daily limits |
| `billing_holds` | 001_init.sql | Credit reservation (30 min TTL) |
| `share_tokens` | 001_init.sql | Share link with device binding fields |
| `share_access_log` | 001_init.sql | Access tracking |
| `audit_logs` | 001_init.sql | Compliance audit trail |
| `rate_limits` | 001_init.sql | Sliding window rate limiting |

### 2.2 Schema Gaps

| Table | Status | Priority | Notes |
|-------|--------|----------|-------|
| `poems` | MISSING | Medium | Not created - feature not implemented |
| `subscriptions` | MISSING | High | Subscription tier management |
| `purchase_receipts` | MISSING | High | App Store/Play Store receipt validation |
| `entitlements` | PARTIAL | Medium | Subscription fields need expansion |

### 2.3 Migration Files

14 migrations implemented (001-014):
- `001_init.sql` - Core schema
- `002_add_pipeline_assets.sql` - Provider URLs
- `003_add_stream_key.sql` - HLS encryption
- `004_add_provider_urls.sql` - Voice/instrumental URLs
- `005_add_lyrics_and_delete.sql` - Lyrics JSON, soft delete
- `006_add_provenance.sql` - Provenance tracking
- `007_add_access_tokens.sql` - Guide vocal tokens
- `008_add_share_pin.sql` - Share PIN support
- `009_add_version_unique_constraint.sql` - Idempotency
- `010_add_story_context.sql` - Memory questions
- `011_add_moderation_details.sql` - Detailed moderation
- `012_add_job_locks.sql` - Job locking
- `013_add_job_tracking.sql` - Enhanced job status
- `014_add_stream_base_url.sql` - Stream URL config

---

## 3. Workflow Implementation

### 3.1 Preview Render Pipeline (IMPLEMENTED)

| Step | Status | Implementation |
|------|--------|----------------|
| QUEUED | DONE | Job created with status='queued' |
| MODERATION | DONE | GPT-4 content moderation |
| LYRICS | DONE | GPT-4 lyrics generation |
| MUSIC_PLAN | DONE | BPM, key, section planning |
| INSTRUMENTAL | DONE | Suno API via Replicate |
| GUIDE_VOCAL | DONE | ElevenLabs TTS |
| VOICE_CONVERT | DONE | Seed-VC via Gradio |
| MIX | DONE | FFmpeg mix/master |
| WATERMARK | DONE | Metadata embedding |

### 3.2 Full Render Pipeline (PARTIAL)

| Step | Status | Gap |
|------|--------|-----|
| Section-by-section rendering | PARTIAL | Works but untested with 60-90s tracks |
| Billing hold capture | IMPLEMENTED | Credit deduction works |
| Quality verification | TODO | No per-section quality check |

### 3.3 Workflow Runner Gaps

| Feature | Status | Priority |
|---------|--------|----------|
| Durability | MISSING | High - Jobs lost on server restart |
| Circuit breakers | MISSING | High - No provider outage handling |
| Dead letter queues | MISSING | High - Failed jobs not escalated |
| Concurrent limits | MISSING | Medium - Unbounded parallelism |
| Step rollback | MISSING | Medium - Partial failures leave inconsistent state |

---

## 4. Provider Integration

### 4.1 Implemented Providers

| Provider | Purpose | Status | Notes |
|----------|---------|--------|-------|
| ElevenLabs | Guide vocal TTS | DONE | Primary provider |
| Suno | Music generation | DONE | Via Replicate, 30s limit |
| Replicate | Voice embedding | DONE | ECAPA-TDNN model |
| Seed-VC | Voice conversion | DONE | Requires external Gradio server |
| Demucs | Stem separation | DONE | Via Replicate API |
| OpenAI/Claude | Moderation + Lyrics | DONE | GPT-4 or Claude |

### 4.2 Missing Providers

| Provider | Purpose | Priority |
|----------|---------|----------|
| Soundverse | Music fallback | Low - Listed in spec but not critical |

---

## 5. iOS App Status

### 5.1 Implemented Features

| Feature | Status | Notes |
|---------|--------|-------|
| Voice Enrollment | DONE | Full recording flow with QC |
| Track Creation (Simple) | DONE | Basic flow works |
| Track Creation (Advanced) | DONE | With story context |
| Preview Playback | DONE | AVAudioPlayer-based |
| My Songs Tab | DONE | List with playback |
| Settings Tab | DONE | Basic profile view |
| Explore Tab | PARTIAL | UI exists, templates TODO |

### 5.2 Partial/TODO Features

| Feature | Status | Gap |
|---------|--------|-----|
| Poem Creation | TODO | "Coming Soon" badge |
| Poem Display/Edit | STUB | Uses sample data |
| Share to Recipient | TODO | No share UI |
| Subscription Upgrade | TODO | Button exists, no action |
| Push Notifications | TODO | Not implemented |
| Offline Support | TODO | No caching |

---

## 6. Test Coverage

### 6.1 Existing Tests

| Test File | Coverage |
|-----------|----------|
| `enrollment-qc.test.js` | Enrollment audio validation |
| `lyrics.test.js` | Lyrics generation |
| `moderation.test.js` | Content moderation |
| `memory-questions.test.js` | Follow-up question generation |
| `share-flow.test.js` | Share token flow (mocked) |
| `music.test.js` | Music provider integration |
| `suno-provider.test.js` | Suno API |
| `mvp-flow.test.js` | End-to-end MVP flow |
| `qc.test.js` | Quality control |

### 6.2 Missing Test Coverage

| Area | Priority | Notes |
|------|----------|-------|
| E2E workflow tests | High | Full render pipeline |
| Voice conversion (real) | Medium | Currently mocked |
| Device binding | High | Share claim flow |
| Subscription/billing | High | Not implemented |
| Performance/load tests | Medium | No stress testing |

---

## 7. Infrastructure Status

### 7.1 Current State (Development)

| Component | Current | Production Required |
|-----------|---------|---------------------|
| Database | SQLite (sql.js) | PostgreSQL 15+ |
| Storage | Local filesystem | AWS S3 with SSE-KMS |
| CDN | Direct file serving | CloudFront with signed URLs |
| Queue | None (synchronous) | AWS SQS/SNS FIFO |
| Workflow | DB polling runner | Hardened runner with circuit breakers |
| KMS | None | AWS KMS for voice encryption |

### 7.2 Infrastructure Gaps

| Component | Priority | Notes |
|-----------|----------|-------|
| PostgreSQL migration | P0 | Critical for production |
| S3 + CloudFront | P0 | Required for scale |
| Circuit breakers | P0 | Provider failure handling |
| Dead letter queue | P1 | Failed job alerting |
| Voice encryption | P1 | Compliance requirement |

---

## 8. Security Status

### 8.1 Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Rate limiting | DONE | Sliding window per action |
| Risk level scoring | DONE | low/medium/high/blocked |
| Input validation | DONE | JSON schema validation |
| Moderation | DONE | Content + impersonation checks |
| Audit logging | DONE | All sensitive operations |

### 8.2 Gaps

| Feature | Priority | Gap |
|---------|----------|-----|
| Voice embedding encryption | High | Stored unencrypted |
| Audio watermarking | Medium | Metadata only, no inaudible watermark |
| Signed URLs | High | Direct file access in dev |
| Device binding enforcement | High | Fields exist but not enforced |

---

## 9. Deviations from Spec

### 9.1 Intentional Deviations

| Spec Section | Deviation | Rationale |
|--------------|-----------|-----------|
| 5.1 Queue Architecture | Using DB polling instead of SQS | MVP simplicity |
| 6.3 GPU Infrastructure | Using Replicate API instead of self-hosted | Cost optimization |
| 8.1 Temporal.io | Using hardened runner | $100/month cost savings |

### 9.2 Accidental Gaps

| Spec Section | Gap | Impact |
|--------------|-----|--------|
| 4.7 Poems API | Not implemented | Feature missing |
| 4.6.2 Billing | Purchase flow missing | Cannot monetize |
| 5.3 Device Binding | Not enforced | Share security weak |

---

## 10. Recommendations

### Phase 0: Documentation (This Sprint)
1. Update spec with status markers
2. Update CLAUDE.md with current schema
3. Create implementation changelog

### Phase 1: Infrastructure
1. PostgreSQL migration
2. S3 + CloudFront setup
3. Workflow hardening (circuit breakers, DLQ)

### Phase 2: Feature Completion
1. Share flow completion with device binding
2. Poems feature
3. Subscription/billing with StoreKit

### Phase 3: Security
1. Voice embedding encryption
2. Signed URL implementation
3. Security audit

---

*Generated: 2026-01-09*
