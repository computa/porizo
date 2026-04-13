# App Store Submission Checklist

**Last Updated:** 2026-04-11
**Target:** iOS App Store
**Bundle ID:** porizo.ios.app.PorizoApp

---

## 0/ Release Type Policy (applies to every new version)

**All new App Store versions MUST be created with `--release-type AFTER_APPROVAL`.**

```bash
# Creating a new version
asc versions create --app 6758205028 --version "1.5.3" --platform IOS \
  --release-type AFTER_APPROVAL --copy-metadata-from "1.5.2"

# Fixing an existing version that was created with MANUAL
asc versions update --version-id "VERSION_ID" --release-type AFTER_APPROVAL
```

**Why:** As soon as Apple approves a version, it should go live automatically — manual release is an easy thing to forget and adds delay for users. Versions 1.0-1.3 used `AFTER_APPROVAL`; 1.4, 1.5.1, 1.5.2 drifted to `MANUAL` by accident and caused delayed releases.

---

## 1/ App Store Assets

| Item | Status | Action Required |
|------|--------|-----------------|
| App icon 1024x1024 (no transparency) | ✅ Ready | — |
| Screenshots: 6.7" iPhone | ✅ Ready | 5 screenshots in `screenshots/6.7-inch/` |
| Screenshots: 5.5" iPhone | ⏳ Optional | Can reuse 6.7" screenshots |
| Screenshots: 12.9" iPad | ⏳ Optional | Only if supporting iPad |
| App description <4000 chars | ⏳ TODO | Write and paste into App Store Connect |
| Privacy policy URL live | ✅ Ready | https://porizo.co/legal/privacy |
| Support email works | ✅ Ready | support@porizo.co |

**Files:**
- Icon: `PorizoApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png`

---

## 2/ Technical Setup

| Item | Status | Action Required |
|------|--------|-----------------|
| API keys in env variables | ⚠️ Review | Firebase key in GoogleService-Info.plist (consider rotating) |
| Error tracking configured | ✅ Ready | Firebase Crashlytics + dSYM upload |
| TestFlight tested on real devices | ✅ Ready | Build 40 uploaded 2026-02-05 |
| Third-party SDKs approved versions | ✅ Ready | Firebase iOS SDK v12.8.0+ only |
| Memory leaks checked | ⏳ TODO | Run Instruments > Leaks template |

**Files:**
- Crashlytics: `PorizoApp/PorizoAppApp.swift` (line 112)
- Dependencies: `PorizoApp/PorizoApp.xcodeproj/project.pbxproj` (SPM)

---

## 3/ Legal Requirements

| Item | Status | Action Required |
|------|--------|-----------------|
| Privacy policy hosted | ✅ Ready | https://porizo.co/legal/privacy |
| Terms of service URL | ✅ Ready | https://porizo.co/legal/terms |
| COPPA compliance (13+ age gate) | ✅ Ready | Documented in ToS Section 2.1 |
| Data collection declared accurately | ✅ Ready | PrivacyInfo.xcprivacy complete |
| Age rating matches content | ⏳ TODO | Verify in App Store Connect questionnaire |

**Files:**
- Privacy Manifest: `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy`
- Local copies: `public/legal/privacy.html`, `public/legal/terms.html`

---

## 4/ Developer Accounts

| Item | Status | Action Required |
|------|--------|-----------------|
| Apple Developer ($99/year) | ✅ Active | Team ID: 5VCH6937XM |
| Bundle ID matches everywhere | ✅ Ready | porizo.ios.app.PorizoApp |
| Certificates not expired | ✅ Ready | Automatic signing enabled |
| Provisioning profiles valid | ✅ Ready | Auto-managed by Xcode |

**Files:**
- Export config: `PorizoApp/ExportOptions.plist`
- Entitlements: `PorizoApp/PorizoApp/PorizoApp.entitlements`

---

## 5/ Cost Reality

| Item | Monthly Cost | Status |
|------|--------------|--------|
| Railway hosting | ~$20-50 | ✅ Deployed |
| PostgreSQL database | Included | ✅ Railway addon |
| AI APIs (Suno, ElevenLabs, Replicate) | Variable | ✅ See CLAUDE.md |
| Payment processing | 2.9% + $0.30 | ⏳ StoreKit setup |
| Push notifications (APNs) | Free | ✅ Configured |

---

## Blockers (Must Fix Before Submit)

1. ~~**Screenshots**~~ ✅ **DONE** — 5 screenshots captured for 6.7" iPhone
   - Location: `screenshots/6.7-inch/`
   - 01-home.jpg, 02-create-account.jpg, 03-explore-home.jpg, 04-profile.jpg, 05-songs-empty.jpg

2. **App Description** — Write compelling description under 4000 characters

---

## Recommended Fixes (Not Blocking)

1. **Rotate Firebase API key** — Currently exposed in GoogleService-Info.plist
2. **Remove armv7** — From UIRequiredDeviceCapabilities (iOS 17 is arm64 only)
3. **Run memory leak check** — Instruments > Leaks template before final submit

---

## Pre-Submit Commands

```bash
# Archive for App Store
cd PorizoApp
xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp -configuration Release \
  -archivePath build/PorizoApp.xcarchive archive -allowProvisioningUpdates

# Export and upload to TestFlight
xcodebuild -exportArchive -archivePath build/PorizoApp.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates
```

---

## App Store Connect Checklist

Before clicking "Submit for Review":

- [ ] App name available
- [ ] Subtitle (30 chars max)
- [ ] Description (<4000 chars)
- [ ] Keywords (100 chars max, comma-separated)
- [ ] Support URL: https://porizo.co/support
- [ ] Privacy Policy URL: https://porizo.co/legal/privacy
- [ ] Category: Music (primary), Entertainment (secondary)
- [ ] Age Rating questionnaire completed
- [ ] Screenshots uploaded for all required sizes
- [ ] App Preview video (optional but recommended)
- [ ] What's New text (for updates)
- [ ] Build selected
- [ ] Export compliance (uses encryption? HTTPS = Yes, exempt)
- [ ] Content rights declaration
- [ ] Advertising identifier (IDFA) — No if not requesting ATT / using IDFA, even with install-attribution SDKs present

---

## Contact Info for App Store

- **Support Email:** support@porizo.co
- **Privacy Email:** privacy@porizo.co
- **Marketing URL:** https://porizo.co
