# Porizo Admin Dashboard Spec (Draft v0.1)

## 1. Purpose

Build a production-ready admin dashboard that lets internal teams monitor, diagnose, and manage Porizo’s core workflows: user identity, voice enrollment, story writing, song rendering, sharing, billing, moderation, and system health. This spec is grounded in the current codebase and schema to avoid drift.

## 2. Scope (MVP)

- **In scope:** Metrics + monitoring, user support actions, moderation oversight, billing/admin config, share analytics, job/queue health, provider health, audit trails.
- **Out of scope (for now):** Full CRM, campaign builder, arbitrary SQL console.

## 3. Admin Roles & Permissions

1. **Ops Admin** — full access; can rebind share tokens, grant songs, manage plans/trials.
2. **Support** — user search, view user profile, share recovery, reset flows; cannot edit plans or billing config.
3. **Moderation** — access moderation queues and content review; cannot change billing.
4. **Finance** — subscriptions, receipts, refunds, trial policies.
5. **Marketing/SEO** — growth metrics and share funnels (read-only).

> **Note:** Current server uses `x-admin-key` header in `/admin/*` routes. This must be replaced with role-based admin JWTs in production.

## 4. Data Sources (Existing)

**Core tables**
- `users`, `devices`, `user_sessions`, `auth_events`
- `voice_profiles`, `enrollment_sessions`
- `story_sessions`, `story_turns`
- `tracks`, `track_versions`, `jobs`
- `share_tokens`, `share_access_log`, `share_events`
- `entitlements`, `subscriptions`, `subscription_plans`, `plan_products`, `trial_config`
- `purchase_receipts`, `credit_transactions`, `song_transactions`, `billing_holds`
- `audit_logs`, `rate_limits`

**Key logs / telemetry**
- Audit log entries via `addAuditEntry` in `src/server.js`
- Share access logs (claim, stream, playlist, etc.)
- Moderation outcomes (stored in `track_versions.moderation_details_json`)
- Provider status available from `/health`

## 5. User Activity Inventory (From Codebase)

### Account & Identity
- **Signup / Login / Social Login / Token Refresh / Logout**
  - Endpoints: `/auth/signup`, `/auth/login`, `/auth/social`, `/auth/refresh`, `/auth/logout`
  - Data: `users`, `user_auth_providers`, `user_sessions`, `auth_events`
- **Password Reset / Email Verify**
  - Endpoints: `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`
  - Data: `password_reset_tokens`, `email_verification_tokens`, `auth_events`
- **Session Management / Account Deletion**
  - Endpoints: `/auth/sessions`, `/auth/sessions/:id`, `/auth/delete-account`
  - Data: `user_sessions`, `auth_events`, `audit_logs`

### Device & Security
- **Device registration**
  - Endpoint: `/device/register`
  - Data: `devices`
- **Share claim device binding**
  - Endpoint: `/share/:shareId/claim`
  - Data: `share_tokens`, `share_access_log`

### Voice Enrollment
- **Start / Upload / Complete enrollment**
  - Endpoints: `/voice/enrollment/start`, `/voice/enrollment/chunk_uploaded`, `/voice/enrollment/complete`
  - Data: `enrollment_sessions`, `voice_profiles`, `audit_logs`
- **Re-verify / Delete profile**
  - Endpoints: `/voice/reverify`, `/voice/profile` (GET/DELETE)
  - Data: `voice_profiles`, `audit_logs`

### Story Writing (V1 + V2)
- **Start / Continue / Confirm / Add details / Delete**
  - Endpoints: `/story/start`, `/story/:id/continue`, `/story/:id/confirm`, `/story/:id/add-details`, `/story/:id`
  - Data: `story_sessions`, `story_turns`, `audit_logs`
- **Story → Lyrics / Track**
  - Endpoints: `/story/:id/lyrics`, `/story/:id/to-track`
  - Data: `tracks`, `track_versions`, `audit_logs`

### Poem Flow
- **Create / Update / Delete**
  - Endpoints: `/poems`, `/poems/:id`
  - Data: `poems`, `audit_logs`

### Track & Render Pipeline
- **Track create / delete**
  - Endpoints: `/tracks`, `/tracks/:id`
  - Data: `tracks`, `audit_logs`
- **Versions & render**
  - Endpoints: `/tracks/:id/versions`, `/render_preview`, `/render_full`, `/reroll`
  - Data: `track_versions`, `jobs`, `audit_logs`
- **Lyrics flow**
  - Endpoints: `/lyrics/generate`, `/lyrics/approve`, `/lyrics` (GET/PUT)
  - Data: `track_versions`, `audit_logs`

### Sharing & Playback
- **Share creation / revoke**
  - Endpoints: `/tracks/:id/share`, `/tracks/:id/share` (DELETE)
  - Data: `share_tokens`, `audit_logs`
- **Recipient access / playback**
  - Endpoints: `/share/:id`, `/share/:id/claim`, `/share/:id/playlist`, `/share/:id/segment/:segment`
  - Data: `share_access_log`, `share_events`
- **Share stats**
  - Endpoint: `/tracks/:id/share/stats`

### Billing & Entitlements
- **Receipt validation / subscription status**
  - Endpoints: `/billing/receipt/apple`, `/billing/receipt/google`, `/billing/subscription-status`, `/billing/restore`
  - Data: `subscriptions`, `purchase_receipts`, `song_transactions`, `entitlements`
- **Trial activation**
  - Endpoint: `/billing/trial/activate`
  - Data: `trial_config`, `entitlements`, `audit_logs`
- **Admin plan & trial config**
  - Endpoints: `/admin/plans`, `/admin/plans/:id`, `/admin/trial/config`, `/admin/plans/:id/products`
  - Data: `subscription_plans`, `plan_products`, `trial_config`
- **Admin grant songs**
  - Endpoint: `/admin/billing/grant-songs`
  - Data: `song_transactions`, `audit_logs`

### Moderation & Compliance
- **Content moderation**
  - Used on story start, poems, lyrics generation, track creation
  - Data: `track_versions.moderation_details_json`, `audit_logs`
- **GDPR audits**
  - Data: `audit_logs` from `gdpr-audit-service`

## 6. Dashboard Information Architecture

### 6.1 Overview (Executive)
**Goal:** One screen that answers “Is Porizo healthy today?”

**KPIs**
- Daily active users (DAU), weekly active users (WAU)
- New signups (email, Apple, Google)
- Story starts → story confirms conversion
- Preview renders started → completed
- Full renders started → completed
- Share created → claimed → streamed conversion
- Revenue (gross / net), active subscriptions, trial → paid conversion

**Health Indicators**
- Queue backlog by workflow (enrollment, render, share)
- Provider status (ElevenLabs, Suno, Replicate) + error rates
- Moderation blocks / warnings
- Playback errors (share playlist failures, stream errors)

### 6.2 User Support Console
**Goal:** Diagnose a user quickly without raw DB access.

**User Search**
- Search by email, user ID, recipient name, track ID, share ID
- Recent activity + last seen device

**User Overview Panel**
- Profile: email, locale, country, risk level, last login
- Devices: registered devices, last seen, app version
- Voice profile: status, quality score, last verified
- Entitlements: tier, songs remaining, trial status
- Current stories: active session, engine version, last question
- Tracks: latest track versions + render status
- Shares: active share tokens + claim status

**Support Actions**
- Revoke share / rebind share (admin only)
- Grant songs (admin only)
- Lock/unlock account
- Force logout sessions
- Trigger re-verify voice

### 6.3 Story & Writing Quality
**Goal:** Monitor story engine quality and user completion.

**Metrics**
- Story session starts vs confirms
- Avg turns to completion
- Drop-off by question index
- V1 vs V2 usage + completion rate
- Moderation blocks in story inputs

**Actions**
- View story session transcript
- View V2 state (facts, narrative, beats, song_map)
- Tag problematic sessions for review

### 6.4 Render Pipeline Health
**Goal:** Identify failures early.

**Metrics**
- Preview render success rate / p95 time
- Full render success rate / p95 time
- Failure breakdown by step (`jobs.step`)
- Retry counts and hard failures
- Provider latency (Suno/ElevenLabs/Replicate)

**Actions**
- Retry a failed job
- Cancel stuck job
- View job step history

### 6.5 Moderation & Safety
**Goal:** Detect and handle abuse.

**Metrics**
- Moderation warnings vs blocks
- Impersonation attempts
- Repeat offenders (risk_level escalation)

**Actions**
- Review flagged tracks/lyrics
- Override block (with reason)
- Escalate user risk level

### 6.6 Sharing & Growth (Marketing + SEO)
**Goal:** Measure viral loop + external traffic.

**Metrics**
- Shares created → claims → streams conversion
- Claim failures (invalid PIN, wrong device)
- Web player opens vs app installs
- QR scans vs plays
- Top shares by engagement
- Referral sources (UTM/referrer) **[needs instrumentation]**

**SEO**
- Teaser page impressions & CTR (if enabled)
- OG image rendering success rate
- Indexable public pages count **[future]**

### 6.7 Billing & Revenue
**Metrics**
- Active subs by tier (free/plus/pro)
- Trial activations → conversions
- Subscription churn (expired/cancelled)
- Song grants vs usage
- Webhook failures

**Actions**
- Update plan pricing / features
- Update trial policy
- Grant songs / issue refunds

### 6.8 System & Provider Health
**Metrics**
- Provider live status (per `/health`)
- API error rate (5xx)
- Job backlog by queue
- Storage errors / missing assets

**Actions**
- Disable a provider
- Pause queue processing

## 7. Required Metrics (Definition)

**Funnel Metrics**
- `story_start_rate` = story_start events / total users
- `story_confirm_rate` = story_confirm / story_start
- `preview_completion_rate` = preview_ready / preview_requested
- `full_completion_rate` = full_ready / full_requested
- `share_claim_rate` = claim_success / share_created
- `stream_rate` = stream_started / claim_success

**Quality Metrics**
- `story_turns_avg` (from `story_turns`)
- `moderation_block_rate` (from `track_versions.moderation_details_json`)
- `lyrics_regen_rate` (from `/lyrics/generate`)

**Operational Metrics**
- `job_failure_rate` (from `jobs.status`)
- `provider_error_rate` (from logs)
- `billing_hold_expired_rate`

## 8. Admin API Gaps to Build

1. **User search endpoint** (by email/track/share ID)
2. **Job health API** (per queue status)
3. **Moderation review API** (list blocked items)
4. **Share rebind endpoint** (specified in spec but not implemented)
5. **Marketing attribution fields** (UTM/referrer capture)

## 9. Audit & Compliance

- Every admin action must log to `audit_logs` with admin_id + reason.
- Export CSV for audit logs, share access logs, and billing actions.

## 10. Appendix: Mapping Actions to Audit Logs

Current audit actions (from code):
- `enrollment_started`, `enrollment_completed`
- `voice_profile_deleted`
- `story_started`, `story_confirmed`, `story_lyrics_generated`, `story_to_track`
- `poem_created`, `poem_updated`, `poem_deleted`
- `track_created`, `track_deleted`
- `render_requested` (preview/full)
- `lyrics_approved`
- `share_created`, `share_revoked`
- `moderation_warned`, `moderation_blocked`, `llm_moderation_blocked`
- `subscription_synced`, `subscription_restored`, `trial_activated`
- `admin_grant_songs`, `admin_update_trial_config`, `admin_update_plan`, `admin_add_product_mapping`, `admin_remove_product_mapping`

