# Local Development (MVP Scaffold)

## Run the API
```
npm install
npm run dev
```

`npm run dev` starts both the API server and the job worker. If you want them separately:
```
npm run api
npm run worker
```

The API listens on `http://localhost:3000` by default. Use `PORT` to change it.
SQLite data is stored at `data/porizo.db` by default. Set `DB_PATH` to override. Storage uses `sql.js` (no native build).
Live provider integrations are optional; see `docs/provider-setup.md`.
Generated artifacts are written under `storage/` by default. Set `STORAGE_DIR` to override.
Migrations run automatically on startup.

## Auth Stub
All authenticated routes require `x-user-id` in the request headers.

## Auth Providers (Google + Facebook)
Google and Facebook sign-in are enabled when both the API and iOS app have the required env values.

### API env vars
Set these in `.env` (see `.env.example`):
- `GOOGLE_CLIENT_ID` (OAuth client ID for iOS)
- `GOOGLE_CLIENT_SECRET` (optional for public client + PKCE)
- `GOOGLE_REDIRECT_URI` (must match iOS; default example: `porizo-oauth://auth/google`)
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `FACEBOOK_REDIRECT_URI` (must match iOS; default example: `porizo-oauth://auth/facebook`)

### iOS build settings / scheme env vars
Set these in Xcode (Build Settings → User-Defined) or Scheme Environment Variables:
- `PORIZO_GOOGLE_CLIENT_ID`
- `PORIZO_GOOGLE_REDIRECT_URI`
- `PORIZO_FACEBOOK_APP_ID`
- `PORIZO_FACEBOOK_REDIRECT_URI`
- `PORIZO_FACEBOOK_ADS_APP_ID` (Meta Events Manager / Ads app id used by `FacebookAppID`; checked into the current project settings, but overrideable)
- `PORIZO_FACEBOOK_CLIENT_TOKEN` (Meta client token used by `FacebookClientToken`; checked into the current project settings, but overrideable)
- `PORIZO_TIKTOK_CLIENT_KEY` (TikTok Share/OpenSDK client key; project ships with a safe placeholder, but real in-app TikTok sharing and callback handling require the actual key)
- `PORIZO_TIKTOK_REDIRECT_URI` (must match TikTok Share Kit redirect URI; default `https://porizo.co/tiktok/share-callback`)
- `PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN` (TikTok Events Manager access token for app install attribution)
- `PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID` (numeric TikTok app id from Events Manager)

If these are not set, the Google/Facebook buttons are hidden in the auth screen.
Meta app-events are configured in the checked-in build settings for this repo. TikTok Share/OpenSDK and TikTok Business attribution stay disabled until you provide real TikTok credentials. Instagram app install ads use the Meta SDK path; there is no separate Instagram iOS SDK in this project.

## Sample Flow
```
# Start enrollment and capture upload URLs
curl -X POST http://localhost:3000/voice/enrollment/start \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{"consent_accepted":true,"consent_version":"v1"}'

# Upload a chunk directly to storage (use upload_urls[0].url from the response)
curl -X PUT "UPLOAD_URL_FROM_START" \
  -H "content-type: audio/wav" \
  --data-binary @chunk.wav

# Notify backend that the chunk is uploaded
curl -X POST http://localhost:3000/voice/enrollment/chunk_uploaded \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{"session_id":"SESSION_ID","chunk_id":"p1","duration_sec":5.0}'

curl -X POST http://localhost:3000/tracks \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{"title":"Happy Birthday","occasion":"birthday","recipient_name":"Sam","style":"pop","duration_target":60,"voice_mode":"user_voice","message":"Thanks for being amazing!"}'

curl -X POST http://localhost:3000/tracks/{trackId}/versions/1/lyrics/generate \
  -H "x-user-id: user_123"

curl -X POST http://localhost:3000/tracks/{trackId}/versions/1/lyrics/approve \
  -H "x-user-id: user_123"
```

## Share Stream Key
After claiming a share token, request the HLS key:
```
curl http://localhost:3000/share/{shareId}/key \
  -H "x-device-id: ios-idfv-123" \
  -H "x-platform: ios"
```

## Share Playlist
```
curl http://localhost:3000/share/{shareId}/playlist \
  -H "x-device-id: ios-idfv-123" \
  -H "x-platform: ios"
```

## Preview-Only Mode
Set `PREVIEW_ONLY=true` to block full renders.

## Optional Env Vars
- `STREAM_BASE_URL` to change the stream URL base (default `http://localhost:PORT`). Required for physical devices so preview URLs point at your Mac's IP.
- `STORAGE_PROVIDER` set to `local` (default) or `s3`.
- `UPLOAD_SIGNING_SECRET` for local presigned upload validation.
- `UPLOAD_URL_TTL_SEC` presigned upload TTL (default 900).
- `LIVE_PROVIDERS=true` to call external APIs (ElevenLabs + Replicate).
- `ELEVENLABS_API_KEY` for ElevenLabs auth.
- `ELEVENLABS_BASE_URL` override (default `https://api.elevenlabs.io`).
- `ELEVENLABS_COMPOSITION_PLAN_ENDPOINT` override (default `/v1/music/plan`).
- `ELEVENLABS_MUSIC_ENDPOINT` override (default `/v1/music`).
- `ELEVENLABS_TTS_VOICE_ID` optional override for guide vocal voice.
- `REPLICATE_API_TOKEN` for Replicate auth.
- `REPLICATE_BASE_URL` override (default `https://api.replicate.com`).
- `REPLICATE_MODEL_VERSION` for the voice conversion model version.
- `REPLICATE_EMBEDDING_MODEL_VERSION` for enrollment embedding extraction.
- `PROVIDER_TIMEOUT_MS` request timeout (default 120000).
- `CLEANUP_INTERVAL_MS` cleanup cadence for expirations (default 600000).
- `S3_BUCKET` bucket name for `STORAGE_PROVIDER=s3`.
- `S3_REGION` region for S3 (default `us-east-1`).
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for S3 auth.
- `S3_SESSION_TOKEN` for temporary credentials (optional).
- `S3_ENDPOINT` for S3-compatible storage (optional).
- `S3_FORCE_PATH_STYLE` set to `true` for path-style endpoints.
- `S3_URL_EXPIRES_SEC` presigned URL TTL for S3 (default 900).
- `INLINE_JOB_RUNNER` set to `false` to avoid starting the in-process job runner inside the API server (default `true`). `npm run dev` sets this to `false` for the API process so the standalone worker handles job processing.

## Tests
```
npm test
```

Tests load `.env` (via `dotenv/config`). If you have `LIVE_PROVIDERS=true` and valid keys,
they will attempt real provider calls during workflow execution.
