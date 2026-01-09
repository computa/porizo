# Implementation Gaps Report

This document identifies the remaining work needed to make the Porizo platform feature-complete based on the spec, current backend implementation, and iOS app.

## Executive Summary

The platform has a solid foundation with:
- Core backend API with most endpoints implemented
- iOS app with functional create flow, voice enrollment, and playback
- Workflow runner for preview/full render pipelines
- Provider integrations (ElevenLabs, Replicate, Suno, Seed-VC)

Key gaps remain in:
- Production infrastructure (Temporal.io, PostgreSQL, S3/CloudFront)
- Sharing & device binding
- Subscription/billing system
- Poem generation feature
- Android app

---

## 1. Backend Gaps

### 1.1 Infrastructure (Not Yet Implemented)

| Component | Current State | Required for Production |
|-----------|---------------|-------------------------|
| **Database** | SQLite (sql.js) | PostgreSQL 15+ with proper migrations |
| **Object Storage** | Local filesystem (`storage/`) | AWS S3 with SSE-KMS encryption |
| **CDN** | Direct file serving | CloudFront with signed URLs |
| **Workflow Engine** | Simple polling job runner | Temporal.io for durability |
| **Message Queue** | None (synchronous jobs) | AWS SQS/SNS with FIFO queues |
| **Key Management** | None | AWS KMS for voice embedding encryption |

### 1.2 API Endpoints Missing or Incomplete

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /voice/reverify` | **Stub only** | Returns challenge but doesn't process response |
| `POST /share/create` | **Not implemented** | Share token creation |
| `GET /share/:token` | **Not implemented** | Web share player |
| `POST /share/claim` | **Partial** | Schema exists but no device binding logic |
| `GET /share/:token/hls/*` | **Exists** | Needs encryption keys for device-bound playback |
| `POST /poems` | **Not implemented** | Poem creation endpoint |
| `GET /poems` | **Not implemented** | List poems endpoint |
| `PUT /poems/:id` | **Not implemented** | Update poem endpoint |
| `DELETE /poems/:id` | **Not implemented** | Delete poem endpoint |
| `POST /subscriptions/*` | **Not implemented** | Subscription management |
| `POST /billing/purchase-credits` | **Not implemented** | Credit purchase |

### 1.3 Workflow Runner Gaps

The `src/workflows/runner.js` handles most steps but lacks:

1. **Durability**: Jobs lost on server restart (no state persistence beyond SQLite)
2. **Circuit breakers**: No provider outage handling
3. **Dead letter queues**: Failed jobs stay in DB but no alerting
4. **Concurrent job limits**: Unbounded job parallelism
5. **Step rollback**: Partial failures leave inconsistent state

### 1.4 Provider Integration Gaps

| Provider | Status | Gap |
|----------|--------|-----|
| **ElevenLabs** | Implemented | No fallback to Soundverse |
| **Suno** | Implemented | 30s limit, need section-by-section for full 60-90s |
| **Replicate (RVC)** | Implemented | - |
| **Seed-VC** | Implemented | Requires Gradio endpoint running separately |
| **Demucs** | Implemented | Via Replicate API |
| **Soundverse** | **Not implemented** | Listed as music fallback |

### 1.5 Security Gaps

1. **Voice embedding encryption**: Currently stored unencrypted
2. **Watermarking**: `embedWatermark()` exists but may not have inaudible audio watermark
3. **Rate limiting by risk level**: Partially implemented (blocked/high checks exist)
4. **Impersonation detection**: Moderation checks "sound like [artist]" but pattern matching is basic
5. **Device binding**: `bound_device_id` fields exist but not enforced
6. **Signed URLs**: CloudFront not configured, direct file access

---

## 2. iOS App Gaps

### 2.1 Features Not Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| **Poem Creation Flow** | **TODO** | CreateFlowView has "Coming Soon" badge |
| **Poem Display/Edit** | **Stub** | PoemsTabView uses sample data |
| **Subscription Upgrade** | **TODO** | Button exists, no action |
| **Share to Recipient** | **Not implemented** | No share UI or device claim |
| **Explore Templates** | **Partial** | UI exists but "TODO: Launch create flow with template" |
| **Push Notifications** | **Not implemented** | No notification handling |
| **Offline Support** | **Not implemented** | No caching or offline mode |
| **Widget/App Clip** | **Not implemented** | Spec mentions but not in codebase |

### 2.2 Authentication

- Currently uses device-generated UUID (`ios_xxx`) stored in Keychain
- No OAuth/Firebase Auth integration
- TODO comment: "replace with bearer auth after OAuth integration"

### 2.3 Payment/Billing

- No StoreKit integration
- Entitlements fetched but no purchase flow
- Credit balance display exists but no way to add credits

### 2.4 Share Flow

The share/claim flow is not implemented:
- No way to generate share link from completed track
- No web player for recipients
- No device binding/claim flow

### 2.5 Error Handling & Edge Cases

- Most errors show generic alerts
- No specific handling for moderation blocks (UI exists but flow incomplete)
- Limited offline error states

---

## 3. Missing Platform Components

### 3.1 Android App

- **Not started** - spec mentions Android but no code exists

### 3.2 Web Player (Recipient)

- **Not implemented** - needed for share links
- Should support:
  - HLS streaming with short-lived URLs
  - Device claim flow
  - No download (stream only)

### 3.3 Admin Dashboard

- **Not implemented** - for content moderation review
- Needed for manual moderation queue

---

## 4. Testing Gaps

### 4.1 Current Test Coverage

Tests exist for:
- Enrollment QC
- Lyrics generation
- Moderation
- Music providers
- Memory questions
- Share flow (mocked)

### 4.2 Missing Tests

- E2E workflow tests (full render pipeline)
- Voice conversion with real providers
- Subscription/billing flows
- Device binding
- Performance/load tests

---

## 5. Priority Recommendations

### Phase 1: Core Completion (Ship MVP)
1. ✅ Voice enrollment (done)
2. ✅ Song creation with lyrics (done)
3. ✅ Preview rendering (done)
4. ⚠️ Full render (implemented but untested with 60-90s)
5. ❌ Share link generation and web player

### Phase 2: Monetization
1. Subscription tier system
2. StoreKit integration (iOS)
3. Credit purchase flow
4. Billing holds for full renders

### Phase 3: Scale & Security
1. Migrate to PostgreSQL
2. Implement S3 + CloudFront
3. Add Temporal.io workflows
4. Voice embedding encryption
5. Proper watermarking

### Phase 4: Feature Parity
1. Poem generation feature
2. Android app
3. Push notifications
4. Explore templates

---

## 6. Technical Debt

1. **Server.js size**: 2492 lines, needs modularization into route handlers
2. **Hardcoded URLs**: `localhost:3000` appears in iOS code, needs env config
3. **Mock data**: MySongsView uses `#if DEBUG` mock data
4. **Error codes**: Some errors use generic codes vs spec's E1xx/R2xx/B3xx/S5xx scheme
5. **Job cleanup**: `startCleanupJob` exists but retention policies not enforced

---

## 7. Database Schema Gaps

Based on `migrations/` and spec:

| Table | Exists | Gap |
|-------|--------|-----|
| users | ✅ | - |
| voice_profiles | ✅ | - |
| enrollment_sessions | ✅ | - |
| tracks | ✅ | - |
| track_versions | ✅ | - |
| jobs | ✅ | - |
| entitlements | ✅ | Subscription fields need expansion |
| billing_holds | ✅ | - |
| share_tokens | ✅ | - |
| share_access_log | ✅ | - |
| audit_logs | ✅ | - |
| rate_limits | ✅ | - |
| **poems** | ❌ | Not created |
| **subscriptions** | ❌ | Not created |
| **purchase_receipts** | ❌ | Not created |

---

*Generated: 2026-01-08*
