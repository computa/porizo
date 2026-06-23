# Per-Feature Post-Fix Test Coverage Map (2026-06-23)

Built after the post-fix full-suite re-run (**2452 tests, 2426 pass, 16 fail, 10 skip**).
Each of the 178 features is mapped to the test file(s) that exercise it and its result.

**Methodology & honesty note:** mapping is by matching each feature's documented
endpoints/service files against actual test-file contents, cross-referenced with the
post-fix run's failing files, plus manually-verified corrections. Automated mapping has
known false negatives, so a "candidate gap" label means *no dedicated test was
auto-identified* — it is a flag for manual confirmation, **not** an assertion that the
feature is untested. Genuinely confirmed gaps (e.g. share revocation, viral-loop events,
sitemap/robots) are real robustness findings.

## Summary

| Result | Count | Meaning |
| --- | --- | --- |
| PASS | 131 | Covered by >=1 test file that passed in the post-fix run |
| INFRA-GATED | 4 | Has tests, but they need a live LLM / provider / signing key (not a code defect) |
| CANDIDATE GAP | 43 | No dedicated test auto-identified — verify manually (robustness signal) |


## Auth

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| A1 | Email/Password Signup | PASS | admin-analytics.test.js, critical-fixes.test.js, admin-attribution.test.js, auth-api.test.js |
| A2 | Email/Password Login | PASS | admin-analytics.test.js, auth-api.test.js, auth-schema.test.js, auth-identity-model.test.js |
| A3 | Sign In with Apple (SIWA) | CANDIDATE GAP | — |
| A4 | Google Social Login | CANDIDATE GAP | — |
| A5 | Facebook Social Login | CANDIDATE GAP | — |
| A6 | Phone OTP — Send Code | PASS | auth-identity-model.test.js |
| A7 | Phone OTP — Verify & Login | PASS | auth-identity-model.test.js |
| A8 | Phone OTP — Register New Account | PASS | auth-identity-model.test.js, critical-fixes.test.js, admin-attribution.test.js |
| A9 | Anonymous Device Token | PASS | gifts.test.js, admin-billing-sales.test.js |
| A10 | JWT Access Token Issuance & Verification | PASS | auth-service.test.js |
| A11 | Refresh Token Rotation (Token Family) | PASS | auth-api.test.js, auth-service.test.js, auth-schema.test.js |
| A12 | Account Lockout | PASS | database/postgres-core-schema-repair.test.js |
| A13 | Forgot Password / Reset Password | PASS | auth-schema.test.js, email-service.test.js |
| A14 | Email Verification (Send + Resend + Verify) | PASS | auth-api.test.js |
| A15 | Session Management (List + Revoke) | PASS | admin-attribution.test.js, admin-analytics.test.js, auth-api.test.js |
| A16 | Phone Number Linking to Existing Account | PASS | auth-identity-model.test.js, auth-api.test.js |
| A17 | Apple Identity Linking to Existing Account | PASS | auth-api.test.js, auth-identity-model.test.js |
| A18 | User Profile (Get / Update / Skip-Completion / Username Check) | PASS | auth-api.test.js, auth-identity-model.test.js, admin-attribution.test.js, admin-billing-sales.test.js |
| A19 | Account Deletion (GDPR Soft-Delete + Cascade) | CANDIDATE GAP | — |
| A20 | Onboarding Questionnaire & Song Suggestion | PASS | lyrics.test.js, onboarding-routes.test.js, admin-gift-ops-routes.test.js |
| A21 | OAuth 2.0 / MCP Server Discovery (Well-Known) | CANDIDATE GAP | — |
| A22 | Admin Authentication (Separate Surface) | PASS | admin-auth-default-seed.test.js |

## VoiceEnrollment

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| C1 | Enrollment session start | PASS | admin-auth-default-seed.test.js, rate-limit.test.js |
| C2 | Chunk upload (debug route) | PASS | audio-quality.test.js, services/enrollment-session-service.test.js |
| C3 | Audio preprocessing pipeline | CANDIDATE GAP | — |
| C4 | QC processing (VAD / clipping / SNR analysis) | PASS | audio-quality.test.js |
| C5 | Enrollment complete & quality gate | PASS | voice-enrollment.test.js, enrollment-qc.test.js, audio-quality.test.js |
| C6 | Voice profile status lifecycle | PASS | suno-voice-persona-service.test.js, admin-billing-sales.test.js, auth-identity-model.test.js, critical-fixes.test.js, admin-attribution.test.js, routes/internal-suno-callback.test.js, render-endpoints.test.js, autoresearch-story.test.js |
| C7 | Voice embedding extraction (Replicate / ECAPA-TDNN) | PASS | enrollment-qc.test.js, critical-fixes.test.js |
| C8 | Quality scoring and tier assignment | PASS | audio-quality.test.js, services/voice-params-flow.test.js |
| C9 | Voice provider profile creation (Suno persona) | PASS | suno-voice-persona-service.test.js, critical-fixes.test.js, admin-attribution.test.js, render-endpoints.test.js, app-link-service.test.js, admin-analytics.test.js, suno-persona-provider.test.js |
| C10 | ElevenLabs voice clone creation | PASS | enrollment-qc.test.js, share-embed.test.js, workflows/voice-conversion-routing.test.js |
| C11 | Impersonation detection & risk gating | CANDIDATE GAP | — |
| C12 | Re-enrollment & rate limits | INFRA-GATED | mvp-flow.test.js, rate-limit.test.js, suno-voice-persona-service.test.js, receiver-session.test.js, jobs/artwork-job.test.js |
| C13 | Voice profile deletion | PASS | workflows/voice-conversion-routing.test.js |
| C14 | Voice profile read / status endpoint | PASS | admin-analytics.test.js, critical-fixes.test.js, database/postgres-core-schema-repair.test.js, suno-voice-persona-service.test.js |
| C15 | Memory questions endpoint | CANDIDATE GAP | — |
| C16 | Seed-VC voice conversion (at render time, using enrolled voice) | PASS | critical-fixes.test.js, services/voice-params-flow.test.js |
| C17 | Whisper transcription provider | PASS | stt-config.test.js |
| C18 | Consent scope management (granted_identities) | PASS | debug-upload.test.js, services/enrollment-session-service.test.js, database/postgres-migration.test.js, critical-fixes.test.js, subscription-tombstone.test.js |

## SongCreation

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| B1 | Create Track (Direct / Legacy Path) | INFRA-GATED | routes/story-lyrics-contract.test.js, admin-gift-ops-routes.test.js, recipient-contact.test.js, mvp-flow.test.js, auth-identity-model.test.js, database/postgres-core-schema-repair.test.js, lyrics.test.js |
| B2 | Story Interview / Conversation (AI-Guided Path) | PASS | autoresearch-story.test.js, routes/story-lyrics-contract.test.js, admin-gift-ops-routes.test.js, lyrics.test.js, blog-autofill-service.test.js |
| B3 | Story → Track Conversion | PASS | gifts.test.js, database/postgres-core-schema-repair.test.js, admin-gift-ops-routes.test.js, recipient-contact.test.js, moderation.test.js |
| B4 | AI Memory / Wizard Follow-up Questions | PASS | memory-questions.test.js, moderation.test.js |
| B5 | Song Readiness Pre-flight Gate | PASS | lyrics.test.js, blog-cms-routes.test.js |
| B6 | Lyrics Generation | PASS | analytics-event.test.js, autoresearch-story.test.js, lyrics.test.js, jobs/artwork-job.test.js, critical-fixes.test.js |
| B7 | Lyrics Policy Sanitization | PASS | services/lyrics-policy-sanitizer.test.js |
| B8 | Lyrics Manual Edit & Approval | PASS | dlq-retry-endpoint.test.js, critical-fixes.test.js, story-revise-contract.test.js, ready-step-s3-ordering.test.js |
| B9 | Music Plan Generation | PASS | admin-marketing-routes.test.js, dlq-retry-endpoint.test.js, blog-editorial-review-service.test.js |
| B10 | Content Moderation Gate (Workflow Step) | PASS | database/postgres-core-schema-repair.test.js |
| B11 | Preview Render Workflow (preview_render) | CANDIDATE GAP | — |
| B12 | Full Render Workflow (full_render) | PASS | admin-analytics.test.js |
| B13 | Suno Instrumental Generation | PASS | database/postgres-core-schema-repair.test.js |
| B14 | Suno Voice Persona Creation & Enrollment | PASS | suno-voice-persona-service.test.js, admin-analytics.test.js, routes/internal-suno-callback.test.js, render-endpoints.test.js, admin-billing-sales.test.js |
| B15 | Guide Vocal Generation (ElevenLabs TTS) | PASS | credit-logging.test.js, ready-step-s3-ordering.test.js, workflows/render-contract.test.js, admin-gift-ops-routes.test.js |
| B16 | Voice Conversion (Seed-VC / Gradio) | PASS | database/postgres-core-schema-repair.test.js, dlq-retry-endpoint.test.js, step-classification.test.js, services/voice-params-flow.test.js |
| B17 | Stem Separation (Demucs via Replicate) | PASS | step-classification.test.js |
| B18 | Whisper Transcription | PASS | ready-step-s3-ordering.test.js |
| B19 | Mix Step | PASS | audio-pipeline.test.js |
| B20 | Watermark Step | PASS | audio-pipeline.test.js |
| B21 | Artwork Generation (Parallel / Barrier) | INFRA-GATED | jobs/artwork-job.test.js, workflows/artwork-barrier.test.js, mvp-flow.test.js |
| B22 | Render Idempotency & Resumability (params_hash memoization) | PASS | autoresearch-story.test.js, database/postgres-core-schema-repair.test.js, audio-pipeline.test.js, workflows/render-contract.test.js, ready-step-s3-ordering.test.js |
| B23 | Render Retry (Manual Retry Endpoint) | PASS | admin-gift-ops-routes.test.js |
| B24 | Render Cancel | PASS | admin-gift-ops-routes.test.js, autoresearch-story.test.js |
| B25 | Reroll (Lyrics / Beat / Vocals / Section-only) | PASS | admin-gift-ops-routes.test.js |
| B26 | Suno Callback Handler | PASS | routes/internal-suno-callback.test.js |
| B27 | Job Status Polling | PASS | admin-analytics.test.js, dlq-retry-endpoint.test.js, critical-fixes.test.js, database/postgres-core-schema-repair.test.js |
| B28 | Dead-Letter Queue (DLQ) | PASS | database/postgres-core-schema-repair.test.js |
| B29 | Circuit Breaker | PASS | workflows/circuit-breaker.test.js, admin-login-hardening.test.js |
| B30 | LLM Provider (generateText / Fallback Chain) | PASS | llm-provider.test.js |
| B31 | Style Registry & Provider-Style Routing | PASS | lyrics.test.js, provider-style-routing.test.js, blog-autofill-service.test.js, admin-attribution.test.js |
| B32 | Share Token Creation / Play URL | PASS | share-service.test.js, database/postgres-migration.test.js |
| B33 | Poem Generation (Story-Based) | PASS | autoresearch-story.test.js, gifts.test.js |

## Billing

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| D1 | Apple Receipt / JWS Validation | PASS | admin-gift-ops-routes.test.js, admin-billing-sales.test.js |
| D2 | Google Play Receipt Validation | PASS | google-receipt-validator.test.js |
| D3 | Apple Server-to-Server Notifications v2 (ASSN / Webhook) | PASS | apple-webhook-handler.test.js |
| D4 | Subscription Lifecycle (State Machine) | PASS | billing-api.test.js, admin-attribution.test.js, apple-receipt-validator.test.js |
| D5 | Entitlement Credits Balance (Songs + Poems) | PASS | admin-attribution.test.js, subscription-manager.test.js, poems.test.js, admin-billing-sales.test.js |
| D6 | Server-Authoritative Credit Spend (Song Deduction) | PASS | admin-billing-sales.test.js |
| D7 | Billing Hold Create / Capture / Release | CANDIDATE GAP | — |
| D8 | Pay-Per-Song / Gift Bundle (gift_bundle_1) | PASS | database/postgres-core-schema-repair.test.js |
| D9 | Gift Funding of Sender's Own Songs | CANDIDATE GAP | — |
| D10 | Restore Purchases | PASS | admin-gift-ops-routes.test.js, admin-billing-sales.test.js |
| D11 | Subscription Status / Entitlements Query | PASS | admin-attribution.test.js, poems.test.js |
| D12 | Trial Entitlement | PASS | admin-analytics.test.js, billing-api.test.js, subscription-manager.test.js |
| D13 | Plan / Tier Configuration | PASS | plan-config.test.js, billing-api.test.js |
| D14 | Preview / Render Rate Limits | PASS | auth-api.test.js, share-embed.test.js, admin-attribution.test.js |
| D15 | Admin Complimentary Grants / Upgrades | PASS | jobs/artwork-job.test.js, database/postgres-core-schema-repair.test.js |
| D16 | Feature Flags (Billing / Paywall) | PASS | critical-fixes.test.js, billing-api.test.js, share-embed.test.js |
| D17 | Webhook Notification Idempotency Store | PASS | admin-attribution.test.js, apple-webhook-handler.test.js, admin-analytics.test.js, database/postgres-core-schema-repair.test.js, gifts.test.js, critical-fixes.test.js |
| D18 | Song Transaction Ledger | PASS | database/postgres-core-schema-repair.test.js |

## Sharing

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| E1 | Create Share Link (Lifetime Token) | PASS | database/postgres-migration.test.js, receiver-session.test.js |
| E2 | Device-Binding / First-to-Claim | PASS | share-flow.test.js |
| E3 | Receiver Session / Claim Flow | INFRA-GATED | receiver-attribution.test.js, mvp-flow.test.js, receiver-session.test.js |
| E4 | Recipient Deep-Link / App-Wall Handoff | PASS | app-link-service.test.js |
| E5 | ReceiverHandoffId Persistence (download → login → claim lifecycle) | PASS | app-link-service.test.js |
| E6 | SMS Gift Delivery (Twilio) | PASS | gifts.test.js, admin-gift-ops-routes.test.js, database/postgres-core-schema-repair.test.js |
| E7 | Email Gift Delivery (Resend) | PASS | database/postgres-core-schema-repair.test.js |
| E8 | Push Notifications — Transactional (APNs) | PASS | push-notification.test.js |
| E9 | Push Notifications — Marketing (OneSignal) | PASS | admin-marketing-routes.test.js, onesignal-service.test.js |
| E10 | Share Access Logging | PASS | apple-webhook-handler.test.js, database/postgres-migration.test.js, gifts.test.js, share-flow.test.js |
| E11 | Share Follow-Ups | PASS | share-followup-service.test.js, share-followups-job.test.js, jobs/cold-email-daily.test.js |
| E12 | Gift Funding (Wallet, Reservations, Billing) | PASS | admin-billing-sales.test.js, database/postgres-core-schema-repair.test.js |
| E13 | OG Image / Meta for Share Page | PASS | song-og-generator.test.js |
| E14 | Viral Loop / Events Tracking | CANDIDATE GAP | — |
| E15 | App-Wall / Browser Detection | PASS | apple-webhook-handler.test.js |
| E16 | Recipient Contact Storage | PASS | admin-gift-ops-routes.test.js, auth-api.test.js, admin-analytics.test.js, auth-identity-model.test.js |
| E17 | Gift Ops Monitoring | CANDIDATE GAP | — |
| E18 | Stream Key / Audio Access | PASS | receiver-session.test.js, database/postgres-core-schema-repair.test.js, auth-race-condition.test.js, gifts.test.js |
| E19 | Share Token Revocation / Expiry | CANDIDATE GAP | — |
| E20 | Rate Limiting on Share Endpoints | PASS | auth-api.test.js, admin-analytics.test.js, gifts.test.js, poems.test.js |
| E21 | Signed-Out Claim Flow | PASS | admin-analytics.test.js, share-flow.test.js |
| E22 | Gift Delivery Outbox / Retry Infrastructure | PASS | database/postgres-core-schema-repair.test.js, gifts.test.js, gift-webhooks.test.js, apple-ads-attribution.test.js, admin-gift-ops-routes.test.js, critical-fixes.test.js |
| E23 | Gift Order Scheduling | PASS | admin-gift-ops-routes.test.js, gifts.test.js, share-flow.test.js |
| E24 | Poem Share Binding | PASS | gifts.test.js, database/postgres-migration.test.js |
| E25 | Audiogram Download | CANDIDATE GAP | — |

## PoemsBlogArtwork

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| F1 | Poem Generation (LLM) | PASS | poem-generator.test.js, poems.test.js |
| F2 | Poem CRUD & Library | PASS | poems.test.js |
| F3 | Poem Share Token & Web Viewer | PASS | share-embed.test.js |
| F4 | Poem OG Image (Social Share Card) | CANDIDATE GAP | — |
| F5 | Blog Post Generation (Autofill) | PASS | blog-autofill-service.test.js |
| F6 | Blog Deterministic SEO/GEO/AEO Review Gate | PASS | blog-review-service.test.js |
| F7 | Blog LLM Editorial Review | PASS | blog-editorial-review-service.test.js |
| F8 | Blog Format & Repair | PASS | blog-format-service.test.js, blog-repair-service.test.js |
| F9 | Blog Render (HTML Page + JSON-LD SEO) | PASS | blog-publish-production.test.js, blog-cms-routes.test.js |
| F10 | Blog Publish / Archive | PASS | blog-cms-routes.test.js |
| F11 | Song Artwork Generation | PASS | services/song-artwork.test.js |
| F12 | Artwork Moderation | CANDIDATE GAP | — |
| F13 | Cover Image Generation (SVG-based, legacy + V2 compositor) | PASS | services/song-artwork.test.js |
| F14 | Song OG Image (Social Share Card) | PASS | song-og-generator.test.js |
| F15 | Song OG Image Variants (A/B Design Selection) | PASS | song-og-generator.test.js |
| F16 | Poem OG Image Variants (A/B Design Selection) | PASS | poem-generator.test.js, poems.test.js, story-delete-poem.test.js |
| F17 | Image Providers (Flux + OpenAI) | CANDIDATE GAP | — |
| F18 | Artwork Variables Extractor (LLM Slot-Filler) | PASS | services/artwork-vars-extractor.test.js |
| F19 | Artwork Prompt Assembly | CANDIDATE GAP | — |
| F20 | OG Text Utilities | PASS | services/song-artwork.test.js |

## AdminAnalytics

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| G1 | Admin Account Setup | PASS | admin-login-hardening.test.js, admin-auth-default-seed.test.js |
| G2 | Admin Authentication (Login / Session / Password Reset) | PASS | auth-api.test.js, admin-login-hardening.test.js |
| G3 | Admin Dashboard Shell (Static UI) | CANDIDATE GAP | — |
| G4 | User Management (Admin) | PASS | admin-analytics.test.js |
| G5 | Admin Gift Operations (Gift Order Management) | PASS | admin-gift-ops-routes.test.js, admin-analytics.test.js |
| G6 | Cold Email Campaigns (Admin) | PASS | jobs/cold-email-daily.test.js, admin-analytics.test.js |
| G7 | Email Service (Admin / Campaign Side) | CANDIDATE GAP | — |
| G8 | Attribution Tracking (Apple Ads / Analytics) | PASS | apple-ads-attribution.test.js, admin-attribution.test.js |
| G9 | Analytics Dashboard Metrics (Admin) | CANDIDATE GAP | — |
| G10 | Job Queue Management (Admin) | CANDIDATE GAP | — |
| G11 | Content Moderation Queue (Admin) | CANDIDATE GAP | — |
| G12 | Feature Flags (Admin) | CANDIDATE GAP | — |
| G13 | Security & Audit Logs (Admin) | PASS | admin-analytics.test.js |
| G14 | Admin Story Sessions (Admin) | CANDIDATE GAP | — |
| G15 | Blog Post Management (Admin) | CANDIDATE GAP | — |
| G16 | GDPR Audit Service | CANDIDATE GAP | — |
| G17 | Legal Pages and Public Routes | CANDIDATE GAP | — |
| G18 | MCP Server (External Agent Integration) | CANDIDATE GAP | — |
| G19 | Events Service | PASS | admin-analytics.test.js |

## WebApp

| id | feature | result | covering tests |
| --- | --- | --- | --- |
| H1 | Marketing Landing Page (index.html) | PASS | admin-billing-sales.test.js |
| H2 | Occasion-Specific SEO Landing Pages | CANDIDATE GAP | — |
| H3 | Pricing Page | CANDIDATE GAP | — |
| H4 | Support Page | PASS | blog-autofill-service.test.js |
| H5 | About / Our Story Page | CANDIDATE GAP | — |
| H6 | Legal Pages (Privacy Policy / Terms of Service) | CANDIDATE GAP | — |
| H7 | Web Song Player (Share Landing Page) | PASS | gifts.test.js, admin-analytics.test.js |
| H8 | App-Wall / Deep-Link Handoff on Web | PASS | receiver-session.test.js, app-link-service.test.js |
| H9 | Embed Player | PASS | share-embed.test.js |
| H10 | Poem Viewer (Web) | PASS | app-link-service.test.js, admin-billing-sales.test.js, share-app-only.test.js, admin-gift-ops-routes.test.js |
| H11 | Audio Streaming Endpoint — Preview (MP3 / M4A) | CANDIDATE GAP | — |
| H12 | Audio Streaming Endpoint — Full Render (M4A) | PASS | share-audio-proxy.test.js, database/postgres-migration.test.js, admin-gift-ops-routes.test.js, routes/story-lyrics-contract.test.js |
| H13 | Cover Artwork Dynamic Sizing Endpoint | CANDIDATE GAP | — |
| H14 | Guide Vocal Endpoint (Internal) | CANDIDATE GAP | — |
| H15 | OG Meta / Social Cards for Share Links | CANDIDATE GAP | — |
| H16 | Apple Universal Links (AASA) | CANDIDATE GAP | — |
| H17 | Well-Known / Discovery Endpoints | CANDIDATE GAP | — |
| H18 | Sitemap, Robots.txt, and llms.txt | CANDIDATE GAP | — |
| H19 | Debug Page (Song Pipeline Debugger) | CANDIDATE GAP | — |
| H20 | Admin Dashboard (Web UI) | PASS | admin-analytics.test.js |
| H21 | Gift Landing Pages (public/gifts/) | PASS | admin-gift-ops-routes.test.js |
| H22 | MCP / AI Agent Discovery (Well-Known MCP Card) | CANDIDATE GAP | — |
| H23 | Static Asset Serving (styles, assets, audio samples) | PASS | blog-publish-production.test.js, blog-format-service.test.js |
