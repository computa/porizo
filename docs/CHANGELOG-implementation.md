# Implementation Changelog

This document tracks all deviations from the original specification (`specs/personalized-song-platform-spec.md`) with rationale for each decision.

**Version:** 1.0.0
**Created:** 2026-01-09
**Last Updated:** 2026-01-09

---

## Summary

The Porizo MVP prioritizes rapid iteration and cost optimization over production-grade infrastructure. Key architectural decisions enable a functional product while deferring scaling concerns to post-MVP phases.

---

## Infrastructure Deviations

### 1. Database: SQLite Instead of PostgreSQL

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| PostgreSQL 15+ with JSONB | SQLite via sql.js (in-memory) | Zero setup friction for development; migrations are compatible |

**Impact:** No connection pooling, limited concurrent access, data lost on restart without persistence layer.

**Migration Path:** Phase 1 of gaps plan covers PostgreSQL migration with abstraction layer.

---

### 2. Storage: Local Filesystem Instead of S3

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| AWS S3 with SSE-KMS encryption | Local `storage/` directory | Eliminates AWS dependency for local development |

**Impact:** No encryption at rest, no CDN, no signed URLs, manual cleanup needed.

**Migration Path:** Phase 2 covers S3 + CloudFront setup with localstack for testing.

---

### 3. Workflow: Polling Runner Instead of Temporal.io

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Temporal.io for workflow orchestration | DB-backed polling runner (`src/workflows/runner.js`) | $100/month cost savings; simpler debugging |

**Impact:** Jobs lost on restart, no built-in circuit breakers, no dead letter queue.

**Migration Path:** Phase 3 adds circuit breakers, DLQ, and durability. Temporal deferred to >1000 renders/day volume.

**Decision Date:** 2026-01-09
**Decision Maker:** User requested Temporal skip for MVP

---

### 4. CDN: Direct File Serving Instead of CloudFront

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| CloudFront with signed URLs | Express static file serving | No AWS infrastructure needed for MVP |

**Impact:** No edge caching, no geographic distribution, no URL signing.

**Migration Path:** Bundled with S3 migration in Phase 2.

---

## Provider Deviations

### 5. Music Generation: Suno Instead of ElevenLabs

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| ElevenLabs API (primary) | Suno via Replicate API | Suno provides better music quality; ElevenLabs used only for TTS |

**Impact:** Different API patterns, 30-second limit per generation.

**Note:** Spec listed ElevenLabs for music but implementation uses Suno for instrumentals and ElevenLabs for guide vocals only.

---

### 6. Voice Conversion: Seed-VC Instead of Replicate RVC

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Replicate API (hosted RVC) | Seed-VC via external Gradio server | Better voice quality with Seed-VC model |

**Impact:** Requires separate Gradio server running, different API interface.

**Configuration:** `SEED_VC_BASE_URL` environment variable points to Gradio endpoint.

---

### 7. Soundverse Fallback: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Soundverse as music fallback | Not implemented | MVP scope reduction; single provider sufficient |

**Impact:** No automatic failover if Suno/Replicate unavailable.

**Migration Path:** Phase 3 Task 3.5 covers Soundverse fallback implementation.

---

## API Deviations

### 8. JavaScript Instead of TypeScript

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Node.js + Express/Fastify (TypeScript) | Node.js + Fastify (JavaScript) | Faster iteration; type safety deferred |

**Impact:** No compile-time type checking, relies on runtime validation.

**Note:** JSON schema validation with Fastify provides runtime type safety.

---

### 9. Voice Reverification: Stub Only

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Full re-verification flow | Stub returning challenge | Security feature deferred for MVP |

**Endpoint:** `POST /voice/reverify`

**Current Behavior:** Returns challenge phrase but doesn't process verification response.

**Migration Path:** Complete implementation needed before production launch.

---

### 10. Poems API: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Full CRUD for poems | Not implemented | Feature deprioritized for song-first MVP |

**Endpoints Missing:**
- `POST /poems`
- `GET /poems`
- `GET /poems/:id`
- `PUT /poems/:id`
- `DELETE /poems/:id`

**Migration Path:** Phase 5 covers full poems feature.

---

### 11. Billing/Purchase API: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Credit purchase flow | Not implemented | Monetization deferred to post-MVP |

**Endpoints Missing:**
- `POST /billing/purchase-credits`

**Migration Path:** Phase 6 covers StoreKit integration and billing.

---

## Security Deviations

### 12. Voice Embedding Encryption: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| User-specific KMS key encryption | Embeddings stored unencrypted | Compliance feature deferred |

**Impact:** Voice embeddings readable if storage compromised.

**Migration Path:** Phase 9 covers encryption implementation.

---

### 13. Device Binding: Schema Only

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Full device binding enforcement | Database fields exist, logic not enforced | Share security feature deferred |

**Current State:** `share_tokens` table has `bound_device_id` but claim endpoint doesn't enforce binding.

**Migration Path:** Phase 4 covers device binding enforcement.

---

### 14. Audio Watermarking: Metadata Only

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Inaudible audio watermark | Metadata embedding only | Proper watermarking requires specialized tooling |

**Current Implementation:** `embedWatermark()` adds metadata but not inaudible audio watermark.

**Migration Path:** Phase 9 covers proper watermarking.

---

## iOS App Deviations

### 15. AVAudioPlayer Instead of AVPlayer

| Initial | Current | Rationale |
|---------|---------|-----------|
| AVPlayer for streaming | AVAudioPlayer with download-first | Better reliability on iOS devices |

**Change Date:** 2026-01-09 (commit `a49cb21`)

**Behavior:** Audio is downloaded fully before playback starts rather than streaming.

---

### 16. Push Notifications: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Push notifications for render completion | Not implemented | Requires APNs setup |

**Migration Path:** Phase 8 polish tasks.

---

### 17. Offline Support: Not Implemented

| Spec | Implementation | Rationale |
|------|----------------|-----------|
| Offline caching | Not implemented | Network-dependent MVP |

**Impact:** App requires connectivity for all operations.

---

## Database Schema Deviations

### 18. Missing Tables

| Table | Spec Status | Implementation | Reason |
|-------|-------------|----------------|--------|
| `poems` | Required | Not created | Feature not implemented |
| `subscriptions` | Required | Not created | Billing not implemented |
| `purchase_receipts` | Required | Not created | Billing not implemented |

---

## Intentional Simplifications

These are deliberate scope reductions for MVP:

1. **Single voice mode only** - No ensemble/choir mode
2. **English only** - No internationalization
3. **iOS only** - No Android app
4. **No admin dashboard** - Manual database queries for moderation
5. **No analytics** - Basic logging only
6. **No A/B testing** - Single code path

---

## Upgrade Priorities

Based on gaps analysis, recommended upgrade sequence:

| Priority | Component | Phase | Blocker For |
|----------|-----------|-------|-------------|
| P0 | PostgreSQL | 1 | Production deployment |
| P0 | S3 + CloudFront | 2 | Production deployment |
| P0 | Workflow Hardening | 3 | Reliability |
| P1 | Device Binding | 4 | Share security |
| P1 | Billing | 6 | Monetization |
| P2 | Poems | 5 | Feature completeness |
| P2 | Admin Dashboard | 7 | Operations |
| P3 | Voice Encryption | 9 | Compliance |

---

## Changelog

### 2026-01-09
- Initial document created
- Documented 18 deviations from spec
- Established upgrade priorities

---

*This document should be updated whenever implementation diverges from spec.*
