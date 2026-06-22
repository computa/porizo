# Feature Audit Summary

**Generated:** 2026-06-22
**Total features:** 178

## By Domain

| Domain | Count |
|---|---|
| Auth | 22 |
| SongCreation | 33 |
| VoiceEnrollment | 18 |
| Billing | 18 |
| Sharing | 25 |
| PoemsBlogArtwork | 20 |
| AdminAnalytics | 19 |
| WebApp | 23 |

## By Status

| Status | Count |
|---|---|
| Implemented | 153 |
| Partial | 24 |
| Broken | 0 |
| Unknown | 1 |

## By Priority

| Priority | Count | Meaning |
|---|---|---|
| P0 | 16 | Security exploit / data loss / revenue loss / core broken |
| P1 | 29 | Serious robustness / compliance / race condition / silent failure |
| P2 | 33 | Degraded UX / missing retry-fallback / cost inefficiency |
| P3 | 100 | Polish / minor edge case / implemented with no real gaps |

## Top P0 Issues

- [A19] Account Deletion (GDPR Soft-Delete + Cascade) — - Soft-delete only. `users.deleted_at` is set, but PII fields (`name`, `email` in contacts, `phone` in contacts) are not
- [B11] Preview Render Workflow (preview_render) — - No transaction-level lock on `render_preview` start: the ALREADY_RENDERING check (`findActiveJobForVersion`) and the j
- [B12] Full Render Workflow (full_render) — - `billing_holds` table was dropped (migration 095) — the full render has NO credit reservation/hold mechanism; if a use
- [C2] Chunk upload (debug route) — - No maximum chunk size validation on the debug route (unbounded `Buffer.concat`) ; - Duration calculation silently retu
- [D2] Google Play Receipt Validation — 1. Google Play one-time purchases (consumables) must be acknowledged within 3 days or Google auto-refunds. There is no a
- [D3] Apple Server-to-Server Notifications v2 (ASSN / Webhook) — 1. Webhook endpoint authentication: the handler verifies the JWS signature of the _payload_ (Apple-signed content), but
- [D6] Server-Authoritative Credit Spend (Song Deduction) — 1. If `spendSong()` succeeds but the subsequent render job creation fails (e.g., DB error), the song is spent but no ren
- [E2] Device-Binding / First-to-Claim — - `bound_user_id` bind is soft: `COALESCE(?, bound_user_id)` means if `claimUserId` is NULL the original user_id is pres
- [G4] User Management (Admin) — - `PUT .../entitlements` is any-admin, not superadmin-gated. Arbitrary credit balance manipulation by any admin account
- [G5] Admin Gift Operations (Gift Order Management) — - `AdminGiftOpsService.listOrders` builds a dynamic `WHERE 1=1` SQL filter from a `filters` parameter. If filter key nam
- [G10] Job Queue Management (Admin) — - Job retry and DLQ reprocess are any-admin, not superadmin-gated. A retry on a billing or voice-conversion job can trig
- [G12] Feature Flags (Admin) — - No superadmin restriction on flag writes. Feature flags control billing enforcement (`gift_prepay_enforced`), voice fe
- [G16] GDPR Audit Service — - No user-facing API endpoint for data export is confirmed in the surveyed files. `gdpr-audit-service.js` logs that a re
- [H11] Audio Streaming Endpoint — Preview (MP3 / M4A) — - Preview routes have no auth at all — any actor who guesses or obtains a `trackVersionId` UUID can stream the preview a
- [H12] Audio Streaming Endpoint — Full Render (M4A) — - Share-token bypass on full audio: `status != 'revoked'` check does not verify `bound_device_id` matches the requester
- [H19] Debug Page (Song Pipeline Debugger) — - CRITICAL: `debug.js` sends `x-user-id: debug_<random>` header — if `ENABLE_DEBUG_ROUTES` is ever set to `true` in prod

## Top P1 Issues

- [A2] Email/Password Login — - Timing oracle: `bcrypt.compare` is called even when no `password_hash` row exists (good), but error message is uniform
- [A8] Phone OTP — Register New Account — - Race condition: between `verify` and `register`, another request could register the same phone (e.g., attacker replayi
- [A12] Account Lockout — - Social and phone login do not hit the lockout counter. An attacker who can control the phone OTP flow (e.g., SIM swap)
- [A14] Email Verification (Send + Resend + Verify) — - `verify-email` is unauthenticated — the token IS the credential, which is correct. However there is no binding of the
- [A15] Session Management (List + Revoke) — - `last_active_at` on sessions is set at creation but never updated on subsequent authenticated requests — the session l
- [A17] Apple Identity Linking to Existing Account — - If the Apple ID is already linked to a DIFFERENT account, the error response reveals that the Apple ID is in use — a m
- [A18] User Profile (Get / Update / Skip-Completion / Username Check) — - `GET /users/username/available` is unauthenticated — an unauthenticated attacker can enumerate all taken usernames in
- [A22] Admin Authentication (Separate Surface) — - Admin sessions in `admin_sessions` do not have a `max_session_duration_hours` enforcement in code — sessions may persi
- [B3] Story → Track Conversion — - `params_hash` computed at version creation; if story context changes after this call there is no re-hash path ; - No c
- [B15] Guide Vocal Generation (ElevenLabs TTS) — - ElevenLabs is the sole TTS provider; no fallback TTS if ElevenLabs is unavailable (circuit breaker parks the job but c
- [B16] Voice Conversion (Seed-VC / Gradio) — - `similarity_strength` param mentioned in CLAUDE.md retry strategy (reduce on retry) is NOT implemented in current `see
- [B22] Render Idempotency & Resumability (params_hash memoization) — - `voice_convert` and `voice_convert_sections` rely on `fs.existsSync` at the handler level — if local files are wiped (
- [B26] Suno Callback Handler — - Callback does not drive state transitions; persona creation latency is bounded by polling interval, not push notificat
- [B29] Circuit Breaker — - Circuit breaker state is in-memory only (class instance per process); a Node.js restart resets all circuit state, pote
- [C11] Impersonation detection & risk gating — - Impersonation detection operates on text inputs (prompts, lyrics) — no confirmed audio-layer check that enrollment rec
- [D1] Apple Receipt / JWS Validation — 1. Certificate chain validation is described as "basic" — root anchor is NOT pinned to Apple's known root CA. A compromi
- [D8] Pay-Per-Song / Gift Bundle (gift_bundle_1) — 1. Reconciliation path (`apple_consumable_reconcile`) runs inside the same HTTP request as the duplicate-receipt detecti
- [D17] Webhook Notification Idempotency Store — 1. No DLQ replay mechanism — entries accumulate with no automated retry or admin UI to trigger replay. Manual SQL requir
- [E6] SMS Gift Delivery (Twilio) — - No confirmed `sendGiftSms()` function in `sms-service.js` or `gift-delivery-ops.js` — only OTP delivery is clearly imp
- [E7] Email Gift Delivery (Resend) — - No confirmed `sendGiftEmail()` function call site in `email-service.js` specific to gift delivery — only normalization
- [E16] Recipient Contact Storage — - `recipient_contact` as a standalone table (referenced in the audit prompt) does NOT exist — recipient contact is store
- [E20] Rate Limiting on Share Endpoints — - No per-user or per-IP rate limit on `POST /tracks/:id/share` — a user can create thousands of share tokens per minute
- [G7] Email Service (Admin / Campaign Side) — - No rate limiting visible on `sendAdminSecurityAlertEmail` — could spam on rapid repeated password resets. ; - `sendGif
- [G11] Content Moderation Queue (Admin) — - No superadmin restriction on moderation actions — any admin can approve content that was AI-flagged. ; - No audit trai
- [G13] Security & Audit Logs (Admin) — - `audit_logs` entries are insert-only by convention (comment: "do NOT rewrite historical entries") but no DB-level cons
- [G14] Admin Story Sessions (Admin) — - Story sessions contain personal narrative content (occasion details, recipient names, messages) — no PII redaction not
- [G18] MCP Server (External Agent Integration) — - No authentication visible on the MCP endpoint. If the `/mcp` route is publicly accessible without any token check, any
- [G19] Events Service — - `Math.min(limit, 200)` cap prevents unlimited reads but 200 events per call could still return significant PII-contain
- [H6] Legal Pages (Privacy Policy / Terms of Service) — - Content not inspected; if policies reference "your voice" or voice cloning they may conflict with the pivot away from
