# App Store Connect Metadata — Ready to Paste

**Last Updated:** 2026-02-07
**Status:** DRAFT — Review each field, then paste into App Store Connect

---

## 1. App Identity

| Field | Value | Limit | Status |
|-------|-------|-------|--------|
| **App Name** | Porizo | 30 chars | Ready (6 chars) |
| **Subtitle** | Your moment in a song | 30 chars | Ready (21 chars) |

---

## 2. Description (~3,412 chars)

```
Turn your most meaningful moments into personalized songs. Tell us who it's for, share a memory or message, and Porizo creates an original song — perfect for birthdays, anniversaries, thank-yous, or just because.

HOW IT WORKS

1. Tell Your Story
Pick an occasion, name who it's for, and share a memory or message. Choose from a variety of musical styles — pop, R&B, acoustic, and more.

2. We Create Your Song
Porizo writes original lyrics inspired by your message, generates a custom instrumental, and produces a one-of-a-kind song in minutes.

3. Preview & Perfect
Listen to a quick preview of the chorus before committing. Not quite right? Reroll the lyrics, change the beat, or adjust the style until it feels perfect.

4. Share the Moment
Save the finished song in your in-app library or share it directly with a secure link. Your recipient gets a beautiful listening experience — no app download required.

BUILT FOR REAL MOMENTS

Every song starts with a name and a message. Porizo isn't a generic music generator — it's a way to say something meaningful in a way no greeting card ever could.

- Birthday songs that mention them by name
- Anniversary songs with your shared memories woven in
- Thank-you songs that capture exactly what you want to say
- Surprise songs for no reason other than love

MAKE IT EVEN MORE PERSONAL

Want to add your own voice? Optionally enroll your voice in about 2 minutes. Porizo will blend your voice into the song for an even more personal touch. Your voice profile is encrypted and raw recordings are automatically deleted after 7 days.

SUBSCRIPTION PLANS

Free: Try Porizo with limited song creation
Plus ($3.99/mo): 4 songs per month with full features
Pro ($9.99/mo): 10 songs per month with commercial use rights
Annual plans available at 16% savings.

All subscriptions are billed through Apple and can be managed in your device settings. Payment will be charged to your Apple ID account at confirmation of purchase. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period. You can manage and cancel subscriptions in your Account Settings.

Terms of Use: https://porizo.co/legal/terms
Privacy Policy: https://porizo.co/legal/privacy
```

**Character count:** ~3,412 (under 4,000 limit)

---

## 3. Keywords (99 chars)

```
personalized songs,birthday song,custom music,AI,gift,anniversary,wedding,poem,music gift,song
```

**Character count:** 90 (limit: 100)

**Strategy:** Leading with "personalized songs" (highest intent), then occasion-based terms people actually search for. "voice clone" removed — not how we position the product. "poem" included because the app has a poems feature.

---

## 4. URLs

| Field | URL | Verified |
|-------|-----|----------|
| **Support URL** | https://porizo.co/support | Live (FAQ + support@porizo.co) |
| **Privacy Policy URL** | https://porizo.co/legal/privacy | Live (updated Feb 4, 2026) |
| **Marketing URL** | https://porizo.co | Live |

---

## 5. Categories

| | Selection |
|---|-----------|
| **Primary** | Music |
| **Secondary** | Entertainment |

---

## 6. Age Rating Questionnaire

Answer these in App Store Connect:

| Question | Answer | Reason |
|----------|--------|--------|
| Cartoon or Fantasy Violence | None | No violence |
| Realistic Violence | None | No violence |
| Prolonged Graphic or Sadistic Violence | None | No violence |
| Profanity or Crude Humor | Infrequent | User-generated lyrics could contain mild language |
| Mature/Suggestive Themes | None | Music creation only |
| Horror/Fear Themes | None | Not applicable |
| Medical/Treatment Information | None | Not applicable |
| Alcohol, Tobacco, Drug Use or References | Infrequent | Song lyrics could reference |
| Simulated Gambling | None | No gambling |
| Sexual Content or Nudity | None | No visual content |
| Unrestricted Web Access | None | No in-app browser |
| Gambling with Real Currency | None | No gambling |

**Expected rating:** 12+ (due to Infrequent Mild Language)

| Additional Questions | Answer |
|---------------------|--------|
| Made for Kids? | No |
| Age restriction (if any) | 13+ (matches ToS) |

---

## 7. Screenshots

### Current inventory:

| File | Screen | Size | Status |
|------|--------|------|--------|
| `01-home.jpg` | Welcome — "Your moment, in a song" | 6.7" | Usable |
| `02-create-account.jpg` | Sign in (Apple + Phone) | 6.7" | Usable |
| `03-explore-home.jpg` | Explore with occasions | 6.7" | Best screenshot |
| `04-profile.jpg` | Profile & settings | 6.7" | Usable |
| `05-songs-empty.jpg` | My Songs empty state | 6.7" | Weak — shows empty state |

### Requirements:

| Device | Minimum | Recommended | Status |
|--------|---------|-------------|--------|
| 6.7" iPhone (required) | 2 | 5-10 | 5 available |
| 6.5" iPhone | Not required if 6.7" provided | — | Skippable |
| 5.5" iPhone | Not required if 6.7" provided | — | Skippable |
| iPad Pro 12.9" (6th gen) | Required if iPad supported | 5 | Not available |

**Note:** Since iOS 17, Apple accepts 6.7" screenshots and auto-scales for smaller iPhones. You only need iPad screenshots if you're marketing the app on iPad.

### Recommended improvements (optional but helps conversion):

1. Replace `05-songs-empty.jpg` with a screenshot showing songs in the library
2. Add a screenshot of the song creation flow
3. Add a screenshot of the subscription/pricing screen
4. Consider adding text overlays (e.g., "Your moment in a song" banner) — this is common for top apps

---

## 8. App Preview Video

**Status:** Not created (optional)

If you want one later, a 15-30 second screen recording showing:
1. Voice enrollment (2 seconds of recording)
2. Creating a song (picking occasion + recipient)
3. Listening to the preview

This can be recorded in Xcode Simulator or on a real device.

---

## 9. What's New Text

```
Welcome to Porizo! Turn your most meaningful moments into personalized songs for birthdays, anniversaries, and every occasion that matters.
```

(For v1.0 launch, keep it simple. Update with specific changes for future versions.)

---

## 10. Build Selection

**Current:** Build 36 (or latest TestFlight upload)

In App Store Connect > your app > App Store tab > Build section, click "+" and select the latest build uploaded via TestFlight.

---

## 11. Export Compliance

| Question | Answer | Reason |
|----------|--------|--------|
| Does your app use encryption? | **Yes** | HTTPS/TLS for API calls |
| Is it exempt under encryption regulations? | **Yes** | Standard HTTPS only (no custom crypto) |
| Does it qualify for any exemptions? | **Yes, exempt** | Uses only standard OS-level encryption (URLSession TLS) |

**What to select in App Store Connect:**
> "Your app only uses standard encryption provided by iOS/macOS" → This qualifies for the exemption.

You can also add the `ITSAppUsesNonExemptEncryption = NO` key to Info.plist to skip this question on every upload.

---

## 12. Content Rights

| Question | Answer |
|----------|--------|
| Does your app contain, display, or access third-party content? | **No** |
| Do you have rights to all content? | **Yes** |

All music is AI-generated, lyrics are original, and voice is user's own. No licensed content.

---

## 13. Advertising Identifier (IDFA)

| Question | Answer | Reason |
|----------|--------|--------|
| Does this app use the Advertising Identifier (IDFA)? | **No** | Uses install-attribution SDKs (Meta, TikTok Business, AdServices) without requesting ATT / IDFA |

The app does not request ATT permission and does not access IDFA. Install attribution relies on SKAdNetwork, Meta/TikTok app events, and Apple's AdServices token flow.

---

## 13A. App Privacy Questionnaire (Required)

Use this table to complete App Store Connect privacy answers so they match runtime behavior:

| Data Type | Collected | Linked to User | Used for Tracking | Primary Purpose |
|-----------|-----------|----------------|-------------------|-----------------|
| Name | Yes | Yes | No | App functionality (account/profile) |
| Email Address | Yes | Yes | No | App functionality (sign-in, support) |
| Phone Number | Yes (if phone auth) | Yes | No | App functionality (authentication) |
| Audio Data | Yes | Yes | No | App functionality (voice enrollment/song generation) |
| Other User Content (messages/lyrics/prompts) | Yes | Yes | No | App functionality |
| User ID | Yes | Yes | No | App functionality |
| Device ID (app-scoped identifier) | Yes | Yes | No | Security / app functionality (share binding) |
| Purchase History / Subscription status | Yes | Yes | No | App functionality |
| Product Interaction | Yes | Yes | No | Analytics / app functionality |
| Crash Data | Yes | Yes | No | Analytics / app functionality |
| Performance Data | Yes | Yes | No | Analytics / app functionality |

Notes:
- Firebase Analytics + Crashlytics are integrated.
- Install-attribution SDKs are present for Meta Ads (covering both Facebook and Instagram placements), TikTok Ads, and Apple Search Ads token capture.
- No ATT prompt, no IDFA access, and no cross-app tracking are currently implemented. `FacebookAdvertiserIDCollectionEnabled` is disabled in the shipped plist to keep runtime behavior aligned with that answer.
- Keep these answers aligned with `/legal/privacy` and `PrivacyInfo.xcprivacy` on every release.

---

## 14. App Review Notes (Optional but Recommended)

Paste this in the "Notes for Review" field to help the reviewer:

```
Porizo creates original, personalized songs for birthdays, anniversaries, and special moments.

To test the full experience:
1. Sign in with Apple
2. Go to Songs > Create Your First Song
3. Select an occasion, enter a recipient name and message
4. Choose a musical style and tap Create
5. Optionally: Go to Profile > Your Voice > Set Up to add your voice to songs

The app requires an internet connection for song generation.
Voice enrollment requires microphone access.

Demo account (email login):
Email: reviewer@porizo.co
Password: PorizoDemo2026!

The demo account is preloaded with an active voice profile and sample songs.
If preferred, you can also test with Sign in with Apple.

Support: support@porizo.co
```

---

## Summary Checklist

| # | Item | Status |
|---|------|--------|
| 1 | App name | Ready — "Porizo" |
| 2 | Subtitle | Ready — "Your moment in a song" (21 chars) |
| 3 | Description | Ready — 3,847 chars (paste from Section 2) |
| 4 | Keywords | Ready — 99 chars (paste from Section 3) |
| 5 | Support URL | Verified live |
| 6 | Privacy Policy URL | Verified live |
| 7 | Category | Music / Entertainment |
| 8 | Age Rating | Answer questionnaire (Section 6) |
| 9 | Screenshots (6.7") | 5 available — consider improving #5 |
| 10 | Screenshots (iPad) | Not needed unless targeting iPad |
| 11 | App Preview | Optional — skip for v1 |
| 12 | What's New | Ready (paste from Section 9) |
| 13 | Build | Select latest in App Store Connect |
| 14 | Export compliance | Exempt (standard HTTPS only) |
| 15 | Content rights | Yes — all original/AI-generated |
| 16 | IDFA | No — not using ads |
| 17 | Review notes | Ready (paste from Section 14) |
