# Provider Setup (Live Mode)

## ElevenLabs (Music + Guide Vocal)
Set the following:
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_BASE_URL` (default `https://api.elevenlabs.io`)
- `ELEVENLABS_MUSIC_ENDPOINT` (default `/v1/music`)
- `ELEVENLABS_VOICE_ID` (optional)

The API response is expected to return `instrumental_url` and `guide_vocal_url`.
If your account uses a different response shape, update `src/providers/elevenlabs.js`.

## Replicate (Voice Conversion)
Set the following:
- `REPLICATE_API_TOKEN`
- `REPLICATE_BASE_URL` (default `https://api.replicate.com`)
- `REPLICATE_MODEL_VERSION` (model version ID)

The implementation expects Replicate's `/v1/predictions` response with an `output`
field that is either a URL string or array of URL strings.

## Enabling Live Providers
```
LIVE_PROVIDERS=true
```

## Notes
- This scaffold only downloads audio artifacts; mix/master/watermark remain placeholders.
- The Replicate step uses `guide_vocal_url` from the ElevenLabs response when available.
  If you supply guide vocals another way, populate `track_versions.guide_vocal_url`.
