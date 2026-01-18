# Track + Lyrics Flow Design (Revised for MVP Alignment)

**Date:** 2026-01-01  
**Revision:** 2026-01-02  
**Status:** Proposed (aligns with current MVP API + constraints)  
**Author:** Brainstorming session + revision

---

## Goals and Constraints

- **Message-first:** memory + recipient name anchor the chorus.
- **User-voice output:** preview and full renders must use voice conversion (no guide-only output).
- **Share once with device claim:** first app claim binds a share token to a device.
- **App-only saving:** HLS encryption keys only served to bound device.
- **Auditability:** params_hash + provenance + watermark on all deliverables.

---

## End-to-End Flow (MVP)

```
MEMORY CAPTURE -> TRACK DRAFT -> VERSION CREATE -> LYRICS -> PREVIEW -> FULL -> SHARE
```

1) **Memory capture (client-side form)**
   - Collect: recipient_name, occasion, message, relationship_type, years_known, specific_memory, special_phrases, what_makes_them_special.
   - Optional AI follow-up questions (future enhancement; MVP can be static prompts).

2) **Create draft track**
   - `POST /tracks` with story context + metadata (see API section).
   - Track stays in `draft` until a version is created.

3) **Create a version for lyrics + preview**
   - `POST /tracks/:id/versions` with `render_type=preview` and `params`.
   - Version is the unit of reproducibility and audit (params_hash).

4) **Generate lyrics**
   - `POST /tracks/:id/versions/:version/lyrics/generate`
   - Lyrics are stored on the version; status is `draft` or `fallback`.

5) **User edits and approval**
   - Edit lines: `PUT /tracks/:id/versions/:version/lyrics` with full lyrics object.
   - Approve: `POST /tracks/:id/versions/:version/lyrics/approve`
   - Moderation occurs on approval.

6) **Preview render (voice-converted)**
   - `POST /tracks/:id/versions/:version/render_preview`
   - Job is created; poll via `GET /jobs/:id`.
   - Output includes a voice-converted chorus preview plus watermark.

7) **Full render (voice-converted)**
   - `POST /tracks/:id/versions/:version/render_full` with `confirm_credit_spend: true`
   - Requires preview completion; uses billing hold + audit log.

8) **Share**
   - `POST /tracks/:id/share` creates share token (only once).
   - Recipient flow: `GET /share/:id`, `POST /share/:id/claim`, `GET /share/:id/stream`.
   - App-only save uses `/share/:id/key` for bound device.

---

## Memory Capture Details

### Core Questions (MVP)

| # | Question | Storage |
|---|----------|---------|
| 1 | Who is this for? | `recipient_name` |
| 2 | What is the occasion? | `occasion` |
| 3 | What ONE memory do you want this song to capture? | `story_context_json.specific_memory` |
| 4 | What makes them special? | `story_context_json.what_makes_them_special` |
| 5 | Any special phrases or nicknames? | `story_context_json.special_phrases` |

### Optional Follow-ups (Post-MVP)
- Generated questions can be stored in `story_context_json` or a new `memory_questions_json` field.
- Re-moderate any AI-generated prompts + user answers.

### Minimal Memory Question API (Optional Extension)
- `POST /tracks/:id/memory/questions` returns the next AI-generated question or `null`.
- `PUT /tracks/:id/memory/answers` stores `{ question_id, answer }` and updates `story_context_json`.
- All answers must be re-moderated; reject on moderation block.

### Minimal Memory Question API (Optional Extension)
- If we need AI follow-ups during MVP, add a minimal pair of endpoints:
  - `POST /tracks/:id/memory/questions` returns the next AI-generated question (or `null` if complete).
  - `PUT /tracks/:id/memory/answers` stores `{ question_id, answer }` and updates `story_context_json`.
- All inputs must be moderated; writes should be rejected if moderation blocks.

---

## Lyrics Structure (MVP target: 45-60 seconds)

- Chorus (anchor line + recipient name)
- Verse 1 (scene setting + relationship)
- Verse 2 (memory detail)
- Optional bridge or outro

**Singability guardrails:** 6-12 syllables per line, max 4-6 lines per section.

---

## Lyrics Iteration and Rerolls

### Edits
- Client edits the lyrics object and saves with `PUT /tracks/:id/versions/:version/lyrics`.
- Approval re-checks moderation and locks lyrics.

### Rerolls (Version-based)
- Use `POST /tracks/:id/versions/:version/reroll` to create a new version.
- MVP: reroll is full-version only (no section-only reroll).
- Future: add `reroll_type` and `section` in params to support partial rerolls.

### Reroll Limits (MVP)
- Full reroll: 10 per track (rate limit + entitlement rules).
- Line edits: unlimited (client-side).

---

## Pricing Model (MVP)

| Action | Cost |
|--------|------|
| Memory capture | Free |
| Lyrics generation | Free |
| Preview render (voice-converted) | Free (daily limits) |
| Full render (voice conversion) | 1 credit |

---

## API Endpoints (Aligned to Current MVP Server)

### Track and Version
```
POST /tracks
  Body: { recipient_name, occasion, message, style, duration_target, voice_mode, story_context_json }

POST /tracks/:id/versions
  Body: { render_type: "preview", params: { ... } }
```

**Examples**

```json
// POST /tracks
{
  "recipient_name": "Sarah",
  "occasion": "anniversary",
  "message": "Thank you for every rainy night",
  "style": "pop",
  "duration_target": 60,
  "voice_mode": "user_voice",
  "story_context_json": {
    "relationship_type": "partner",
    "years_known": 6,
    "specific_memory": "dancing in the rain in Paris",
    "special_phrases": "my sunshine",
    "what_makes_them_special": "how you always show up for me"
  }
}
```

```json
// 201 response
{
  "track_id": "b2c9b8b4-9d3f-4f7f-9f4a-b5f0d3a4f8f1",
  "status": "draft",
  "voice_mode": "user_voice",
  "created_at": "2026-01-02T02:15:04.120Z"
}
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 403 | ACCOUNT_BLOCKED | User is blocked |
| 403 | VOICE_PROFILE_REQUIRED | user_voice selected without enrollment |
| 403 | VOICE_MODE_DISABLED | High-risk account |
| 403 | MODERATION_BLOCKED | Prompt blocked |
| 429 | RATE_LIMITED | Track creation limit exceeded |

```json
// POST /tracks/:id/versions
{
  "render_type": "preview",
  "params": {
    "style": "pop",
    "tempo_bpm": 92,
    "prosody_preset": "heartfelt"
  }
}
```

```json
// 201 response
{
  "track_version_id": "e3b5b4c1-2d8a-4f3e-b5c0-4d6d5e0b1f2a",
  "version_num": 1,
  "params_hash": "f87a6c1f...",
  "cost_estimate": { "credits": 1, "usd": 0.15 },
  "status": "queued"
}
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 404 | TRACK_NOT_FOUND | Track not found |
| 409 | DUPLICATE_PARAMS | Version with identical params exists |

### Lyrics
```
POST /tracks/:id/versions/:version/lyrics/generate
PUT  /tracks/:id/versions/:version/lyrics
POST /tracks/:id/versions/:version/lyrics/approve
```

**Examples**

```json
// POST /tracks/:id/versions/:version/lyrics/generate
{}
```

```json
// 200 response
{
  "lyrics": {
    "title": "Paris Rain",
    "style": "pop",
    "sections": [
      { "name": "chorus", "lines": ["Dancing in the rain, Sarah", "Every drop feels like champagne"] },
      { "name": "verse1", "lines": ["Paris summer on cobblestone", "We forgot the reservations"] },
      { "name": "verse2", "lines": ["You laughed under cafe lights", "I knew it felt like forever"] }
    ],
    "anchor_line": "Dancing in the rain, Sarah"
  },
  "lyrics_status": "generated"
}
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 404 | TRACK_NOT_FOUND | Track not found |
| 404 | VERSION_NOT_FOUND | Version not found |
| 429 | RATE_LIMITED | Lyrics generation limit exceeded |

```json
// PUT /tracks/:id/versions/:version/lyrics
{
  "lyrics": {
    "title": "Paris Rain",
    "style": "pop",
    "sections": [
      { "name": "chorus", "lines": ["Dancing in the rain, Sarah", "Every drop feels like champagne"] },
      { "name": "verse1", "lines": ["Paris summer on cobblestone", "We missed the dinner reservation"] },
      { "name": "verse2", "lines": ["You laughed under cafe lights", "I knew it felt like forever"] }
    ],
    "anchor_line": "Dancing in the rain, Sarah"
  }
}
```

```json
// 200 response
{ "updated": true }
```

```json
// POST /tracks/:id/versions/:version/lyrics/approve
{}
```

```json
// 200 response
{ "approved": true }
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 403 | MODERATION_BLOCKED | Lyrics failed moderation |
| 404 | TRACK_NOT_FOUND | Track not found |
| 404 | VERSION_NOT_FOUND | Version not found |
| 409 | LYRICS_MISSING | No lyrics to approve |

### Preview + Full Render
```
POST /tracks/:id/versions/:version/render_preview
POST /tracks/:id/versions/:version/render_full  (confirm_credit_spend: true)
GET  /jobs/:id
```

**Examples**

```json
// POST /tracks/:id/versions/:version/render_preview
{}
```

```json
// 202 response
{
  "job_id": "4b36b171-89f9-49b0-9d8f-7b3a3a937e2f",
  "estimated_completion_sec": 90,
  "poll_url": "/jobs/4b36b171-89f9-49b0-9d8f-7b3a3a937e2f"
}
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 403 | MODERATION_BLOCKED | Version blocked |
| 409 | LYRICS_NOT_APPROVED | Lyrics not approved |
| 409 | ALREADY_RENDERING | Render already in progress |
| 429 | RATE_LIMITED | Preview limit exceeded |
| 402 | DAILY_LIMIT_REACHED | Preview entitlements exhausted |

```json
// POST /tracks/:id/versions/:version/render_full
{ "confirm_credit_spend": true }
```

```json
// 202 response
{
  "job_id": "f5a836df-1c0c-4b93-9f46-538c7b6a9e14",
  "billing_hold_id": "b0b9f88f-2161-4c75-9a1f-7dcaefbdc8d6",
  "credits_reserved": 1,
  "estimated_completion_sec": 180
}
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 403 | PREVIEW_ONLY_MODE | Full renders disabled |
| 409 | PREVIEW_REQUIRED | Preview not complete |
| 402 | INSUFFICIENT_CREDITS | User lacks credits |
| 409 | ALREADY_RENDERING | Render already in progress |

```json
// GET /jobs/:id (example response)
{
  "job_id": "4b36b171-89f9-49b0-9d8f-7b3a3a937e2f",
  "status": "completed",
  "step": "ready",
  "output": {
    "preview_url": "https://cdn.porizo.example/preview.m4a"
  }
}
```

### Share
```
POST /tracks/:id/share
GET  /share/:id
POST /share/:id/claim
GET  /share/:id/stream
GET  /share/:id/key
```

**Examples**

```json
// POST /tracks/:id/share
{ "version_num": 1, "expires_in_days": 30 }
```

```json
// 200 response
{
  "share_id": "Abc123xyz",
  "share_url": "https://app.porizo.example/s/Abc123xyz",
  "expires_at": "2026-02-01T00:00:00Z"
}
```

```json
// GET /share/:id (unbound response)
{
  "status": "unbound",
  "track_preview": { "title": "Paris Rain", "duration_sec": 58 },
  "web_stream_url": "https://cdn.porizo.example/stream/...",
  "app_download_url": "https://app.porizo.example/download"
}
```

```json
// POST /share/:id/claim
{ "device_id": "ios-idfv-123", "platform": "ios", "app_version": "1.0.0" }
```

```json
// GET /share/:id/stream (bound device)
{ "stream_url": "https://cdn.porizo.example/hls/...", "expires_at": "2026-01-02T04:15:00Z" }
```

```json
// GET /share/:id/key (bound device)
{ "key": "base64-key", "expires_at": "2026-01-02T04:15:00Z" }
```

**Common errors**

| HTTP | Code | Meaning |
|------|------|---------|
| 409 | SHARE_EXISTS | Track already has a share token |
| 404 | VERSION_NOT_FOUND | Requested version missing |
| 403 | TOKEN_ALREADY_BOUND | Share already claimed on another device |
| 403 | NOT_CLAIMED | Token not claimed yet |
| 404 | SHARE_NOT_FOUND | Invalid share token |

---

## Moderation and Safety

- **Memory input:** moderate on `POST /tracks` and on any future update endpoints.
- **Lyrics:** re-moderate on approval and after any user edits.
- **Impersonation:** block “sound like X” patterns at track creation.

---

## Rate Limits and Entitlements (MVP)

| Action | Limit | Notes |
|--------|-------|-------|
| POST /tracks | 20/hour | Per-user rate limit |
| POST /tracks/:id/versions/:version/lyrics/generate | 30/min | Prevent LLM abuse |
| POST /tracks/:id/versions/:version/render_preview | 20/day | Free preview allowance |
| GET /jobs/:id | 60/min | Polling limit |

Entitlements:
- Preview usage should decrement daily preview count.
- Full render requires 1 credit and creates a billing hold.

---

## Client Polling and Retry Guidance

- **Preview/full render:** poll `GET /jobs/:id` every 2-4 seconds, back off to 8-12 seconds after 30 seconds.
- **Max wait:** 4 minutes for preview, 6 minutes for full render.
- **Timeout handling:** show a retry option and persist job id so the client can resume polling later.

---

## Data Retention and Privacy (MVP)

| Artifact | Storage | Retention | Notes |
|----------|---------|-----------|-------|
| Memory answers | `tracks.story_context_json` | Until user deletion | Treat as sensitive |
| Lyrics drafts | `track_versions.lyrics_json` | Until user deletion | Re-moderate on edit |
| Preview output | `tracks/.../preview.m4a` | Until user deletion | Watermarked |
| Full output | `tracks/.../master.m4a` | Until user deletion | Watermarked |
| Guide vocal | `tracks/.../guide_vocal.wav` | 7 days | Internal only |
| Audit logs | `audit_logs` | 7 years | Compliance |

---

## Auditability and Provenance

- Each version stores `params_json`, `params_hash`, `lyrics_json`, and job records.
- Render outputs include watermark and provenance JSON.
- All render requests logged via audit entries.

---

## Draft Persistence (Optional, Post-MVP)

If drafts need true step-by-step persistence:
- Add `draft_expires_at` and `draft_step` to `tracks`.
- Add a cleanup job for expired drafts.
- Introduce `PUT /tracks/:id` to update story context during capture.

---

## Implementation Checklist (MVP, Server-Aligned)

- `POST /tracks` accepts memory fields and builds `story_context_json` (handler in `src/server.js`).
- `POST /tracks/:id/versions` sets `params_hash` and `render_type`, creates a version (handler in `src/server.js`).
- `POST /tracks/:id/versions/:version/lyrics/generate` calls `generateLyrics` and stores `lyrics_json` (handler in `src/server.js`, generator in `src/providers/lyrics.js`).
- `PUT /tracks/:id/versions/:version/lyrics` updates `lyrics_json` and resets status to `draft`.
- `POST /tracks/:id/versions/:version/lyrics/approve` re-moderates lyrics and locks status.
- `POST /tracks/:id/versions/:version/render_preview` and `/render_full` create jobs and update status.
- `GET /jobs/:id` exposes job status for polling.
- `POST /tracks/:id/share`, `POST /share/:id/claim`, `GET /share/:id/stream`, and `GET /share/:id/key` implement share-once + device bind.

---

## Open Questions

1) Do we add memory-question endpoints now, or keep memory capture fully client-side for MVP?
2) When do we add section-level rerolls (new schema + params)?
3) Should preview be limited to chorus-only in MVP, or allow 30-45s for quality?
