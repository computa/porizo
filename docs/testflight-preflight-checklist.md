# TestFlight Preflight Checklist

Run this before every TestFlight upload. Do not upload if any required item fails.

## Required Automation

- `npm run lint`
- `npm test`
- `npm run appconfig:smoke`
- iOS build:
  `xcodebuild -quiet -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`

## App Update Prompt

- `/app/config` returns an `app_update` object with a valid `app_store_url`.
- If blocking an old binary, set either `minimum_supported_version` or `IOS_MIN_SUPPORTED_BUILD`.
- If nudging users to update, set either `recommended_version` or `IOS_RECOMMENDED_BUILD`.
- Verify one older local/TestFlight build sees the update prompt and the button opens the App Store listing.
- Verify the current upload candidate does not prompt unless intentionally configured.

## OneSignal And APNs

- `PORIZO_ONESIGNAL_APP_ID` resolves in the iOS build, or the checked-in production fallback remains valid.
- Sign in on device and confirm notification permission flow appears if permission is not already decided.
- Confirm Xcode logs include APNs registration and backend device registration:
  - `[Push] Token saved`
  - `[Push] Device registration succeeded`
- In production/Railway logs, confirm `/device/register` receives `push_token` for the signed-in user.
- Send a render-complete test push or complete a short render and confirm the local notification appears.

## Onboarding Sample Song

- `npm run appconfig:smoke` passes and prints a reachable `sample_audio_url`.
- Fresh install: complete the first onboarding splash and confirm the sample audio starts or the play fallback remains visible.
- Turn on airplane mode and relaunch: onboarding should continue without hanging, even if audio cannot start.
- Invalid or missing sample URL must degrade to no audio, not a stuck loading state.

## Launch Flash Song Playback

- Use a test account with at least one song in the library whose status is `ready`, `preview_ready`, or legacy `completed`.
- Cold launch after auth and confirm launch flash appears.
- Confirm a library track can play via cached audio URL or lazy fetch from `/tracks/:id`.
- Dismiss the flash and confirm the app reaches the expected main route.
- Toggle Launch Flash off in Settings and confirm it no longer appears.
