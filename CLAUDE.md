# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Porizo is a personalized song generation platform that creates 45-90 second custom songs using voice conversion technology. Users enroll their voice, then generate songs for occasions (birthdays, anniversaries) that sound like them singing.

**Specification Document:** `specs/personalized-song-platform-spec.md` contains the complete technical specification.

**Implementation Status:** See `docs/spec-audit.md` for detailed implementation vs spec comparison.

## Core Architectural Principles

1. **Message-first design** - The recipient's name and personal message are the emotional anchor
2. **Two-stage rendering** - Cheap preview first (chorus ~15-25s), full render only after confirmation
3. **No voice file uploads** - Enrollment is recording-only in-app to prevent voice cloning attacks
4. **Deterministic reproducibility** - Every render versioned with full parameter bundle (params_hash)
5. **Idempotent steps + resumable workflows** - GPU steps fail; system must survive it
6. **Complete audit trail** - Every output gets watermark + audit log for compliance

## Technology Stack

### Current Implementation (MVP)

| Component | Technology | Status |
|-----------|------------|--------|
| Workflow Orchestration | DB-backed queue + polling runner | IMPLEMENTED |
| Object Storage | Local filesystem (`storage/`) | DEV ONLY |
| Primary Database | SQLite via sql.js (in-memory) | DEV ONLY |
| Music Generation | Suno via Replicate API | IMPLEMENTED |
| Voice Conversion | Seed-VC via Gradio API | IMPLEMENTED |
| Voice Embedding | Replicate API (ECAPA-TDNN) | IMPLEMENTED |
| API Layer | Node.js + Fastify (JavaScript) | IMPLEMENTED |
| Audio Processing | FFmpeg (Node.js child process) | IMPLEMENTED |
| CDN | Direct file serving | DEV ONLY |

### Production Target (Post-MVP)

| Component | Technology | Priority |
|-----------|------------|----------|
| Object Storage | AWS S3 with SSE-KMS | P0 |
| Primary Database | PostgreSQL 15+ | P0 |
| CDN | CloudFront with signed URLs | P0 |
| Workflow Hardening | Circuit breakers, DLQ | P0 |
| Message Queue | AWS SQS/SNS (if needed) | P2 |

### MVP Decision: API-based Voice Conversion

For MVP, we use **Replicate's hosted RVC models** instead of self-hosted GPU infrastructure:
- **Cost:** ~$0.03-0.04 per conversion (pay-per-use)
- **Tradeoff:** Voice embeddings sent to third-party API
- **Upgrade path:** Kits AI for higher quality, or self-hosted RVC post-MVP

## Key Workflows

### Voice Enrollment (E0-E5)
```
CREATED → RECORDING → UPLOADING → QC_PROCESSING → ASSEMBLING → EMBEDDING → VERIFYING → COMPLETED
```
- 6-10 random phrases + 1-2 sung prompts
- CPU QC: VAD trim, clipping detection (>5% = reject), SNR check (<15dB = reject)
- GPU: 256-dimensional voice embedding via Resemblyzer/ECAPA-TDNN
- Quality threshold: score >= 70 to pass

### Preview Render (R0-R9) - Target: p95 < 90 seconds
```
QUEUED → MODERATION → LYRICS → MUSIC_PLAN → INSTRUMENTAL → GUIDE_VOCAL → VOICE_CONVERT → MIX → WATERMARK → READY
```

### Full Render (F0-F10) - Section-by-section processing
- Requires explicit user confirmation after preview
- Billing hold created before processing
- Section-by-section voice conversion for quality control

## Queue Architecture

| Queue | Type | Purpose |
|-------|------|---------|
| q.enrollment.cpu | Standard | Enrollment QC + cleaning |
| q.voiceprofile.api | Standard | Embedding extraction (Replicate API) |
| q.render.plan.cpu | FIFO | Lyrics + music planning |
| q.render.music.api | Standard | Music + guide vocal (ElevenLabs API) |
| q.render.convert.api | Standard | Voice conversion (Replicate API) |
| q.moderation.cpu | FIFO | Content moderation |

**Note:** GPU queues replaced with API queues for MVP — no self-hosted GPU infrastructure.

## Database Schema

**Current:** SQLite via sql.js with 14 migrations in `migrations/` directory.

### Core Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `users` | id, risk_level, locale, created_at | User accounts with risk scoring |
| `voice_profiles` | id, user_id, status, embedding_ref, quality_score | Voice enrollment data |
| `enrollment_sessions` | id, user_id, status, prompts_json, quality_metrics | Recording sessions |
| `tracks` | id, user_id, title, occasion, recipient_name, style, voice_mode | Song metadata |
| `track_versions` | id, track_id, version_num, status, params_json, lyrics_json | Versioned renders |
| `jobs` | id, track_version_id, workflow_type, status, step, progress_pct | Workflow tracking |
| `entitlements` | user_id, tier, credits_balance, preview_count_today | Usage limits |
| `billing_holds` | id, user_id, track_version_id, credits_held, status | Credit reservation |
| `share_tokens` | id, track_id, status, bound_device_id, stream_key | Sharing links |
| `share_access_log` | id, share_token_id, event_type, metadata | Access tracking |
| `audit_logs` | id, user_id, action, resource_type, metadata_json | Compliance audit |
| `rate_limits` | user_id, action_type, window_start_ms, count | Rate limiting |

### Missing Tables (TODO)

| Table | Purpose | Priority |
|-------|---------|----------|
| `poems` | Poem generation feature | Medium |
| `subscriptions` | Subscription management | High |
| `purchase_receipts` | App Store/Play Store receipts | High |

## Storage Layout

**Current:** Local filesystem in `storage/` directory. S3 migration pending.

```
storage/
├── enrollment/
│   ├── raw/{user_id}/{session_id}/{chunk_id}.wav    # Raw recordings
│   └── clean/{user_id}/{session_id}/clean.wav       # Processed audio
├── voice_profiles/
│   └── {user_id}/{voice_profile_id}/embedding.bin   # Voice embeddings
└── tracks/
    └── {user_id}/{track_id}/v{n}/
        ├── lyrics.json
        ├── music_plan.json
        ├── instrumental.mp3
        ├── guide_vocal.wav    # INTERNAL ONLY - never exposed
        ├── voice_converted.wav
        ├── preview.m4a
        └── full.m4a
```

**Critical:** `guide_vocal.wav` is internal-only, never user-accessible.

## Error Codes

| Range | Category | Examples |
|-------|----------|----------|
| E1xx | Enrollment | E101_AUDIO_TOO_NOISY, E105_VERIFICATION_FAILED |
| R2xx | Render | R201_MODERATION_BLOCKED, R205_VOICE_CONVERSION_FAILED |
| B3xx | Billing | B301_INSUFFICIENT_CREDITS, B305_HOLD_EXPIRED |
| S5xx | System | S501_INTERNAL_ERROR, S503_GPU_CAPACITY |

## Retry Strategy

| Step Type | Max Retries | Backoff |
|-----------|-------------|---------|
| CPU Processing | 3 | 1s, 4s, 16s |
| External API (Replicate/ElevenLabs) | 5 | 1s, 2s, 4s, 8s, 16s |
| Voice Conversion API | 3 | 5s, 15s, 45s (reduce similarity_strength on retry) |

## Idempotency Requirements

Every workflow step must be idempotent:
- **Deterministic output keys:** `(track_version_id, step_name, section_name, params_hash)`
- **Check-before-write:** Verify output doesn't exist with matching params_hash
- **Message deduplication:** Track message IDs for 7 days

## Security Constraints

- Voice embeddings encrypted with user-specific KMS keys
- Raw recordings auto-deleted after 7 days
- Impersonation detection: Block "sound like [artist]" patterns
- Risk scoring: 0-25 (low), 26-50 (medium), 51-75 (high/voice disabled), 76-100 (blocked)
- All outputs contain inaudible watermark with track_version_id

## API Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /voice/enrollment/* | 3 sessions/24h |
| POST /tracks | 20/hour |
| POST /*/render_preview | 20/day (free), 50/day (premium) |
| POST /*/reroll | 10 per track/hour |
| GET /jobs/* | 60/minute |

## Performance Targets

| Metric | Target |
|--------|--------|
| Preview render latency | p95 < 90s |
| Full render latency | p95 < 180s |
| API response time | p95 < 200ms |
| Enrollment completion rate | > 80% |
| Preview completion rate | > 95% |

## Cost Per Render (API-based MVP)

- **Preview (15-25s):** ~$0.07 (ElevenLabs music + Replicate voice conversion)
- **Full render (45-90s):** ~$0.25 (section-by-section API calls)

Cost breakdown per preview:
- ElevenLabs (music + guide vocal): ~$0.03
- Replicate (voice conversion): ~$0.03-0.04
- CPU (mix/master/watermark): ~$0.003

## Reroll Types

1. **Lyrics-only** (Cheap) - Regenerate lyrics, reuse instrumental
2. **Beat** (CPU + Music API) - New genre/style, regenerate instrumental
3. **Vocals** (Voice API) - New prosody/similarity settings via Replicate
4. **Section-only** (Cost-optimized) - Re-render single section only
