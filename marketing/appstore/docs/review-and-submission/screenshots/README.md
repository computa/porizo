# App Store Screenshots

## Captured Screenshots

| File | Screen | Status |
|------|--------|--------|
| `01-login.jpg` | Login/Signup screen | Captured |
| `02-voice-enrollment.jpg` | Voice Enrollment intro | Captured |

## Screenshots Still Needed

To capture the remaining screenshots, you'll need to:
1. Complete voice enrollment on a real device (requires microphone)
2. Or create a demo account with pre-enrolled voice profile

| Screen | Priority | Notes |
|--------|----------|-------|
| Explore Tab | High | Shows occasion grid, quick create buttons |
| Create Song | High | Form for recipient name, occasion, message |
| Preview Player | High | Full-screen playback with controls |
| My Songs | Medium | List of created songs |
| Share Options | Medium | Share sheet with download/share options |

## Screenshot Specifications

For App Store submission, screenshots are required in these sizes:

| Device | Resolution | Required |
|--------|------------|----------|
| 6.7" iPhone (15 Pro Max) | 1290 x 2796 | Yes (5 minimum) |
| 6.5" iPhone (14 Plus) | 1284 x 2778 | Yes (5 minimum) |
| 5.5" iPhone (8 Plus) | 1242 x 2208 | Optional |

## Capture Commands

```bash
# Screenshot from simulator
xcrun simctl io booted screenshot screenshot.png

# With specific device
xcrun simctl io 88D2B85D-E98B-4A0B-86A2-C82D77D11298 screenshot screenshot.png
```

## Notes

- Screenshots were captured on iPhone 16 Pro simulator (402x874 points)
- Auth bypass flag (`--bypass-auth`) works for skipping login
- Voice enrollment cannot be bypassed and requires actual voice recording
