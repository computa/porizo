# Tools

## Replicate Voice Conversion Test

Requirements:
- Node 18+
- `REPLICATE_API_TOKEN`
- `REPLICATE_VERSION`

Example:
```bash
export REPLICATE_API_TOKEN=...
export REPLICATE_VERSION=...
node tools/replicate-voice-test.js --input tools/replicate-input.json --out /tmp/replicate-result.json
```

Input schema (see `tools/replicate-input.json`):
- `audio`: URL to guide vocal audio.
- `model`: URL or ID of the voice model (provider-specific).

## ElevenLabs Music Test

Requirements:
- Node 18+
- `ELEVENLABS_API_KEY`

Example:
```bash
export ELEVENLABS_API_KEY=...
node tools/elevenlabs-music-test.js --input tools/elevenlabs-input.json --out /tmp/elevenlabs-result.json
```

Input schema (see `tools/elevenlabs-input.json`):
- `prompt`: description for the song.
- `style`: genre/style tag.
- `duration`: length in seconds.
- `lyrics`: lyric text to include.


## npm Scripts

From the repo root:
```bash
cp tools/.env.example .env
npm install
npm run replicate:test
npm run elevenlabs:test
```
