# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Porizo is a personalized song generation platform that creates 45-90 second custom songs using voice conversion technology. Users enroll their voice, then generate songs for occasions (birthdays, anniversaries) that sound like them singing.

**Specification Document:** `personalized-song-platform-spec.docx` contains the complete technical specification.

## Core Architectural Principles

1. **Message-first design** - The recipient's name and personal message are the emotional anchor
2. **Two-stage rendering** - Cheap preview first (chorus ~15-25s), full render only after confirmation
3. **No voice file uploads** - Enrollment is recording-only in-app to prevent voice cloning attacks
4. **Deterministic reproducibility** - Every render versioned with full parameter bundle (params_hash)
5. **Idempotent steps + resumable workflows** - GPU steps fail; system must survive it
6. **Complete audit trail** - Every output gets watermark + audit log for compliance

## Technology Stack

| Component | Technology |
|-----------|------------|
| Workflow Orchestration | DB-backed queue + worker (MVP), Temporal planned |
| Object Storage | AWS S3 with SSE-KMS |
| Primary Database | PostgreSQL 15+ (JSONB for params) |
| Message Queue | AWS SQS + SNS (FIFO where needed) |
| Music Generation | ElevenLabs API (primary), Soundverse (fallback) |
| Voice Conversion | Replicate API (hosted RVC) — no self-hosted GPU |
| Voice Embedding | Replicate API (ECAPA-TDNN) |
| API Layer | Node.js + Express/Fastify (TypeScript) |
| Audio Processing | Python + FFmpeg, librosa |
| CDN | CloudFront with signed URLs |

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

## Database Schema (Key Tables)

- **users** - Auth, risk_level (low/medium/high/blocked), locale
- **voice_profiles** - Embedding ref, quality_score, model_version, consent tracking
- **enrollment_sessions** - Prompts, chunks, quality metrics, TTL
- **tracks** - Title, occasion, recipient_name, style, voice_mode
- **track_versions** - params_json (full reproducibility), params_hash (dedup), storage_ref
- **jobs** - Workflow step tracking, retry attempts, error codes
- **entitlements** - Tier, credits_balance, daily limits
- **billing_holds** - Credit reservation for full renders (30 min TTL)

## S3 Object Layout

```
enrollment/raw/{user_id}/{session_id}/{chunk_id}.wav    # 7-day retention
enrollment/clean/{user_id}/{session_id}/clean.wav       # 7-day retention
voice_profiles/{user_id}/{voice_profile_id}/embedding.bin  # Encrypted, indefinite
tracks/{user_id}/{track_id}/v{n}/                       # lyrics.json, stems/, master.aac, provenance.json
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
