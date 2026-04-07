# Porizo Growth Research — 2026-04-07

## App Store Analytics (90-day, ending April 5)

| Metric | Value |
|--------|-------|
| Impressions | 12.7K |
| Product Page Views | 259 (2% of impressions) |
| First-Time Downloads | 44 (17% of page views) |
| Conversion Rate | 0.6% |
| Redownloads | 15 (mostly developer) |
| Registered Users | 29 (34% drop-off at auth) |
| Proceeds | $5 (1 IAP) |
| Day 1 → Paid | 1.72% |
| Day 7 → Paid | 1.85% |

## Key Findings

### Acquisition Funnel
- Impression → page view (2%) is the bottleneck — ASO needs work
- Page view → download (17%) is decent — description converts
- Download → registration (66%) — 34% drop at auth wall

### Auth Friction
- Users don't like signing in with Apple ID
- Auth is a hard gate before any functional tab
- Two methods: Sign in with Apple (primary), Phone (secondary)
- No guest mode

### Free Tier
- Signup grants: 1 song, 1 poem (configurable via feature flags)
- 5 previews/day
- Trial: 2 songs, 7 days (requires explicit activation — never wired)

### Current Plan Limits (post migration 075)
| Plan | Songs/mo | Poems/mo | Previews/day | Price |
|------|----------|----------|--------------|-------|
| Free | 0 (+1 grant) | 0 (+1 grant) | 5 | $0 |
| Plus | 10 | 10 | 20 | $6.99/mo |
| Pro | 20 | 20 | unlimited | $14.99/mo |

### Share Flow
- Track shares work WITHOUT auth — recipient listens immediately
- "Make one for someone you love →" CTA is plain text, NOT tappable
- No conversion path from share recipient to song creator
- Device-bound claims don't persist without auth
- Poem shares block at auth (inconsistent with tracks)

### ASO Metadata
- Subtitle: "Your voice, their song"
- Keywords: voice cloning, personalized songs, AI singing, birthday gift, anniversary, emotional, custom song, thank you
- Description says "Pro: Unlimited songs" but Pro is capped at 20/month

## Proposed Initiatives

### 1. ASO Fixes (Metadata only)
- Subtitle: "AI Songs in Your Voice"
- Keywords: AI song maker, custom song, birthday song, voice clone, singing gift, anniversary gift, personalized, love
- Fix misleading "unlimited" claim

### 2. Free Value Expansion
- Set `free_tier_songs_grant` flag from 1 → 3 in production DB
- No code deploy needed

### 3. Sharing as Growth (PRIORITY #1)
- Make share CTAs tappable
- Add "Create your own song" gold CTA to ShareClaimView
- **Research inline playback within Facebook/Instagram/TikTok** (no tab open)
- Current state: Facebook opens in-app browser with PIN page
- Goal: Song plays directly within the social feed

### 4. Auth Friction Reduction
- Swap Phone to primary, Apple to secondary
- Soften auth screen copy
- Deferred auth (future session — deep refactor)

## Status
- Initiatives 1-4 planned, not yet implemented
- Focus shifted to social sharing viral loop (Initiative 3)
- App v1.5.1 (build 87) submitted for App Store review
