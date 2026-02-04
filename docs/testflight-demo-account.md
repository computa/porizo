# TestFlight Demo Account

## Credentials for Apple Reviewers

| Field | Value |
|-------|-------|
| Email | `reviewer@porizo.co` |
| Password | `PorizoDemo2026!` |
| Display Name | Demo Reviewer |
| Tier | Pro (full access) |

## Pre-configured Content

This demo account has:

### Voice Profile
- **Status:** Completed (enrollment bypassed for testing)
- **Quality Score:** 85%
- **Model:** ecapa-tdnn-v1

### Sample Songs
| Title | Occasion | Recipient | Status |
|-------|----------|-----------|--------|
| Happy Birthday Sarah | Birthday | Sarah | Preview Ready |
| Our Anniversary Song | Anniversary | My Love | Preview Ready |

### Entitlements
- **Credits:** 100 (enough for extensive testing)
- **Tier:** Pro (full render access)

## Testing Instructions

### Option 1: Email Login
1. Launch the app
2. Tap "Use my phone number" → then switch to email login
3. Enter `reviewer@porizo.co` and `PorizoDemo2026!`
4. App will skip voice enrollment (already completed)
5. Navigate to Songs tab to see pre-created songs

### Option 2: Apple Sign In (Recommended)
Apple reviewers can use their own Apple ID:
1. Launch the app
2. Tap "Sign in with Apple"
3. Complete voice enrollment (6-8 phrases, ~2 minutes)
4. Create and preview songs

## What to Test

### Core Flow
1. View existing songs in "My Songs" tab
2. Create a new song:
   - Tap "Create" button
   - Select an occasion (Birthday, Thank You, etc.)
   - Enter recipient name and personal message
   - Wait for preview (~90 seconds)
3. Play the preview
4. Background audio (lock screen playback)

### Known Limitations
- Full renders require subscription (preview mode works)
- Share links require device binding (partially complete)
- Poems feature is hidden (coming soon)

## Account Details (Internal)

```sql
-- User ID: demo_reviewer_001
-- Voice Profile ID: vp_demo_reviewer_001
-- Track IDs: trk_demo_001, trk_demo_002
```

## Recreating the Account

If the demo account needs to be reset:

```bash
docker exec -i porizo-postgres psql -U porizo -d porizo << 'EOF'
-- Delete existing demo data
DELETE FROM track_versions WHERE track_id LIKE 'trk_demo_%';
DELETE FROM tracks WHERE user_id = 'demo_reviewer_001';
DELETE FROM enrollment_sessions WHERE user_id = 'demo_reviewer_001';
DELETE FROM voice_profiles WHERE user_id = 'demo_reviewer_001';
DELETE FROM user_credentials WHERE user_id = 'demo_reviewer_001';
DELETE FROM user_auth_providers WHERE user_id = 'demo_reviewer_001';
DELETE FROM entitlements WHERE user_id = 'demo_reviewer_001';
DELETE FROM users WHERE id = 'demo_reviewer_001';
EOF
```

Then re-run the creation script from the TestFlight submission session.
