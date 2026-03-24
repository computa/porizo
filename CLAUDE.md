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
| Primary Database | PostgreSQL 15+ via Docker | IMPLEMENTED |
| Music Generation | Suno via Replicate API | IMPLEMENTED |
| Voice Conversion | Seed-VC via Gradio API | IMPLEMENTED |
| Voice Embedding | Replicate API (ECAPA-TDNN) | IMPLEMENTED |
| API Layer | Node.js + Fastify (JavaScript) | IMPLEMENTED |
| Audio Processing | FFmpeg (Node.js child process) | IMPLEMENTED |
| CDN | Direct file serving | DEV ONLY |

### Local Development Setup

**Prerequisites:** Docker Desktop must be running.

```bash
# Start PostgreSQL
npm run db:up

# Start the API server
npm run dev

# Access database shell (optional)
npm run db:shell

# Reset database (wipes all data)
npm run db:reset
```

### Production (Railway)

| Component | Technology | Status |
|-----------|------------|--------|
| Primary Database | PostgreSQL 15+ (Railway) | DEPLOYED |
| Object Storage | AWS S3 with SSE-KMS | P1 |
| CDN | CloudFront with signed URLs | P1 |
| Workflow Hardening | Circuit breakers, DLQ | P1 |

### MVP Decision: API-based Voice Conversion

For MVP, we use **Seed-VC via external Gradio server** instead of self-hosted GPU infrastructure:
- **Model:** Seed-VC provides high-quality zero-shot voice conversion
- **Deployment:** Requires separate Gradio server (configured via `SEED_VC_BASE_URL`)
- **Tradeoff:** Voice embeddings sent to Gradio API
- **Upgrade path:** Self-hosted Seed-VC or Kits AI for production scale

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
- All outputs contain metadata watermark with track_version_id (inaudible watermark TODO)

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

- **Preview (15-25s):** ~$0.07 (Suno music + Seed-VC voice conversion)
- **Full render (45-90s):** ~$0.25 (section-by-section API calls)

Cost breakdown per preview:
- Suno via Replicate (instrumental): ~$0.02-0.03
- ElevenLabs (guide vocal TTS): ~$0.01
- Seed-VC via Gradio (voice conversion): ~$0.02-0.03
- CPU (mix/master/watermark): ~$0.003

## Reroll Types

1. **Lyrics-only** (Cheap) - Regenerate lyrics, reuse instrumental
2. **Beat** (CPU + Music API) - New genre/style, regenerate instrumental
3. **Vocals** (Voice API) - New prosody/similarity settings via Replicate
4. **Section-only** (Cost-optimized) - Re-render single section only

## Automated Review Agents

The following review agents are configured to trigger automatically when editing relevant files:

| Agent | Trigger Files | Skill |
|-------|---------------|-------|
| **security-reviewer** | `src/services/auth*.js`, `src/services/billing*.js`, `src/services/admin*.js`, `src/routes/auth.js` | `/security-review` |
| **migration-reviewer** | `migrations/**/*.sql` | `/migration-review` |
| **provider-reviewer** | `src/providers/*.js` | `/provider-review` |
| **api-documenter** | `src/server.js`, `src/routes/*.js` | `/api-docs-review` |

### How It Works

1. **PostToolUse hooks** fire after Edit/Write operations
2. Hook checks file path against patterns
3. Outputs reminder to run appropriate review skill
4. User invokes `/security-review`, `/migration-review`, etc.

### Manual Invocation

- `/auto-review` - Run all relevant reviews for changed files
- `/security-review` - Security audit for auth/billing/admin code
- `/migration-review` - Database migration safety check
- `/provider-review` - External API integration quality review
- `/api-docs-review` - API documentation completeness check

### Agent Definitions

Located in `.claude/agents/`:
- `security-reviewer.md` - Security checklist and vulnerability patterns
- `migration-reviewer.md` - Migration safety and reversibility rules
- `provider-reviewer.md` - Integration robustness standards
- `api-documenter.md` - OpenAPI documentation standards

## Workflow Enforcement System

The following mechanisms enforce the workflow guidelines in this project:

### Enforcement Layers

| Layer | File | Purpose |
|-------|------|---------|
| **Global Rule** | `~/.claude/rules/porizo-workflow.md` | Injects workflow rules into every session |
| **Session Start Hook** | `porizo-session-start.mjs` | Displays lessons and active tasks on startup |
| **Pre-Edit Hook** | `porizo-pre-edit.mjs` | Warns if editing code without a plan |

### What Gets Enforced

1. **Plan Mode Default** - Pre-edit hook warns if no active plan in `tasks/todo.md`
2. **Lessons Review** - Session start hook displays recent lessons from `tasks/lessons.md`
3. **Task Awareness** - Session start shows active task to maintain context
4. **Self-Improvement Loop** - Global rule requires updating lessons.md after corrections

### Task Files

| File | Purpose |
|------|---------|
| `tasks/todo.md` | Current task, plan with checkboxes, progress tracking |
| `tasks/lessons.md` | Patterns learned from corrections (Trigger → Mistake → Rule) |

### How Enforcement Works

**On Session Start (startup/resume):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PORIZO WORKFLOW CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Recent Lessons:
   • [Date] Lesson title...
🎯 Active Task: Task description
⚡ Remember: Plan first, verify before done, update lessons after corrections
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**On Code Edit (without plan):**
```
⚠️ [Porizo Workflow] No active plan detected in tasks/todo.md

Before this edit, consider:
1. Write plan to tasks/todo.md with checkable items
2. Or confirm this is a trivial fix that doesn't need planning
```

### Modifying Enforcement

- Hooks source: `~/.claude/hooks/src/porizo-*.ts`
- Rebuild after changes: `cd ~/.claude/hooks && ./build.sh`
- Settings: `~/.claude/settings.json` (hooks section)

## Duplicate Function Rule

When you find 2+ implementations of the same concept with different behavior, do NOT classify them as "intentionally different" without evidence. Instead:

1. Trace what consumers expect (lookup keys, comparison targets, API contracts)
2. If only one form matches the contract, the other is a bug — consolidate
3. If both forms are genuinely needed, extract both into shared utils with distinct names that explain the semantic difference
4. "Preserving both because they're different" is never the answer — either they serve different purposes (name them differently) or one is wrong (fix it)
