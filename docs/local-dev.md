# Local Development (MVP Scaffold)

## Run the API
```
npm install
npm run dev
```

The API listens on `http://localhost:3000` by default. Use `PORT` to change it.
SQLite data is stored at `data/porizo.db` by default. Set `DB_PATH` to override. Storage uses `sql.js` (no native build).
Live provider integrations are optional; see `docs/provider-setup.md`.
Generated artifacts are written under `storage/` by default. Set `STORAGE_DIR` to override.
Migrations run automatically on startup.

## Auth Stub
All authenticated routes require `x-user-id` in the request headers.

## Sample Flow
```
curl -X POST http://localhost:3000/voice/enrollment/start \
  -H "x-user-id: user_123" \
  -H "content-type: application/json" \
  -d '{"consent_accepted":true,"consent_version":"v1"}'

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
- `STREAM_BASE_URL` to change the placeholder stream URL base.
- `LIVE_PROVIDERS=true` to call external APIs (ElevenLabs + Replicate).
- `ELEVENLABS_API_KEY` for ElevenLabs auth.
- `ELEVENLABS_BASE_URL` override (default `https://api.elevenlabs.io`).
- `ELEVENLABS_MUSIC_ENDPOINT` override (default `/v1/music`).
- `ELEVENLABS_VOICE_ID` optional voice for guide vocal.
- `REPLICATE_API_TOKEN` for Replicate auth.
- `REPLICATE_BASE_URL` override (default `https://api.replicate.com`).
- `REPLICATE_MODEL_VERSION` for the voice conversion model version.
- `PROVIDER_TIMEOUT_MS` request timeout (default 120000).
- `CLEANUP_INTERVAL_MS` cleanup cadence for expirations (default 600000).

## Tests
```
npm test
```

Tests load `.env` (via `dotenv/config`). If you have `LIVE_PROVIDERS=true` and valid keys,
they will attempt real provider calls during workflow execution.
