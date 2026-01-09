# Project Specification
## Personalized Song Generation Platform
### Message-First Voice Conversion Architecture

---

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Date** | 2026-01-09 |
| **Status** | MVP Implementation In Progress |
| **Target Duration** | MVP: 45–60 seconds • Full: 45–90 seconds |

---

## Implementation Status Summary

**Last Updated:** 2026-01-09

| Category | Status | Notes |
|----------|--------|-------|
| **API Endpoints** | 72% Complete | 28/39 endpoints implemented |
| **Database Schema** | 73% Complete | 11/15 tables created |
| **Preview Pipeline** | DONE | Full E2E working |
| **Full Render Pipeline** | PARTIAL | Works, needs 60-90s testing |
| **iOS App** | 70% Complete | Core flows working |
| **Infrastructure** | DEV ONLY | SQLite/local storage, needs PostgreSQL/S3 |
| **Billing/Subscriptions** | TODO | Not implemented |
| **Sharing/Device Binding** | PARTIAL | Token creation works, binding not enforced |

**Status Markers Used:**
- `[IMPLEMENTED]` - Feature complete and tested
- `[PARTIAL]` - Partially implemented, gaps noted
- `[TODO]` - Not yet implemented
- `[DEVIATION]` - Implementation differs from spec

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Technical Architecture](#2-technical-architecture)
3. [Data Model](#3-data-model)
4. [API Specification](#4-api-specification)
5. [Queue Architecture](#5-queue-architecture)
6. [Workflow State Machines](#6-workflow-state-machines)
7. [Error Handling and Retry Strategy](#7-error-handling-and-retry-strategy)
8. [Security and Compliance](#8-security-and-compliance)
9. [Monitoring and Observability](#9-monitoring-and-observability)
10. [Testing Strategy](#10-testing-strategy)
11. [Deployment Strategy](#11-deployment-strategy)
12. [Cost Estimation](#12-cost-estimation)
13. [Implementation Roadmap](#13-implementation-roadmap)
14. [Appendices](#14-appendices)

---

## 1. Executive Summary

This specification defines a mobile-first platform for generating personalized songs (MVP: 45–60 seconds; Full: 45–90 seconds) using a Guide Vocal to Voice Conversion pipeline. Users record their voice for enrollment, then create custom songs for occasions (birthdays, anniversaries, etc.) that sound like them singing.

### 1.1 Key Value Proposition

- **Message-first design:** The recipient's name and personal message are the emotional anchor
- **Voice personalization:** Songs sound like the user singing, not a generic AI voice
- **Fast preview:** MVP validation target is p95 <4 min end-to-end; full-product stretch target is preview p95 <90 seconds
- **Two-stage commitment:** Preview is cheap; full render requires explicit confirmation

### 1.2 Core Architectural Principles

1. **No voice file uploads** - Enrollment is recording-only in-app to prevent voice cloning attacks
2. **Two-stage rendering** - Cheap preview first (chorus ~15–25s), full render only after confirm or credit spend
3. **Deterministic reproducibility** - Every render is versioned with a full parameter bundle
4. **Idempotent steps + resumable workflow** - GPU steps fail; the system must survive it
5. **Voice Mode restrictions** - Only uses verified user voice profile or platform AI voices
6. **Complete audit trail** - Every output gets watermark + audit log for compliance

### 1.3 System Boundaries

**In Scope:** Native iOS app (SwiftUI) for enrollment + creation, song generation, preview/full rendering, billing integration, basic sharing.

**Out of Scope:** Social feed/discovery, collaborative editing, background music library management, advanced audio editing tools.

---

## 2. Technical Architecture

### 2.1 Technology Stack Decisions

### 2.1.1 Provider Requirements and Fallback Policy

**Primary music provider requirements:**
- Supports instrumental + guide vocal outputs or stems.
- Commercial licensing suitable for user-generated distribution.
- p95 generation under 4 minutes for 45–60s (MVP).

**Primary voice conversion provider requirements:**
- Singing voice conversion from short user samples.
- Stable API with retry support and predictable costs.

**Fallback policy:**
- Trigger fallback after 3 consecutive failures for the same step or >5% error rate in 30 minutes.
- Log provider failovers for audit and quality review.
- Fallbacks are only configured where an alternate provider exists (music in MVP); voice conversion uses Replicate only.

**Selected providers (MVP):**
- Music: ElevenLabs (primary), Soundverse (fallback).
- Voice conversion: Replicate RVC (primary, no fallback in MVP).


| Component | Technology | Rationale | Status |
|-----------|------------|-----------|--------|
| Workflow Orchestration | DB-backed queue + worker (MVP), Temporal planned | Job retries, workflow visibility, upgrade path | [IMPLEMENTED] - Basic runner working |
| Object Storage | AWS S3 with SSE-KMS | Encryption at rest, lifecycle policies, CDN integration | [TODO] - Using local filesystem |
| Primary Database | PostgreSQL 15+ | JSONB for params, row-level security, audit triggers | [TODO] - Using SQLite (sql.js) |
| Message Queue | AWS SQS + SNS | Dead-letter queues, FIFO where needed, serverless | [DEVIATION] - Using DB polling |
| Music Generation | ElevenLabs API | Instrumental + guide vocal generation | [DEVIATION] - Using Suno via Replicate |
| Voice Conversion | Replicate API (RVC v2) | Hosted voice conversion, ~$0.03/run, no GPU infra | [DEVIATION] - Using Seed-VC via Gradio |
| Voice Embedding | Replicate API (ECAPA-TDNN) | Hosted embedding extraction, pay-per-use | [IMPLEMENTED] |
| API Layer | Node.js + Express/Fastify | TypeScript, async/await, OpenAPI spec | [IMPLEMENTED] - Fastify, JavaScript |
| Audio Processing | Python + FFmpeg | Sox, librosa for audio processing | [PARTIAL] - FFmpeg only, no Python |
| CDN | CloudFront | Signed URLs, regional edge caching | [TODO] - Direct file serving |
| Monitoring | Datadog / CloudWatch | APM, custom metrics, log aggregation | [TODO] - Console logging only |

#### 2.1.1 MVP Decision: API-based Voice Conversion

For MVP, all GPU-intensive tasks use cloud APIs instead of self-hosted infrastructure:

- **Voice Embedding:** Replicate API (ECAPA-TDNN) — ~$0.01/run
- **Voice Conversion:** Replicate API (RVC v2) — ~$0.03-0.04/run
- **Tradeoff:** Voice data sent to third-party API (review Replicate's data policy)
- **Upgrade Path:** Kits AI for higher quality, or self-hosted RVC post-MVP

### 2.2 High-Level Architecture

The system consists of four primary layers:

- **Client Layer:** Native iOS app (SwiftUI) with in-app recording, playback, and purchase flow; Android planned post-MVP
- **API Gateway Layer:** Rate limiting, authentication, request validation, signed URL generation
- **Orchestration Layer:** DB-backed workflow worker managing multi-step render pipelines (Temporal planned)
- **Worker Layer:** CPU workers + cloud API integrations (no self-hosted GPU for MVP)

#### 2.2.1 Data Flow Summary

**Enrollment Flow:** Client records audio chunks → S3 upload → CPU QC workers → Replicate API embedding extraction → Voice profile stored encrypted.

**Render Flow:** API creates track version → Moderation → Lyrics generation → Music planning → ElevenLabs (instrumental + guide vocal) → Replicate API (voice conversion) → Mix/master → Watermark → Delivery.

---

## 3. Data Model

### 3.1 Object Storage Layout

```
enrollment/raw/{user_id}/{session_id}/{chunk_id}.wav
```
Raw recording chunks. Retention: 7 days. Encrypted with user-specific key.

```
enrollment/clean/{user_id}/{session_id}/clean.wav
```
Processed enrollment audio. Retention: 7 days. Deleted after voice profile creation.

```
voice_profiles/{user_id}/{voice_profile_id}/embedding.bin
```
Voice embedding for conversion. Retention: Indefinite (until user deletion). Encrypted, access-controlled.

```
assets/stems/{genre}/{pack}/{bpm}/{key}/...
```
Pre-produced music stems. Read-only, CDN-cached, long-term retention.

```
tracks/{user_id}/{track_id}/v{n}/
├── lyrics.json
├── music_plan.json
├── stems/
│   └── inst_{section}.wav (optional)
├── guide_vocal.wav (internal only, never shared)
├── user_vocal.wav
├── mix.wav
├── master.wav
├── master.aac
├── preview.aac
└── provenance.json
```

### 3.2 Database Schema

> **Implementation Note:** Schema implemented via SQLite migrations in `migrations/` directory (14 files). PostgreSQL migration pending.

#### 3.2.1 Users Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key, generated server-side |
| external_id | VARCHAR(255) | Auth provider ID (Firebase/Auth0) |
| email | VARCHAR(255) | Encrypted email for billing |
| risk_level | ENUM | low, medium, high, blocked |
| locale | VARCHAR(10) | User's preferred language |
| country | VARCHAR(2) | ISO country code for compliance |
| created_at | TIMESTAMPTZ | Account creation timestamp |
| updated_at | TIMESTAMPTZ | Last modification timestamp |

#### 3.2.2 Voice Profiles Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID FK | References users.id |
| status | ENUM | pending, active, suspended, deleted |
| embedding_ref | VARCHAR(512) | S3 path to embedding.bin |
| quality_score | DECIMAL(4,2) | 0-100 enrollment quality metric |
| model_version | VARCHAR(50) | Embedding model version used |
| consent_version | VARCHAR(20) | ToS/consent version at creation |
| consent_at | TIMESTAMPTZ | When consent was recorded |
| last_verified_at | TIMESTAMPTZ | Last successful liveness check |
| created_at | TIMESTAMPTZ | Profile creation timestamp |

#### 3.2.3 Enrollment Sessions Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID FK | References users.id |
| status | ENUM | recording, processing, completed, failed_quality, failed_verification, expired |
| prompt_set_id | VARCHAR(50) | Server-generated prompt set identifier |
| prompts_json | JSONB | Actual prompts shown to user |
| chunk_count | INTEGER | Number of chunks uploaded |
| quality_metrics | JSONB | Per-chunk and overall quality data |
| failure_reason | VARCHAR(100) | Failure code if failed |
| started_at | TIMESTAMPTZ | Session start timestamp |
| completed_at | TIMESTAMPTZ | Session completion timestamp |
| expires_at | TIMESTAMPTZ | Session expiration (TTL enforcement) |

#### 3.2.4 Tracks Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID FK | References users.id |
| status | ENUM | draft, preview_ready, rendering, ready, failed, deleted |
| title | VARCHAR(200) | User-provided or generated title |
| occasion | VARCHAR(50) | birthday, anniversary, wedding, etc. |
| recipient_name | VARCHAR(100) | Name to include in lyrics |
| style | VARCHAR(50) | Genre/style selection |
| duration_target | INTEGER | Target duration in seconds |
| voice_mode | ENUM | user_voice, ai_voice_{id} |
| share_token_id | VARCHAR(20) | One-time share token ID (nullable) |
| latest_version | INTEGER | Current version number |
| created_at | TIMESTAMPTZ | Track creation timestamp |
| updated_at | TIMESTAMPTZ | Last modification timestamp |

#### 3.2.5 Track Versions Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| track_id | UUID FK | References tracks.id |
| version_num | INTEGER | Sequential version number |
| parent_version_id | UUID FK | Previous version (for rerolls) |
| status | ENUM | queued, processing, preview_ready, full_ready, failed, blocked |
| render_type | ENUM | preview, full |
| params_json | JSONB | Complete parameter bundle for reproducibility |
| params_hash | VARCHAR(64) | SHA-256 of params for deduplication |
| cost_estimate | DECIMAL(8,4) | Estimated cost in USD |
| actual_cost | DECIMAL(8,4) | Actual cost after completion |
| storage_ref | VARCHAR(512) | S3 path to version artifacts |
| created_at | TIMESTAMPTZ | Version creation timestamp |
| completed_at | TIMESTAMPTZ | Processing completion timestamp |

#### 3.2.6 Jobs Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| track_version_id | UUID FK | References track_versions.id |
| workflow_type | ENUM | enrollment, preview_render, full_render |
| status | ENUM | queued, running, completed, failed, blocked, cancelled |
| step | VARCHAR(50) | Current workflow step name |
| step_data | JSONB | Step-specific state/progress |
| attempts | INTEGER | Number of retry attempts |
| max_attempts | INTEGER | Maximum allowed attempts |
| next_retry_at | TIMESTAMPTZ | Next scheduled retry time |
| error_code | VARCHAR(50) | Error code if failed |
| error_detail | TEXT | Detailed error message |
| worker_id | VARCHAR(100) | ID of processing worker |
| created_at | TIMESTAMPTZ | Job creation timestamp |
| started_at | TIMESTAMPTZ | Processing start timestamp |
| updated_at | TIMESTAMPTZ | Last state change timestamp |

#### 3.2.7 Audit Logs Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Auto-incrementing ID |
| user_id | UUID | User who performed action |
| action | VARCHAR(100) | Action type (enrollment_started, render_requested, etc.) |
| resource_type | VARCHAR(50) | Type of resource affected |
| resource_id | UUID | ID of affected resource |
| metadata_json | JSONB | Additional action context |
| ip_address | INET | Client IP (hashed for privacy) |
| user_agent | VARCHAR(500) | Client user agent |
| created_at | TIMESTAMPTZ | Action timestamp |

#### 3.2.8 Entitlements Table [PARTIAL] - Subscription fields not expanded

| Column | Type | Description |
|--------|------|-------------|
| user_id | UUID PK FK | References users.id |
| tier | ENUM | free, basic, premium, unlimited |
| credits_balance | INTEGER | Available full-render credits |
| credits_used_total | INTEGER | Lifetime credits consumed |
| preview_count_today | INTEGER | Previews generated today |
| preview_count_reset_at | TIMESTAMPTZ | When daily counter resets |
| subscription_id | VARCHAR(100) | External subscription reference |
| renewal_at | TIMESTAMPTZ | Next subscription renewal date |
| updated_at | TIMESTAMPTZ | Last modification timestamp |

#### 3.2.9 Billing Holds Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID FK | References users.id |
| track_version_id | UUID FK | References track_versions.id |
| credits_held | INTEGER | Credits reserved for this render |
| status | ENUM | held, captured, released, expired |
| created_at | TIMESTAMPTZ | Hold creation timestamp |
| expires_at | TIMESTAMPTZ | Auto-release time (30 min default) |
| resolved_at | TIMESTAMPTZ | When hold was captured/released |

#### 3.2.10 Rate Limits Table [IMPLEMENTED]

| Column | Type | Description |
|--------|------|-------------|
| user_id | UUID | User being rate limited |
| action_type | VARCHAR(50) | Action being limited |
| window_start | TIMESTAMPTZ | Current window start time |
| window_seconds | INTEGER | Window duration in seconds |
| count | INTEGER | Actions in current window |
| limit | INTEGER | Maximum allowed in window |

Composite primary key: (user_id, action_type, window_start)


#### 3.2.11 Share Tokens Table [IMPLEMENTED] - Device binding fields exist but not enforced

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(20) | Primary key, share token ID |
| track_id | UUID FK | References tracks.id |
| track_version_id | UUID FK | References track_versions.id |
| creator_id | UUID FK | References users.id |
| status | ENUM | unbound, claimed, revoked, expired |
| bound_device_id | VARCHAR(128) | Device ID of first app claim |
| bound_device_platform | VARCHAR(10) | ios, android |
| bound_app_version | VARCHAR(20) | App version at claim |
| web_stream_allowed | BOOLEAN | True until claimed |
| app_save_allowed | BOOLEAN | Save only inside the mobile app |
| stream_key_id | VARCHAR(64) | Key ID for HLS segment encryption |
| transfer_allowed | BOOLEAN | Admin override to allow rebind |
| social_teaser_id | VARCHAR(20) | Teaser share ID (no playback) |
| social_share_enabled | BOOLEAN | Allow teaser sharing |
| expires_at | TIMESTAMPTZ | Share expiration timestamp |
| created_at | TIMESTAMPTZ | Token creation timestamp |
| last_accessed_at | TIMESTAMPTZ | Last access time |
| access_count | INTEGER | Total access count |

Constraint: one share token per track (share once ever).


---

## 4. API Specification

### 4.1 Authentication

All API endpoints require Bearer token authentication. Tokens are issued by the auth provider (Firebase/Auth0) and validated on every request. The user_id is extracted from the validated token and injected into request context.

### 4.2 Voice Enrollment Endpoints [IMPLEMENTED]

> All enrollment endpoints implemented and working. Minor gaps in reverify processing.

#### 4.2.1 POST /voice/enrollment/start [IMPLEMENTED]

Initiates a new voice enrollment session.

**Request Body:**
```json
{
  "consent_accepted": true,
  "consent_version": "v2.1"
}
```

**Response (200):**
```json
{
  "session_id": "uuid",
  "prompt_set_id": "ps_abc123",
  "prompts": [
    { "id": "p1", "type": "spoken", "text": "The quick brown fox...", "duration_hint_sec": 5 },
    { "id": "p2", "type": "sung", "text": "La la la", "pitch_hint": "C4", "duration_hint_sec": 8 }
  ],
  "upload_urls": [
    { "chunk_id": "c1", "url": "https://s3...presigned...", "expires_at": "ISO8601" }
  ],
  "recording_settings": {
    "sample_rate": 44100,
    "channels": 1,
    "format": "wav",
    "max_chunk_duration_sec": 20
  },
  "session_expires_at": "ISO8601"
}
```

**Error Responses:** 400 (consent not accepted), 403 (enrollment cooldown active), 429 (rate limited)

#### 4.2.2 POST /voice/enrollment/chunk_uploaded

Notifies server that a chunk has been uploaded to the presigned URL.

**Request Body:**
```json
{
  "session_id": "uuid",
  "chunk_id": "c1",
  "prompt_id": "p1",
  "duration_sec": 12.5,
  "client_checksum": "sha256..."
}
```

**Response (200):**
```json
{
  "status": "accepted",
  "qc_job_id": "uuid",
  "next_upload_url": {...}
}
```

**Error Responses:** 400 (invalid session/chunk), 404 (session not found), 410 (session expired)

#### 4.2.3 POST /voice/enrollment/complete

Signals all chunks uploaded; triggers final QC and embedding extraction.

**Request Body:**
```json
{
  "session_id": "uuid"
}
```

**Response (202):**
```json
{
  "status": "processing",
  "job_id": "uuid",
  "estimated_completion_sec": 30
}
```

#### 4.2.4 GET /voice/profile

Retrieves current user's voice profile status.

**Response (200):**
```json
{
  "profile_id": "uuid",
  "status": "active",
  "quality_score": 87.5,
  "created_at": "ISO8601",
  "last_verified_at": "ISO8601",
  "model_version": "embed_v3",
  "requires_reverification": false
}
```

**Response (404 if no profile exists):**
```json
{
  "error": "NO_VOICE_PROFILE",
  "message": "Voice profile not found"
}
```

#### 4.2.5 POST /voice/reverify

Initiates step-up liveness verification for existing profile.

**Request Body:**
```json
{
  "reason": "high_risk_activity"
}
```

**Response (200):**
```json
{
  "challenge_id": "uuid",
  "challenge_type": "random_phrase",
  "prompt": { "text": "Seven blue elephants...", "duration_hint_sec": 5 },
  "upload_url": "https://s3...presigned...",
  "expires_at": "ISO8601"
}
```

#### 4.2.6 DELETE /voice/profile

Permanently deletes user's voice profile (GDPR right to deletion).

**Response (200):**
```json
{
  "deleted": true,
  "deletion_job_id": "uuid"
}
```

### 4.3 Track Generation Endpoints [IMPLEMENTED]

> Core track and version endpoints implemented. Full render tested on short tracks only.

#### 4.3.1 POST /tracks [IMPLEMENTED]

Creates a new track shell (no rendering yet).

**Request Body:**
```json
{
  "title": "Happy Birthday Sarah!",
  "occasion": "birthday",
  "recipient_name": "Sarah",
  "style": "pop_upbeat",
  "duration_target": 60,
  "voice_mode": "user_voice",
  "message": "Wishing you the best day ever!",
  "must_include_lines": ["You light up every room"],
  "language": "en"
}
```

**Response (201):**
```json
{
  "track_id": "uuid",
  "status": "draft",
  "created_at": "ISO8601"
}
```

**Error Responses:** 400 (validation error), 403 (voice profile required for user_voice mode)

#### 4.3.2 POST /tracks/{id}/versions

Creates a new version with specific parameters (does not start rendering).

**Request Body:**
```json
{
  "params": {
    "lyrics_style": "heartfelt",
    "beat_density": "normal",
    "prosody_preset": "playful",
    "similarity_strength": "medium",
    "clarity_mode": true,
    "message_anchor_repetitions": 2
  },
  "render_type": "preview"
}
```

**Response (201):**
```json
{
  "track_version_id": "uuid",
  "version_num": 1,
  "params_hash": "sha256...",
  "cost_estimate": { "credits": 1, "usd": 0.15 },
  "status": "queued"
}
```

#### 4.3.3 POST /tracks/{id}/versions/{v}/render_preview

Initiates chorus-only preview render (15-25 seconds).

**Request Body:**
```json
{}
```

**Response (202):**
```json
{
  "job_id": "uuid",
  "estimated_completion_sec": 90,
  "poll_url": "/jobs/{job_id}",
  "webhook_url": "optional..."
}
```

**Error Responses:** 402 (insufficient credits/daily limit), 403 (voice profile inactive), 409 (already rendering)

#### 4.3.4 POST /tracks/{id}/versions/{v}/render_full

Initiates full-length render after preview confirmation.

**Request Body:**
```json
{
  "confirm_credit_spend": true
}
```

**Response (202):**
```json
{
  "job_id": "uuid",
  "billing_hold_id": "uuid",
  "credits_reserved": 1,
  "estimated_completion_sec": 180
}
```

#### 4.3.5 POST /tracks/{id}/versions/{v}/reroll

Creates a new version with targeted regeneration.

**Request Body (lyrics reroll):**
```json
{
  "target": "lyrics",
  "constraints": { "keep_chorus": true, "change_verse_2": true }
}
```

**Request Body (beat reroll):**
```json
{
  "target": "beat",
  "constraints": { "new_genre": "acoustic", "keep_bpm": true }
}
```

**Request Body (vocals reroll):**
```json
{
  "target": "vocals",
  "constraints": { "prosody_preset": "dramatic" }
}
```

**Request Body (section reroll):**
```json
{
  "target": "section",
  "section": "chorus",
  "change": "vocals"
}
```

**Response (201):**
```json
{
  "new_version_id": "uuid",
  "version_num": 2,
  "reuses_from_v1": ["instrumental", "lyrics"]
}
```

#### 4.3.6 GET /jobs/{job_id}

Polls job status and progress.

**Response (200 - in progress):**
```json
{
  "job_id": "uuid",
  "status": "running",
  "step": "voice_conversion",
  "progress_pct": 65,
  "steps_completed": ["moderation", "lyrics", "music_plan", "instrumental", "guide_vocal"],
  "steps_remaining": ["voice_conversion", "mix", "watermark"],
  "estimated_remaining_sec": 35,
  "started_at": "ISO8601"
}
```

**Response (200 - completed):**
```json
{
  "job_id": "uuid",
  "status": "completed",
  "preview_url": "https://cdn.../preview.aac",
  "expires_at": "ISO8601"
}
```

#### 4.3.7 GET /tracks/{id}

Retrieves track with all versions and current status.

**Response (200):**
```json
{
  "track_id": "uuid",
  "status": "preview_ready",
  "title": "...",
  "latest_version": 2,
  "versions": [
    { "version_num": 1, "status": "preview_ready", "preview_url": "..." },
    { "version_num": 2, "status": "processing", "job_id": "..." }
  ]
}
```

### 4.4 Sharing Endpoints [PARTIAL]

> Share token creation works. Device binding not enforced. Web player incomplete. Teaser sharing TODO.

**Device Binding (MVP):** First app claim binds the token to a device using iOS IDFV + App Attest or Android App Set ID + Play Integrity. Web playback is stream-only; saving requires the app.

**App-Only Storage (MVP):** Serve HLS with per-segment AES-128 encryption. Decryption keys are issued only to the bound device via short-lived, signed requests.


#### 4.4.1 POST /tracks/{id}/share

Generates a one-time share link (share once ever). Web access is stream-only; saving requires app claim.

**Request Body:**
```json
{
  "version_num": 1,
  "expires_in_days": 30
}
```

**Response (201):**
```json
{
  "share_id": "abc123xyz",
  "share_url": "https://app.example.com/s/abc123xyz",
  "expires_at": "ISO8601",
  "qr_code_url": "https://cdn.../qr/abc123xyz.png"
}
```

#### 4.4.2 GET /share/{share_id}

Public endpoint (no auth required) for stream-only playback until claimed.

**Response (200 - unbound):**
```json
{
  "status": "unbound",
  "title": "Happy Birthday Sarah!",
  "created_by": "A friend",
  "duration_sec": 62,
  "web_stream_url": "https://cdn.../stream/...",
  "cover_image_url": "https://cdn.../covers/...",
  "app_download_url": "https://app.example.com/download",
  "expires_at": "ISO8601"
}
```

**Response (200 - claimed):**
```json
{
  "status": "claimed",
  "app_required": true,
  "app_download_url": "https://app.example.com/download",
  "expires_at": "ISO8601"
}
```

**Error Responses:** 404 (not found), 410 (expired)

#### 4.4.3 POST /share/{share_id}/claim

Binds the share token to the first app device that claims it.

**Request Body:**
```json
{
  "device_id": "ios-idfv-123",
  "platform": "ios",
  "app_version": "1.0.0"
}
```

**Response (200):**
```json
{
  "status": "claimed",
  "app_save_allowed": true,
  "expires_at": "ISO8601"
}
```

**Error Responses:** 409 (token already bound)

#### 4.4.4 GET /share/{share_id}/stream

App playback endpoint for bound devices only.

**Headers:**
```
X-Device-Id: ...
X-Platform: ios|android
```

**Response (200):**
```json
{
  "stream_url": "https://cdn.../stream/...",
  "expires_at": "ISO8601"
}
```

**Error Responses:** 404 (not found), 410 (expired), 409 (token already bound), 412 (not claimed)


#### 4.4.5 Device Claim Contract (MVP)

Device binding uses platform attestation on first claim. The client must present a platform-specific attestation token when calling `/share/{share_id}/claim`.

**Required Headers (claim + stream):**
```
X-Device-Id: <platform device id>
X-Platform: ios|android
X-App-Version: <semver>
X-Device-Attestation: <token>
```

**Attestation Requirements:**
- **iOS:** App Attest token bound to IDFV and app bundle ID.
- **Android:** Play Integrity token bound to App Set ID and package name.

**Server Validation:**
- Verify attestation signature and freshness (max 5 min).
- Match `X-Device-Id` to attested device identifier.
- Persist `bound_device_id`, `bound_platform`, `bound_app_version` on first claim.

**Error Responses:** 400 (missing headers), 401 (invalid attestation), 409 (token already bound), 410 (expired)

#### 4.4.6 HLS Key Service Contract (MVP)

Share playback uses HLS with per-segment AES-128 encryption. Keys are issued only to the bound device.

**Key URI (in playlist):**
```
#EXT-X-KEY:METHOD=AES-128,URI="https://api.example.com/share/{share_id}/keys/{key_id}",IV=0x<iv>
```

**Endpoint:**
```
GET /share/{share_id}/keys/{key_id}
```

**Headers:**
```
X-Device-Id: ...
X-Platform: ios|android
X-Device-Attestation: <token>
```

**Response (200):**
- Raw 16-byte AES key
- `Cache-Control: no-store`
- `Expires: <short TTL>`

**Offline playback (MVP):** App may cache encrypted segments and store the AES key in secure storage for up to 7 days. On TTL expiry or share revoke, key requests fail and playback stops.

**Error Responses:** 401 (invalid attestation), 409 (token already bound), 412 (not claimed), 410 (expired)


#### 4.4.7 POST /tracks/{id}/share_teaser

Generates a social teaser link with no playback or claim capability.

**Request Body:**
```json
{
  "version_num": 1
}
```

**Response (201):**
```json
{
  "teaser_id": "t_abc123xyz",
  "teaser_url": "https://app.example.com/t/t_abc123xyz",
  "og_image_url": "https://cdn.../teaser/t_abc123xyz.png"
}
```

#### 4.4.8 GET /t/{teaser_id}

Public teaser page. Shows cover art + CTA; does not allow streaming or claiming.

**Response (200):**
```json
{
  "title": "Happy Birthday Sarah!",
  "teaser": true,
  "cover_image_url": "https://cdn.../teaser/t_abc123xyz.png",
  "cta_url": "https://app.example.com/download"
}
```

#### 4.4.9 DELETE /tracks/{id}/share


Revokes an active share link.

**Response (200):**
```json
{
  "revoked": true
}
```



#### 4.4.10 POST /admin/share/{share_id}/rebind

Admin-only endpoint to allow a one-time device rebind. Requires audit logging and reason.

**Request Body:**
```json
{
  "new_device_id": "ios-idfv-456",
  "platform": "ios",
  "reason": "recipient replaced phone"
}
```

**Response (200):**
```json
{
  "status": "claimed",
  "bound_device_id": "ios-idfv-456"
}
```

### 4.5 Billing Endpoints [TODO]

> Billing/subscription system not implemented. GET /entitlements returns static values.

#### 4.5.1 POST /billing/receipt/apple

Validates and processes Apple App Store receipt.

**Request Body:**
```json
{
  "receipt_data": "base64...",
  "transaction_id": "..."
}
```

**Response (200):**
```json
{
  "valid": true,
  "entitlements_updated": true,
  "new_tier": "premium",
  "credits_added": 10,
  "renewal_at": "ISO8601"
}
```

#### 4.5.2 POST /billing/receipt/google

Validates and processes Google Play receipt.

**Request Body:**
```json
{
  "purchase_token": "...",
  "product_id": "...",
  "package_name": "..."
}
```

#### 4.5.3 GET /billing/entitlements

Returns current user's billing status and credit balance.

**Response (200):**
```json
{
  "tier": "premium",
  "credits_balance": 8,
  "credits_used_total": 42,
  "previews_remaining_today": 15,
  "preview_daily_limit": 20,
  "subscription_status": "active",
  "renewal_at": "ISO8601",
  "held_credits": 1
}
```

### 4.6 Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /voice/enrollment/* | 3 sessions | per 24 hours |
| POST /tracks | 20 tracks | per hour |
| POST /*/render_preview | 20 previews (free), 50 (premium) | per day |
| POST /*/render_full | By credits | No time limit, credit-gated |
| POST /*/reroll | 10 per track | per hour |
| GET /jobs/* | 60 requests | per minute |
| GET /share/* | 100 requests | per minute per IP |
| POST /share/*/claim | 10 requests | per hour per device |
| POST /tracks/*/share_teaser | 20 requests | per hour |
| GET /t/* | 200 requests | per minute per IP |


---

## 5. Queue Architecture

### 5.1 Queue Definitions

| Queue Name | Type | Visibility Timeout | DLQ Retention |
|------------|------|-------------------|---------------|
| q.enrollment.cpu | Standard | 30 sec | 14 days |
| q.voiceprofile.api | Standard | 120 sec | 14 days |
| q.render.plan.cpu | FIFO | 60 sec | 7 days |
| q.render.music.api | Standard | 120 sec | 7 days |
| q.render.convert.api | Standard | 180 sec | 7 days |
| q.render.mix.cpu | Standard | 60 sec | 7 days |
| q.moderation.cpu | FIFO | 30 sec | 30 days |
| q.watermark.cpu | Standard | 30 sec | 7 days |
| q.notify.cpu | Standard | 30 sec | 3 days |
| q.review.manual | FIFO | N/A | 90 days |

**MVP Note:** GPU queues replaced with API queues. Voice embedding and conversion use Replicate API. Music generation uses ElevenLabs API.

### 5.2 Worker Pool Configuration

#### 5.2.1 CPU Workers

- **Instance type:** c6i.xlarge (4 vCPU, 8 GB RAM) or equivalent
- **Autoscaling:** 2-16 instances based on queue depth
- **Scale-up threshold:** Queue depth > 10 messages for 60 seconds
- **Scale-down threshold:** Queue depth < 2 messages for 300 seconds
- **Processes:** enrollment QC, lyrics generation, mix/master, watermark, notifications

#### 5.2.2 API Workers (Serverless/Lambda)

- **Type:** Serverless functions or lightweight containers
- **Concurrency:** Managed by cloud provider, scales automatically
- **External APIs called:**
  - **Replicate API** — Voice embedding (ECAPA-TDNN), voice conversion (RVC v2)
  - **ElevenLabs API** — Instrumental + guide vocal generation
  - **OpenAI/Claude API** — Lyrics generation, moderation
- **Cost model:** Pay-per-API-call, no idle infrastructure costs

**MVP Note:** No self-hosted GPU infrastructure. All GPU tasks use cloud APIs.

#### 5.2.3 Message Format

All queue messages follow this envelope structure:

```json
{
  "message_id": "uuid",
  "message_type": "ENROLLMENT_QC",
  "correlation_id": "workflow_run_id",
  "timestamp": "ISO8601",
  "retry_count": 0,
  "max_retries": 3,
  "payload": { /* step-specific data */ },
  "trace_context": { "trace_id": "...", "span_id": "..." }
}
```

---

## 6. Workflow State Machines

> **Implementation Note:** Workflows implemented in `src/workflows/runner.js` using DB-backed polling. Circuit breakers and DLQ pending (Phase 3 of implementation plan).

### 6.1 Voice Enrollment Workflow [IMPLEMENTED]

#### 6.1.1 State Diagram

**States:** CREATED → RECORDING → UPLOADING → QC_PROCESSING → ASSEMBLING → EMBEDDING → VERIFYING → COMPLETED

**Failure states:** FAILED_QUALITY, FAILED_VERIFICATION, EXPIRED, COOLDOWN

#### 6.1.2 Step Details

**E0: Session Initialization**
- **Trigger:** User taps "Enable my voice"
- **Actions:** Create enrollment_session (status=recording), generate server-side prompt_set_id with 6-10 random phrases and 1-2 sung prompts, return prompts with recording guide
- **Timeout:** Session expires after 30 minutes of inactivity

**E1: Chunk Upload**
- Client records in 10-20 second chunks, uploads to presigned URLs
- Each chunk_uploaded call triggers QC
- **Validation:** Check file exists in S3, verify checksum matches, validate audio format/sample rate
- **Edge case:** If user goes offline, allow local capture but uploads must complete within TTL or session restarts

**E2: CPU QC + Cleaning**
- **Queue:** q.enrollment.cpu
- **Input:** raw chunk WAV
- **Processing:** VAD trim, clipping detection (reject if >5% samples clipped), SNR estimate (reject if <15dB), duration check (reject if <3s of speech), sample rate normalization to 44.1kHz, light denoise/dereverb only if SNR<25dB
- **Output:** clean chunk stored, per-chunk quality metrics updated
- **Failure:** Too noisy/clipped/short → request re-record that specific chunk with detailed feedback

**E3: Assembly + Final QC**
- **Queue:** q.enrollment.cpu
- **Actions:** Concatenate all clean chunks, produce final clean.wav, compute overall quality_score (weighted average of chunk scores)
- **Threshold:** If quality_score < 70, session = failed_quality with specific improvement suggestions

**E4: Voice Embedding Extraction (Replicate API)**
- **Queue:** q.voiceprofile.api
- **Input:** clean.wav
- **Processing:** Call Replicate API (ECAPA-TDNN model), extract 256-dimensional voice embedding
- **Output:** embedding.bin encrypted with user-specific KMS key
- **Cost:** ~$0.01 per extraction
- **Retry:** On API error, retry with exponential backoff (1s, 2s, 4s, 8s, 16s)

**E5: Liveness Verification**
- **Queue:** q.voiceprofile.api
- **Processing:** Compare embedding against random prompt subset not used in enrollment, verify speaker consistency across prompts (using Replicate API)
- **Pass criteria:** Cosine similarity > 0.85 across all verification prompts
- **Pass:** Create voice_profile (status=active), session = completed
- **Fail:** Session = failed_verification, increment risk_score

#### 6.1.3 Abuse Prevention

- **Failed session limit:** 3 failures in 24 hours → disable enrollment for 24 hours
- **Verification failure limit:** 2 consecutive failures → require step-up identity verification
- **Risk score accumulation:** High risk users require manual review before voice mode activation
- **Device fingerprinting:** Track device ID to detect enrollment farming

### 6.2 Preview Render Workflow (Chorus-only 15-25s) [IMPLEMENTED]

#### 6.2.1 State Diagram

**States:** QUEUED → MODERATION → LYRICS → MUSIC_PLAN → INSTRUMENTAL → GUIDE_VOCAL → VOICE_CONVERT → MIX → WATERMARK → READY

**Failure states:** BLOCKED (moderation), FAILED_LYRICS, FAILED_MUSIC, FAILED_VOCALS, FAILED_MIX

#### 6.2.2 Step Details

**R0: Request Validation (Synchronous)**
- **Actions:** Check entitlements/credits, enforce rate limits, verify voice_profile status (must be active for user_voice mode), create track_version (status=queued), create job (status=queued, step=moderation), log audit event
- Validation errors return immediately without creating job

**R1: Moderation**
- **Queue:** q.moderation.cpu
- **Input:** User prompt, any user-provided lyrics, recipient name
- **Checks:** Profanity filter, impersonation detection (block "sound like Drake" etc.), hate speech detection, PII in lyrics
- **Pass:** Continue to lyrics
- **Block:** job=blocked, track_version=blocked, return reason to user
- **Edge case:** Names that match celebrity names → allow but flag for review

**R2: Lyric Generation/Refinement**
- **Queue:** q.render.plan.cpu
- **Inputs:** occasion, recipient_name, tone, style, language, must_include_lines
- **If user-provided lyrics:** Run singability pass (syllable limits 6-12 per line, light rhyme optimization)
- **If generating:** Use LLM with strict structure rules, enforce simplicity, include "message anchor line" repeated in chorus
- **Output:** lyrics.json with sections, lines, syllable counts, timing hints
- **Validation:** Re-run moderation if lyrics significantly changed
- **Name handling:** Use literal spelling from user input, never auto-correct or invent

**R3: Music Plan Generation**
- **Queue:** q.render.plan.cpu
- **Input:** Style selection, lyrics structure
- **Output:** music_plan.json containing: BPM (tempo), key signature, chord progression template, section timing map (bars per section), beat pack IDs (primary + fallback)
- **For preview:** Only plan chorus section (8-16 bars)

**R4: Instrumental Render**
- **Queue:** q.render.music.cpu
- **Input:** music_plan.json, beat pack references
- **Processing:** Pull stems/loops from asset storage, time-stretch to target BPM, pitch-shift to target key, arrange into chorus-only instrumental
- **Output:** inst_preview.wav (15-25 seconds)
- **Failover:** If primary pack missing → use fallback pack. If render fails → retry once with simpler arrangement, else mark failed_music

**R5: Guide Vocal Synthesis (ElevenLabs API)**
- **Queue:** q.render.music.api
- **Input:** lyrics.json (chorus only), music_plan.json timing
- **Processing:** Call ElevenLabs API to generate synthetic guide vocal aligned to bar timing
- **Output:** guide_vocal.wav (internal only, never user-accessible)
- **Cost:** Included in ElevenLabs music generation cost (~$0.02-0.03)
- **Retry:** On API error, retry with exponential backoff

**R6: Voice Conversion (Replicate API)**
- **Queue:** q.render.convert.api
- **Input:** guide_vocal.wav, voice embedding (user or AI preset)
- **Processing:** Call Replicate API (zsxkib/realistic-voice-cloning) with parameters: similarity_strength (default: medium), pitch_change (default: 0)
- **Output:** user_vocal.wav
- **Cost:** ~$0.03-0.04 per conversion
- **Quality check:** Run automatic artifact scorer (detect metallic sounds, dropouts). If artifact_score > threshold → retry with lower similarity_strength

**R7: Mix + Master + Encode**
- **Queue:** q.render.mix.cpu
- **Input:** inst_preview.wav, user_vocal.wav
- **Processing:** Mix vocal against instrumental (vocal prominently forward), apply de-esser, compression, EQ carve for vocal clarity, loudness normalize to -14 LUFS, apply limiter
- **Output:** preview.aac (128kbps, streaming optimized)
- **Important:** Do NOT store guide_vocal.wav in user-accessible location

**R8: Watermark + Provenance**
- **Queue:** q.watermark.cpu
- **Input:** preview.aac
- **Processing:** Embed inaudible watermark with track_version_id, create provenance.json containing: track_version_id, all model versions used, processing timestamps, moderation decision IDs
- **Output:** Watermarked preview.aac, provenance.json stored with track version

**R9: Finalize + Notify**
- **Queue:** q.notify.cpu
- **Actions:** Update track_version status=preview_ready, generate CDN URL with expiration, send push notification to user, update track.latest_version
- **SLA Target:** Full-product stretch is p95 under 90 seconds total; MVP validation target is p95 <4 min end-to-end

### 6.3 Full Render Workflow (MVP 45-60s, Full 45-90s) [PARTIAL]

> Works but untested with full 60-90s tracks. Section-by-section voice conversion implemented.

Full render follows the same step structure as preview but with expanded scope.

#### 6.3.1 Key Differences from Preview

**F0: Credit Reservation**
- Require explicit user confirmation after preview
- Create billing_hold before processing begins
- Hold expires after 30 minutes if job fails

**F1-F3: Extended Planning**
- Lyrics include full structure (verse, pre-chorus, chorus, bridge, outro)
- Music plan includes transitions and section variants
- Add chorus repetition plan for message emphasis

**F4: Full Instrumental**
- Render full-length instrumental (MVP 45-60 seconds, Full 45-90 seconds)
- Optionally generate separate stems (drums, bass, chords, melody/fx) for better mixing
- **Failover:** If stems render fails → use single mixed instrumental

**F5: Section-by-Section Guide Vocal (ElevenLabs API)**
- Generate guide vocal per section via ElevenLabs API to prevent drift:
  - verse_guide.wav
  - prechorus_guide.wav
  - chorus_guide.wav
  - bridge_guide.wav
  - outro_guide.wav
- Stitch with crossfades maintaining prosody consistency
- **Cost:** ~$0.05-0.08 for full song guide vocals

**F6: Section-by-Section Voice Conversion (Replicate API)**
- Convert each section independently via Replicate API for quality control:
  - user_vocal_verse.wav
  - user_vocal_chorus.wav
  - etc.
- Run artifact scoring per section
- If one section bad → rerun only that section with conservative settings
- Final stitch into user_vocal_full.wav
- **Cost:** ~$0.12-0.16 for full song (4-5 sections × $0.03-0.04/section)

**F7: Full Mix/Master**
- If stems exist: proper multitrack mixing with EQ, compression, reverb per stem
- Standard mastering chain
- Export master.wav (internal), master.aac (user download), optional master.mp3

**F8: Enhanced Provenance**
- Watermark includes:
  - voice_profile_id (hashed for privacy)
  - all model versions
  - all seed IDs used
  - all moderation decision IDs
  - processing duration per step

**F9: Billing Finalization**
- **On success:** Capture credits from billing_hold, update entitlements
- **On failure:** Release billing_hold, credits returned to user

**F10: Delivery**
- Track status=ready
- Generate download URLs with 7-day expiration
- Enable sharing
- Send completion notification with preview audio

### 6.4 Reroll Workflows

Rerolls create new track_version linked to prior version. Original outputs are never mutated.

#### 6.4.1 Reroll Types

**1. Lyrics-only Reroll (No GPU)**
- **Input:** New constraints (keep_chorus, change_verse_2, etc.)
- **Processing:** Regenerate lyrics, optionally reuse same music_plan
- **Reuses:** instrumental, guide vocal melody contour
- **Regenerates:** lyrics.json, guide_vocal.wav (if timing changes), voice conversion, mix

**2. Beat Reroll (CPU-heavy)**
- **Input:** New genre/style, keep_bpm flag
- **Processing:** Select new beat pack, regenerate instrumental
- **Reuses:** lyrics
- **Regenerates:** music_plan.json, instrumental, guide_vocal (if timing changes), voice conversion, mix

**3. Vocals Reroll (GPU-heavy)**
- **Input:** New prosody_preset, similarity_strength adjustment
- **Processing:** Regenerate guide vocal OR reconvert with different settings
- **Reuses:** lyrics, music_plan, instrumental
- **Regenerates:** guide_vocal.wav (optional), user_vocal.wav, mix

**4. Section-only Reroll (Cost-optimized)**
- **Input:** target section (chorus, verse_1, bridge), change type (vocals, instrumental)
- **Processing:** Re-render only specified section
- **Reuses:** All other sections
- **Regenerates:** Only target section, final stitch

---

## 7. Error Handling and Retry Strategy

### 7.1 Error Categories

**1. Transient Errors (Retryable)**
- Examples: GPU OOM, network timeout, S3 throttling, worker crash
- Strategy: Exponential backoff with jitter, max 3 retries
- Backoff formula: `min(base * 2^attempt + random(0, 1000ms), max_delay)`

**2. Resource Errors (Retryable with modification)**
- Examples: Model inference failure, audio processing error, stem pack missing
- Strategy: 1 retry with same settings, 1 retry with fallback settings, then fail

**3. Validation Errors (Non-retryable)**
- Examples: Invalid input format, moderation block, rate limit exceeded
- Strategy: Immediate failure with user-friendly error message

**4. System Errors (Non-retryable)**
- Examples: Database corruption, missing encryption keys, configuration error
- Strategy: Alert ops team, fail job, require manual intervention

### 7.2 Retry Policies by Step Type

| Step Type | Max Retries | Backoff | Fallback Action |
|-----------|-------------|---------|-----------------|
| CPU Processing | 3 | 1s, 4s, 16s | DLQ after exhaustion |
| Replicate API | 5 | 1s, 2s, 4s, 8s, 16s | Circuit breaker at 50% failure rate |
| ElevenLabs API | 5 | 1s, 2s, 4s, 8s, 16s | Fallback to Soundverse, then DLQ |
| Voice Conversion API | 3 | 5s, 15s, 45s | Reduce similarity_strength, then DLQ |
| File Operations | 3 | 500ms, 2s, 8s | Verify file exists, then DLQ |

### 7.3 Idempotency Requirements

Every workflow step must be idempotent. This is achieved through:

- **Deterministic output keys:** All outputs use keys derived from (track_version_id, step_name, section_name, params_hash)
- **Check-before-write:** Before processing, check if output already exists with matching params_hash
- **Atomic status updates:** Use database transactions for status changes
- **Deduplication window:** Message IDs tracked for 7 days to prevent duplicate processing

### 7.4 Error Code Catalog

#### 7.4.1 Enrollment Errors (E1xx)

| Code | Name | User Message |
|------|------|--------------|
| E101 | AUDIO_TOO_NOISY | Recording too noisy. Find a quieter space. |
| E102 | AUDIO_CLIPPED | Audio clipping detected. Move further from mic. |
| E103 | AUDIO_TOO_SHORT | Not enough speech detected. Please speak longer. |
| E104 | QUALITY_TOO_LOW | Recording quality insufficient. Try again in better conditions. |
| E105 | VERIFICATION_FAILED | Voice verification failed. Please try again. |
| E106 | SESSION_EXPIRED | Session timed out. Please start over. |
| E107 | ENROLLMENT_COOLDOWN | Too many attempts. Try again in 24 hours. |
| E108 | CONSENT_REQUIRED | Please accept the voice usage terms. |

#### 7.4.2 Render Errors (R2xx)

#### 7.4.5 Share Errors (H6xx)

| Code | Name | User Message |
|------|------|--------------|
| H601 | SHARE_TOKEN_ALREADY_BOUND | This song is already claimed on another device. |
| H602 | SHARE_TOKEN_NOT_CLAIMED | Please claim this song in the app first. |
| H603 | SHARE_TOKEN_EXPIRED | This share link has expired. |
| H604 | SHARE_TOKEN_REVOKED | This share link was revoked by the creator. |
| H605 | SHARE_TOKEN_INVALID_ATTESTATION | Device verification failed. Please try again. |
| H606 | SHARE_TOKEN_KEY_FORBIDDEN | Key access denied for this device. |


| Code | Name | User Message |
|------|------|--------------|
| R201 | MODERATION_BLOCKED | Content not allowed. Please revise your message. |
| R202 | IMPERSONATION_DETECTED | Cannot create songs imitating real artists. |
| R203 | LYRICS_GENERATION_FAILED | Couldn't generate lyrics. Please try different inputs. |
| R204 | MUSIC_RENDER_FAILED | Music creation failed. Our team is notified. |
| R205 | VOICE_CONVERSION_FAILED | Voice processing failed. Trying again... |
| R206 | MIX_FAILED | Audio mixing failed. Our team is notified. |
| R207 | VOICE_PROFILE_INACTIVE | Voice profile needs verification. Please re-verify. |
| R208 | STYLE_NOT_AVAILABLE | Selected style temporarily unavailable. |

#### 7.4.3 Billing Errors (B3xx)

| Code | Name | User Message |
|------|------|--------------|
| B301 | INSUFFICIENT_CREDITS | Not enough credits. Purchase more to continue. |
| B302 | DAILY_LIMIT_REACHED | Daily preview limit reached. Upgrade for more. |
| B303 | RECEIPT_INVALID | Purchase couldn't be verified. Contact support. |
| B304 | SUBSCRIPTION_EXPIRED | Subscription expired. Renew to continue. |
| B305 | HOLD_EXPIRED | Reservation expired. Please confirm again. |

#### 7.4.4 System Errors (S5xx)

| Code | Name | User Message |
|------|------|--------------|
| S501 | INTERNAL_ERROR | Something went wrong. Please try again. |
| S502 | SERVICE_UNAVAILABLE | Service temporarily unavailable. |
| S503 | GPU_CAPACITY | High demand. Your request is queued. |
| S504 | TIMEOUT | Request timed out. Please try again. |

---

## 8. Security and Compliance

### 8.1 Voice Data Protection

#### 8.1.1 Encryption

- **At rest:** All voice data encrypted with AES-256 using AWS KMS
- **In transit:** TLS 1.3 for all API communication
- **Per-user keys:** Voice embeddings encrypted with user-specific KMS keys
- **Key rotation:** Automatic yearly rotation, manual rotation on security events

#### 8.1.2 Access Control

- **Voice embeddings:** Only voice conversion service can read (IAM role-based)
- **Raw recordings:** Auto-deleted after 7 days, no human access except incident response
- **Audit logging:** All access to voice data logged with user, timestamp, purpose
- **Internal access:** Requires security review and time-limited access grants

#### 8.1.3 Voice Profile Deletion (GDPR Article 17)

When user requests deletion:

- **Immediate:** voice_profiles.status = deleted, embedding_ref cleared
- **Within 24 hours:** embedding.bin deleted from S3
- **Within 7 days:** All enrollment session data purged
- **Cascade:** All tracks with user_voice mode marked as voice_deleted
- **Audit:** Deletion event logged with compliance timestamp

### 8.2 Content Moderation

#### 8.2.1 Pre-render Moderation

- **Prompt filtering:** Block profanity, hate speech, PII, impersonation attempts
- **Name validation:** Detect celebrity/public figure names, flag for review
- **Lyrics moderation:** Re-check generated/refined lyrics before vocal synthesis
- **Image references:** If cover art generated, apply image moderation

#### 8.2.2 Impersonation Prevention

- **Block patterns:** "sound like [artist]", "in the style of [singer]", known artist names
- **Voice similarity check:** Compare user embedding against known artist embeddings
- **Output watermarking:** All outputs contain inaudible watermark for tracing

#### 8.2.3 Manual Review Queue

- **Triggers:** High risk_score users, celebrity name detection, moderation edge cases
- **SLA:** Review within 4 hours during business hours
- **Escalation:** Unreviewed items after 24 hours escalate to senior moderator

### 8.3 Audit Trail

Every significant action is logged:

| Event Type | Data Captured |
|------------|---------------|
| enrollment_started | user_id, session_id, consent_version, device_fingerprint |
| enrollment_completed | user_id, profile_id, quality_score, model_version |
| render_requested | user_id, track_id, version_id, params_hash, voice_mode |
| render_completed | version_id, duration_sec, cost, watermark_id |
| moderation_decision | content_hash, decision, reason, reviewer (if manual) |
| share_created | track_id, share_token_id, expiration, permissions |
| share_claimed | share_token_id, bound_device_id, platform, claimed_at |
| share_teaser_created | track_id, teaser_id, created_at |
| share_rebound | share_token_id, old_device_id, new_device_id, admin_id |
| voice_profile_deleted | user_id, profile_id, deletion_reason, compliance_timestamp |
| credits_charged | user_id, amount, reason, balance_after |

### 8.4 Rate Limiting and Abuse Prevention

#### 8.4.1 User Risk Scoring

Risk score (0-100) affects rate limits and feature access:

- **0-25 (low):** Full access, standard limits
- **26-50 (medium):** Reduced preview limits, enrollment verification required
- **51-75 (high):** Voice mode disabled, AI voices only, manual review queue
- **76-100 (blocked):** Account suspended, support contact required

#### 8.4.2 Risk Score Factors

- **+10:** Failed enrollment verification
- **+15:** Moderation block
- **+25:** Impersonation attempt detected
- **+5:** Unusual usage pattern (bulk generation)
- **-5/month:** Clean usage history decay

### 8.5 Watermarking

All user-accessible audio outputs contain:

- **Inaudible watermark:** Encoded track_version_id, user_id hash, timestamp
- **Technology:** Spread-spectrum audio watermarking, survives compression/re-encoding
- **Extraction:** Internal tool can extract watermark from any copy
- **Purpose:** Copyright disputes, abuse investigation, leak tracing

---

## 9. Monitoring and Observability

### 9.1 Key Metrics

#### 9.1.1 Business Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Enrollment completion rate | >80% | <70% over 1 hour |
| Preview completion rate | >95% | <90% over 15 min |
| Full render completion rate | >98% | <95% over 1 hour |
| Preview to full conversion | >30% | <20% over 24 hours |
| Moderation block rate | <5% | >10% over 1 hour |

#### 9.1.2 Performance Metrics

MVP acceptance target is p95 <4 min end-to-end for 45-60s outputs. Preview and full render targets below are full-product stretch goals.

| Metric | Target (p95) | Alert Threshold |
|--------|--------------|-----------------|
| MVP full render latency | <4 min | >5 min p95 |
| Preview render latency (Full) | <90 sec | >120 sec p95 |
| Full render latency (Full) | <180 sec | >240 sec p95 |
| API response time | <200ms | >500ms p95 |
| Queue depth (GPU) | <10 | >25 for 5 min |
| Queue depth (CPU) | <50 | >100 for 5 min |


#### 9.1.3 Infrastructure Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| GPU utilization | 60-80% | >90% for 10 min |
| CPU worker utilization | 40-70% | >85% for 10 min |
| Database connections | <80% pool | >90% pool |
| S3 error rate | <0.1% | >1% over 5 min |
| Dead letter queue depth | 0 | >5 messages |

### 9.2 Logging Strategy

#### 9.2.1 Log Levels by Component

- **API Gateway:** INFO for all requests, ERROR for failures, DEBUG disabled in prod
- **Workers:** INFO for job start/complete, WARN for retries, ERROR for failures
- **Workflows:** INFO for step transitions, ERROR for step failures
- **Security:** WARN for auth failures, ERROR for suspicious activity

#### 9.2.2 Structured Log Format

```json
{
  "timestamp": "ISO8601",
  "level": "INFO",
  "service": "render-worker",
  "trace_id": "abc123",
  "span_id": "def456",
  "user_id": "uuid",
  "job_id": "uuid",
  "step": "voice_conversion",
  "message": "Step completed",
  "duration_ms": 12500,
  "metadata": {
    "similarity_strength": "medium",
    "artifact_score": 0.12
  }
}
```

### 9.3 Alerting Tiers

1. **P1 (Page immediately):** Service down, data loss risk, security breach. Response: <15 min.
2. **P2 (Page during hours):** Degraded performance, elevated error rates. Response: <1 hour.
3. **P3 (Slack notification):** Non-critical anomalies, capacity warnings. Response: <4 hours.
4. **P4 (Daily digest):** Trends, optimization opportunities. Response: Next business day.

### 9.4 Dashboards

- **Executive Dashboard:** DAU, renders/day, revenue, conversion funnel
- **Operations Dashboard:** Queue depths, worker health, error rates, latencies
- **Cost Dashboard:** GPU hours, S3 storage, API calls, cost per render
- **Security Dashboard:** Auth failures, moderation blocks, risk score distribution

---

## 10. Testing Strategy

### 10.1 Test Pyramid

1. **Unit Tests (70%):** Individual functions, business logic, data transformations. Coverage target: >80% line coverage.
2. **Integration Tests (20%):** API endpoints, database operations, queue interactions. Coverage: All API endpoints, all DB operations.
3. **End-to-End Tests (10%):** Complete workflows from API to final output. Coverage: Happy paths + critical error paths.

### 10.2 Critical Test Scenarios

#### 10.2.1 Enrollment Tests

- **Happy path:** Complete enrollment with good audio → profile created
- **Chunk re-record:** QC failure on chunk 3 → re-record requested → success
- **Verification failure:** Embedding extracted but verification fails → cooldown applied
- **Session timeout:** Partial upload, 30 min passes → session expired
- **Concurrent sessions:** User starts new session while one active → old session cancelled

#### 10.2.2 Render Tests

- **Preview happy path:** Request → all steps complete → preview URL returned
- **Moderation block:** Offensive prompt → blocked before GPU spend
- **GPU failure recovery:** OOM on first attempt → retry succeeds on larger instance
- **Section artifact:** One section has high artifact score → section reprocessed
- **Billing hold expiry:** Render fails after 25 min → hold released, credits returned

#### 10.2.3 Reroll Tests

- **Lyrics reroll:** Keep music, regenerate lyrics → new version with correct reuse
- **Beat reroll:** Keep lyrics, new style → new instrumental, guide vocal regenerated
- **Section reroll:** Change only chorus vocals → only chorus reprocessed

#### 10.2.4 Failure Mode Tests

- **Database unavailable:** Graceful degradation, queue messages retained
- **S3 throttling:** Exponential backoff, eventual success
- **GPU pool exhausted:** Queue growth, ETA updates, no data loss
- **Worker crash mid-job:** Job picked up by another worker, idempotent restart

### 10.3 Performance Tests

- **Load test:** 100 concurrent preview renders, 20 full renders
- **Stress test:** 10x normal load for 30 minutes
- **Soak test:** Normal load for 24 hours, check for memory leaks
- **Spike test:** Sudden 5x traffic spike, verify autoscaling response

### 10.4 Security Tests

- **Authentication:** Token validation, expiration, refresh flows
- **Authorization:** User A cannot access User B's tracks/profile
- **Input validation:** SQL injection, XSS, path traversal attempts
- **Rate limiting:** Verify limits enforced, bypass attempts blocked
- **Encryption:** Verify data encrypted at rest and in transit

---

## 11. Deployment Strategy

### 11.1 Environment Topology

| Environment | Purpose | Configuration |
|-------------|---------|---------------|
| Development | Local development, unit tests | Docker Compose, mocked external services |
| Staging | Integration testing, QA | Full stack, reduced scale, synthetic data |
| Production | Live traffic | Full scale, multi-AZ, real data |

### 11.2 Deployment Process

1. **Code Review:** All changes require 2 approvals, automated checks pass
2. **CI Pipeline:** Build → Unit tests → Integration tests → Security scan → Artifact creation
3. **Staging Deploy:** Automatic on merge to main, full E2E test suite runs
4. **Production Deploy:** Manual trigger, canary deployment (5% traffic for 15 min)
5. **Validation:** Automated smoke tests, metric comparison to baseline
6. **Rollout:** Gradual increase to 100% over 30 minutes if healthy
7. **Rollback:** Automatic if error rate >2x baseline, manual trigger available

### 11.3 Database Migration Strategy

- All migrations must be backward compatible (add columns, not remove)
- Separate deploy for schema changes vs application code
- Migration sequence: Schema up → Deploy new code → Remove old columns (after 7 days)
- Rollback plan: Application code rollback always works with current schema

### 11.4 Feature Flags

Feature flags control rollout of new functionality:

| Flag Name | Purpose | Default |
|-----------|---------|---------|
| ff_voice_enrollment_v2 | New enrollment flow | false |
| ff_section_reroll | Section-level reroll feature | false |
| ff_new_voice_model | Updated voice conversion model | 10% rollout |
| ff_preview_only_mode | Disable full renders (emergency) | false |
| ff_maintenance_mode | Read-only mode for maintenance | false |

### 11.5 Rollback Procedures

#### 11.5.1 Application Rollback

- **Trigger:** Error rate >2x baseline OR manual trigger
- **Action:** Revert to previous container image
- **Duration:** <5 minutes to complete rollback
- **Validation:** Automated health checks confirm rollback success

#### 11.5.2 Model Rollback

- Voice models versioned independently of application
- Rollback via feature flag to previous model version
- Both versions remain deployed for instant switch

#### 11.5.3 Data Rollback

- **Database:** Point-in-time recovery available (5-minute granularity)
- **S3:** Object versioning enabled on critical buckets
- **Decision:** Data rollback requires incident commander approval

---

## 12. Cost Estimation

### 12.1 Per-Render Cost Breakdown (API-based MVP)

#### 12.1.1 Preview Render (15-25s)

| Component | Resource | Cost |
|-----------|----------|------|
| Moderation + Lyrics | LLM API | $0.01 |
| Music Planning | CPU (5 sec) | $0.001 |
| Instrumental + Guide Vocal | ElevenLabs API | $0.03 |
| Voice Conversion | Replicate API | $0.03-0.04 |
| Mix/Master/Watermark | CPU (10 sec) | $0.001 |
| Storage (7 days) | S3 (~10MB) | $0.001 |
| **TOTAL** | | **~$0.07-0.08** |

#### 12.1.2 Full Render (MVP 45-60s, Full 45-90s)

| Component | Resource | Cost |
|-----------|----------|------|
| Extended Planning | LLM API | $0.02 |
| Full Instrumental + Sections | ElevenLabs API | $0.06-0.08 |
| Voice Conversion (sections) | Replicate API | $0.12-0.16 |
| Mix/Master/Watermark | CPU (30 sec) | $0.003 |
| Storage (30 days) | S3 (~50MB) | $0.01 |
| **TOTAL** | | **~$0.21-0.27** |

### 12.2 Infrastructure Baseline (API-based MVP — No GPU)

| Component | Specification | Monthly Cost |
|-----------|---------------|--------------|
| CPU Workers (4x) | c6i.xlarge | ~$400 |
| API Servers (3x) | t3.medium | ~$100 |
| PostgreSQL | db.r6g.large | ~$200 |
| S3 Storage | ~500GB + requests | ~$50 |
| CloudFront | ~1TB transfer | ~$100 |
| Monitoring (Datadog) | Pro tier | ~$200 |
| **BASELINE TOTAL** | | **~$1,050/month** |

**MVP Savings:** No GPU infrastructure = ~$800/month saved. GPU costs replaced by pay-per-use API calls.

### 12.3 Scaling Cost Model (API-based MVP)

At 10,000 monthly active users with average 5 previews and 2 full renders per user:

- **Previews:** 50,000 × $0.075 = $3,750
- **Full renders:** 20,000 × $0.24 = $4,800
- **Infrastructure baseline:** $1,050
- **Infrastructure scaling:** +$500 (CPU only, no GPU)
- **Total:** ~$10,100/month
- **Cost per active user:** ~$1.01/month

**Note:** API-based approach has slightly higher per-render costs but significantly lower infrastructure baseline. Scales linearly with usage (no idle GPU costs).

---

## 13. Implementation Roadmap

### 13.1 Phase 1: Core Infrastructure (Weeks 1-3)

1. Database schema implementation and migrations
2. S3 bucket configuration with encryption and lifecycle policies
3. Queue infrastructure setup (SQS queues, DLQs)
4. Workflow worker + queue deployment (Temporal planned)
5. Basic API scaffolding with authentication
6. CI/CD pipeline setup

**Exit Criteria:** Can create users, store data, process basic queue messages.

### 13.2 Phase 2: Enrollment Pipeline (Weeks 4-6)

1. Voice enrollment API endpoints
2. Audio QC worker (CPU) - VAD, SNR, clipping detection
3. Embedding extraction worker (GPU)
4. Liveness verification logic
5. Enrollment workflow orchestration
6. Enrollment UI integration testing

**Exit Criteria:** Users can complete enrollment and have active voice profile.

### 13.3 Phase 3: Preview Render Pipeline (Weeks 7-10)

1. Moderation service integration
2. Lyrics generation/refinement with LLM
3. Music planning and beat pack selection
4. Instrumental render worker
5. Guide vocal synthesis worker (GPU)
6. Voice conversion worker (GPU)
7. Mix/master/encode worker
8. Watermarking service
9. Preview workflow orchestration
10. End-to-end preview testing

**Exit Criteria:** Users can generate chorus previews end-to-end.

### 13.4 Phase 4: Full Render and Billing (Weeks 11-13)

1. Section-by-section processing logic
2. Full render workflow (extended from preview)
3. Billing hold/capture/release system
4. App Store / Play Store receipt validation
5. Credit system and entitlements
6. Full render end-to-end testing

**Exit Criteria:** Users can generate full songs with billing.

### 13.5 Phase 5: Reroll and Sharing (Weeks 14-15)

1. Lyrics reroll workflow
2. Beat reroll workflow
3. Vocals reroll workflow
4. Section-only reroll workflow
5. Share link generation and public playback
6. Share analytics and expiration

**Exit Criteria:** Users can iterate on songs and share them.

### 13.6 Phase 6: Hardening and Launch (Weeks 16-18)

1. Performance optimization and load testing
2. Security audit and penetration testing
3. Monitoring and alerting refinement
4. Documentation and runbooks
5. Staged rollout to beta users
6. Production launch

**Exit Criteria:** Production-ready system with monitoring and documentation.

---

## 14. Appendices

### 14.1 State Enums Reference

#### 14.1.1 Enrollment Session Status
```
RECORDING | UPLOADING | PROCESSING | ASSEMBLING | EMBEDDING | VERIFYING | COMPLETED | FAILED_QUALITY | FAILED_VERIFICATION | EXPIRED | COOLDOWN
```

#### 14.1.2 Voice Profile Status
```
PENDING | ACTIVE | SUSPENDED | DELETED
```

#### 14.1.3 Track Status
```
DRAFT | PREVIEW_READY | RENDERING | READY | FAILED | DELETED
```

#### 14.1.4 Track Version Status
```
QUEUED | PROCESSING | PREVIEW_READY | FULL_READY | FAILED | BLOCKED
```

#### 14.1.5 Job Status
```
QUEUED | RUNNING | COMPLETED | FAILED | BLOCKED | CANCELLED
```

#### 14.1.6 Billing Hold Status
```
HELD | CAPTURED | RELEASED | EXPIRED
```

### 14.2 Quality Levers Reference

| Parameter | Values | Effect |
|-----------|--------|--------|
| clarity_mode | true/false | Reduces vocal effects, stabilizes consonants |
| similarity_strength | low/med/high | How much output sounds like user voice |
| prosody_preset | heartfelt/playful/dramatic | Affects guide vocal expression |
| beat_density | sparse/normal/busy | Complexity of instrumental arrangement |
| message_anchor_reps | 1-3 | How many times key line repeats in chorus |
| pitch_lock | true/false | Lock pitch to guide vocal (safer) |

### 14.3 Data Retention Policy

| Data Type | Retention | Deletion Method |
|-----------|-----------|-----------------|
| Raw enrollment audio | 7 days | S3 lifecycle policy |
| Clean enrollment audio | 7 days | S3 lifecycle policy |
| Voice embeddings | Until user deletion | Manual + cascade |
| Guide vocals | 7 days | S3 lifecycle policy |
| Final outputs | Until user deletion | Manual |
| Audit logs | 7 years | Archive to Glacier |
| Job logs | 90 days | CloudWatch retention |
| Shared link data | Until expiration | Scheduled cleanup job |

### 14.4 Glossary

| Term | Definition |
|------|------------|
| **Guide Vocal** | Synthetic voice track generated by TTS that serves as the template for voice conversion |
| **Voice Conversion** | Process of transforming the guide vocal to sound like the user's voice using their embedding |
| **Voice Embedding** | 256-dimensional vector representing unique characteristics of a user's voice |
| **Enrollment** | Process where user records their voice to create a voice profile |
| **Preview Render** | Quick, low-cost generation of chorus only (15-25 seconds) |
| **Full Render** | Complete song generation (MVP 45-60 seconds, Full 45-90 seconds) requiring credit spend |
| **Reroll** | Regenerating specific aspects of a song while preserving others |
| **Provenance** | Complete record of how a piece of content was generated |
| **Watermark** | Inaudible identifier embedded in audio for tracking and verification |
| **Billing Hold** | Temporary credit reservation before full render begins |


### 14.5 Open Decisions & Defaults

| Decision | Default | Notes |
|----------|---------|-------|
| Share token transfer | Locked | Admin tool can rebind on exception; log `share_rebound`. |
| Social sharing | Teaser-only | Public teaser pages have no stream or claim. |
| Offline playback | Allowed in-app | Encrypted cache + key TTL (7 days) with periodic revalidation. |
| Provider selection | Selected | Primary: ElevenLabs (music) + Replicate (voice). Fallback: Soundverse (music). Upgrade path: Kits AI (voice). |

### 14.6 Document Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-25 | Initial specification document |
| 1.1.0 | 2025-12-29 | Updated to API-based voice conversion (Replicate) for MVP — no self-hosted GPU |

---

*End of Document*
