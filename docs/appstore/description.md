# App Store Connect Metadata

## App Information

| Field | Value |
|-------|-------|
| **App Name** | Porizo |
| **Subtitle** | Your voice, their song |
| **Primary Category** | Music |
| **Secondary Category** | Entertainment (optional) |
| **Age Rating** | 12+ (Infrequent/Mild Mature/Suggestive Themes) |
| **Copyright** | 2026 Porizo Inc. |

---

## App Description

```
Deep emotions are hard to express. Generic gifts feel impersonal.

Create personalized songs that sound like YOU singing for the people you love.

Transform your voice into beautiful, custom songs for:
• Birthday surprises
• Anniversary celebrations
• Heartfelt thank-yous
• Meaningful apologies
• Or just because

HOW IT WORKS

1. Record your voice (6-8 short phrases, about 2 minutes)
2. Describe the moment and the person
3. Preview your custom song in ~90 seconds
4. Share privately or save in your in-app library

FEATURES

• AI voice cloning from just 2 minutes of recording
• Professional-quality audio output
• Multiple music styles and genres
• Fast preview before you commit
• Private 1-on-1 sharing links
• Save songs in your in-app library
• Background audio playback
• Works offline (for playback)

YOUR VOICE, YOUR MESSAGE, THEIR SONG

Porizo captures what makes your voice unique and applies it to a professionally produced song. The result isn't a robotic imitation—it's unmistakably you.

Perfect for:
• Long-distance relationships
• Surprising loved ones on special days
• Creating lasting memories
• Expressing what words alone can't

SUBSCRIPTION OPTIONS

• Free: Try voice enrollment and preview songs
• Plus: Full renders, more styles, priority processing
• Pro: Unlimited songs, commercial license, advanced features

Start with a free preview. Upgrade when you're ready.

---

Questions? Contact us at support@porizo.co
```

---

## Keywords

**100 character limit**

```
voice cloning,personalized songs,AI singing,birthday gift,anniversary,emotional,custom song,thank you
```

**Alternative keywords to test:**
- `voice clone,custom music,AI voice,personalized gift,singing app,love song,special occasion,memories`
- `birthday song,anniversary gift,AI singer,voice app,custom audio,emotional gift,personal song`

---

## Promotional Text

**170 character limit** - Can be updated without app review.

```
Create songs that sound like YOU singing. The perfect gift for birthdays, anniversaries, and moments that matter. Record your voice, share your heart.
```

---

## What's New (Version Notes)

For first TestFlight release:

```
Welcome to the Porizo beta!

This is our first external TestFlight release. We'd love your feedback on:
• Voice enrollment quality
• Song preview experience
• Overall app usability

Known limitations:
• Full renders require subscription
• Poems feature coming soon
• Device binding for shares in progress

Report issues via TestFlight feedback or email beta@porizo.co
```

---

## Support URL

`https://porizo.co/support`

**Required content on support page:**
- Contact form or email link
- FAQ section
- Account deletion instructions
- Response time expectations

---

## Privacy Policy URL

`https://porizo.co/legal/privacy`

---

## Marketing URL (Optional)

`https://porizo.co`

---

## Screenshot Requirements

### iPhone 6.7" (1290 x 2796)
Required: 5-10 screenshots

**Recommended screens:**
1. **Welcome** - "Your voice, their song" tagline with elegant design
2. **Voice Enrollment** - Recording interface showing progress
3. **Create Song** - Occasion selection with colorful grid
4. **Preview Player** - Full-screen playback with waveform
5. **Share Options** - Sharing interface with privacy emphasis

### iPhone 6.5" (1284 x 2778)
Required: 5-10 screenshots (can use same content as 6.7")

### Screenshot Capture Commands

```bash
# Boot simulator with specific device
xcrun simctl boot "iPhone 15 Pro Max"

# Take screenshot
xcrun simctl io booted screenshot ~/Desktop/screenshot1.png

# For 6.5" (iPhone 15 Plus)
xcrun simctl boot "iPhone 15 Plus"
xcrun simctl io booted screenshot ~/Desktop/screenshot2.png
```

---

## App Icon Verification

```bash
# Check icon exists and has correct dimensions
sips -g pixelWidth -g pixelHeight PorizoApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png

# Check for alpha channel (MUST be 'no' for App Store)
sips -g hasAlpha PorizoApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png
```

Expected output:
- pixelWidth: 1024
- pixelHeight: 1024
- hasAlpha: no

---

## App Privacy Questionnaire

### Data Collection Summary

| Data Type | Collected | Linked to Identity | Used for Tracking |
|-----------|-----------|-------------------|-------------------|
| Audio Data | Yes | Yes | No |
| Contact Info (Email) | Yes | Yes | No |
| Contact Info (Phone) | Yes | Yes | No |
| Identifiers (User ID) | Yes | Yes | No |
| Identifiers (Device ID) | Yes | No | No |
| Usage Data | Yes | No | No |
| Diagnostics (Crash Data) | Yes | No | No |

### Purpose Details

**Audio Data:**
- Purpose: App Functionality
- Linked: Yes (voice enrollment is tied to user account)
- Tracking: No

**Contact Info:**
- Purpose: App Functionality (authentication)
- Linked: Yes (account creation)
- Tracking: No

**Identifiers:**
- User ID: For account functionality
- Device ID: For share link binding (app-scoped device identifier)
- Tracking: No

**Usage Data:**
- Purpose: Analytics, App Functionality
- Linked: No
- Tracking: No

**Diagnostics:**
- Purpose: App Functionality (crash reporting via Crashlytics)
- Linked: No
- Tracking: No

---

## TestFlight Information

### Beta App Description

```
Create personalized songs that sound like YOU singing.
This is a beta test—we appreciate your feedback!
```

### Test Instructions

```
Testing Porizo Beta

WHAT WORKS:
✅ Account creation (Apple Sign In, Phone, Google)
✅ Voice enrollment (record 6-8 phrases)
✅ Song preview (renders in ~90 seconds)
✅ Background audio playback
✅ Basic sharing

KNOWN LIMITATIONS:
⚠️ Full renders require subscription (use sandbox Apple ID)
⚠️ Poems feature coming soon
⚠️ Device binding for shares is incomplete

HOW TO TEST:
1. Sign up with Apple Sign In (easiest)
2. Complete voice enrollment
3. Create a birthday song for someone
4. Play the preview, try background playback
5. Report any issues via TestFlight feedback

DEMO ACCOUNT (for quick testing):
Email: reviewer@porizo.co
Password: [see App Store Connect notes]
This account has pre-enrolled voice and sample songs.
```

### Contact Information

| Field | Value |
|-------|-------|
| Email | beta@porizo.co |
| First Name | [Your Name] |
| Last Name | [Your Last Name] |
| Phone | [Your Phone] |

### Notes for App Review

```
This app creates personalized songs using AI voice conversion.

DEMO ACCOUNT:
- Email: reviewer@porizo.co
- Password: [provided in App Store Connect]
- This account has a pre-enrolled voice profile and sample songs.

FULL TESTING FLOW:
1. Sign up → Enroll voice → Create song → Preview
2. Voice enrollment takes ~2 minutes of recording
3. Song preview renders in ~90 seconds

SUBSCRIPTIONS:
- Work in sandbox mode only during TestFlight
- Use a sandbox Apple ID for purchase testing

NOTES:
- App requires microphone permission for voice enrollment
- Push notifications are used for render completion alerts
- Background audio is used for song playback
```
