# TestFlight Known Issues

## Current Beta Build Status

| Feature | Status | Notes |
|---------|--------|-------|
| Voice Enrollment | ✅ Working | 6-8 phrases required, ~2-3 minutes |
| Song Preview | ✅ Working | ~90 second render time |
| Full Render | ⚠️ Subscription Required | Testers need Plus/Pro subscription |
| Share Links | ⚠️ Partial | Device binding incomplete |
| Poems | ❌ Hidden | Feature incomplete, coming soon |
| IAP Subscriptions | ⚠️ Sandbox Only | Use sandbox Apple ID for testing |
| Push Notifications | ⚠️ TestFlight Only | Requires TestFlight build for APNs |
| Google Sign-In | ⚠️ Production Keys Required | Configure production OAuth credentials |
| Facebook Sign-In | ⚠️ Production Keys Required | Configure production App ID |

## Feature Flags

| Flag | Value | Description |
|------|-------|-------------|
| `ff_preview_only_mode` | ON | Full render requires subscription |
| `ff_poems_enabled` | OFF | Poem generation feature hidden |
| `ff_section_reroll` | ON | Allow section-level re-renders |

## Known Limitations

### Voice Enrollment
- Minimum of 6 phrases must be recorded to proceed
- Background noise detection may reject recordings in loud environments
- Quality score must be ≥70 to complete enrollment

### Song Creation
- Preview renders take approximately 60-90 seconds
- Full renders (with subscription) take 2-3 minutes
- Some music styles may produce inconsistent results

### Sharing
- Share links are one-time use (bind to first device)
- Device binding requires app to be installed on recipient device
- Universal links require `apple-app-site-association` file on porizo.co

### Subscriptions (Sandbox Testing)
- Use a sandbox Apple ID (not your real Apple ID)
- Create sandbox account in App Store Connect
- Subscriptions renew on accelerated schedule in sandbox:
  - Weekly → 3 minutes
  - Monthly → 5 minutes
  - Yearly → 1 hour

### Audio Playback
- Background audio works with AirPods and Bluetooth devices
- Lock screen controls should show Now Playing metadata
- Audio interruptions (calls, Siri) should pause/resume correctly

## Reporting Issues

When reporting issues via TestFlight feedback:

1. Describe what you were trying to do
2. What actually happened
3. Include screenshots if possible
4. Note your device model and iOS version

For urgent issues: beta@porizo.co
