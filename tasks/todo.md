# Download Attribution Tracking + Admin User Detail Modal

## Goal
Track where downloads/signups come from (Facebook ads, organic, shares) with country data. Build a proper user detail modal in the admin dashboard showing everything at a glance.

## Plan

### Phase 1: Database Migration
- [x] Create `download_events` table (migrations/071_download_attribution.sql)
- [x] Add columns to `users`: acquisition_source, acquisition_campaign, acquisition_country

### Phase 2: Backend - Log Downloads
- [x] Install `geoip-lite` for offline IP-to-country lookup
- [x] Update `/download` route in `legal.js` to log every hit to download_events (non-blocking)
- [x] Extract UTM params, IP, user-agent, country from request

### Phase 3: Backend - Match on Signup
- [x] In `auth.js` signup flow: email, social, phone, orphaned recovery — all 4 paths covered
- [x] If match found: UPDATE user with acquisition_source, acquisition_campaign, acquisition_country
- [x] Mark download_event as matched (set matched_user_id)

### Phase 4: Admin API
- [x] Add acquisition fields to user list endpoint response (admin-service.js searchUsers)
- [x] Add attribution data + download_events to user detail endpoint (admin-service.js getUserDetail)
- [ ] Add download analytics summary endpoint (downloads by source, by country) — deferred

### Phase 5: Admin Dashboard - User List
- [x] Add SOURCE column with violet badge
- [x] Add COUNTRY column with country code

### Phase 6: Admin Dashboard - User Detail Modal
- [x] Convert inline UserDetailPanel to a slide-over drawer/modal (fixed overlay + right panel)
- [x] Add Attribution section: source, medium, campaign, country, referrer, download timestamp
- [x] Show all sections: profile, entitlements, voice profile, tracks, sessions, attribution
- [x] Comprehensive view - everything about a user at a glance

## Files to Modify
- `migrations/0XX_download_attribution.sql` (new)
- `src/routes/legal.js` (add logging to /download)
- `src/routes/auth.js` (add attribution matching on signup)
- `admin/src/pages/Users.tsx` (source/country columns + detail modal)
- `package.json` (add geoip-lite)

---

## Previous Tasks

**Payment Flow Hardening** - 14 fixes across subscription, webhook, billing, and sync - COMPLETE
**Fix 3 Production Sharing Bugs** - COMPLETE
**Subscription + StoreKit Production Hardening** - COMPLETE
**Stability Hardening + Writer v3 Test Fixes** - COMPLETE
**iOS Code Review Fixes** - 13 issues across 12 files - COMPLETE
