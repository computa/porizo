# Reviewer: performance (workflows + routes + server)

## Findings (10 total)

### HIGH

1. **[HIGH] src/workflows/runner.js:5466 — Stale-job recovery runs on every poll tick**
   - Issue: `recoverStaleVoiceProviderJobs` (2 UPDATE queries) called inside `tickVoiceProviderJobs` on every 1s tick, regardless of whether stale jobs exist. There's already a separate `recoveryTimer` (line 2071) on a much slower interval (~2.5min default) handling other queues. Voice-provider lane bypasses that pattern.
   - Impact: 7,200 UPDATEs/hour against `voice_provider_jobs` even with zero stale work. Adds steady DB write load and contention with persona-job worker. Compounds on Railway PG with WAL replication.
   - Fix: Move `recoverStaleVoiceProviderJobs` out of `tickVoiceProviderJobs` and onto existing `recoveryTimer`. OR gate: only run if `Date.now() - lastRecoveryAt > 30000`.

2. **[HIGH] src/routes/tracks.js:438-463 — GET /tracks has no pagination or LIMIT**
   - Issue: `SELECT t.*, tle.* FROM tracks t JOIN track_library_entries tle ... ORDER BY tle.added_at DESC` returns user's entire library with no LIMIT/OFFSET/cursor. Combined with `hydrateTrackCoverImages` which then does `SELECT * FROM track_versions WHERE track_id IN (...)` (full row including large JSON columns: `lyrics_json`, `params_json`, `provenance_json`, `music_plan_json`).
   - Impact: Power users with hundreds of tracks load multi-MB responses (~10KB per version × 5 versions × 200 tracks = 10MB). Blows past 200ms p95 SLO and consumes server memory per request.
   - Fix: Add `LIMIT 50 OFFSET ?` (or cursor on `added_at`). In `hydrateTrackCoverImages`, project only `track_id, version_num, cover_image_url, cover_image_small_url, cover_image_large_url`.

3. **[HIGH] src/server.js:3814-3829 — `hydrateTrackCoverImages` selects entire track_versions rows**
   - Issue: `SELECT * FROM track_versions WHERE track_id IN (...)` then uses only 3 cover-image fields. Full row includes `lyrics_json`, `params_json`, `music_plan_json`, `provenance_json`, `cost_estimate_json`, `actual_cost_json`.
   - Impact: Per /tracks call, returns 5–50× more data over the wire from PG than needed.
   - Fix: `SELECT track_id, version_num, cover_image_url, cover_image_small_url, cover_image_large_url FROM track_versions WHERE track_id IN (...) AND version_num = latest_version`. Filter on latest version directly.

4. **[HIGH] src/routes/enrollment.js:97 + 601 — Synchronous `fs.readFileSync` of multi-MB WAV blocks event loop**
   - Issue: `deriveVocalWindow` reads multi-MB clean WAV synchronously on request path of `/enrollment/complete`. Same in chunk-upload at line 601 (`parseWavBuffer(fs.readFileSync(localPath))`).
   - Impact: 5MB WAV read on busy event loop stalls every other API request for ~10–50ms (filesystem-dependent). Multiple concurrent enrollments compound. Hits API p95 < 200ms target on co-located endpoints.
   - Fix: Switch to `await fs.promises.readFile(...)` OR stream-parse the WAV header (RIFF header is in first 44 bytes — no need to load whole buffer to read duration). For chunks, only header is needed.

5. **[HIGH] src/server.js:4309 — R2 audio proxy buffers entire file into memory**
   - Issue: `serveTrackAudio` does `Buffer.from(await r2Response.arrayBuffer())` then `reply.send(buffer)`. Holds full audio (1–5MB per track) in memory until response flushed.
   - Impact: With N concurrent listeners, peak memory = N × full_song_size. 50 concurrent streams × 4MB = 200MB heap pressure. Range requests serialize through this path. **Defeats point of HLS/range streaming.**
   - Fix: Fastify supports streaming responses. Pipe `r2Response.body` (Web ReadableStream) directly: `reply.send(r2Response.body)`. Forward Range/Content-Range headers as already done.

### MEDIUM

6. **[MEDIUM] src/providers/http.js:75,97,160 — All binary fetches buffer entire response**
   - Issue: `fetchBinary`, `fetchBinaryWithHeaders`, `downloadToFile` all do `Buffer.from(await response.arrayBuffer())`. `downloadToFile` then `fs.writeFileSync(buffer)` — both buffer + sync write.
   - Impact: For Suno music (~3-5MB), Replicate, ElevenLabs downloads: each holds full file in heap before writing. 3 concurrent renders × 4 downloads × 4MB = ~50MB peak heap. Increases retry/restart frequency.
   - Fix: In `downloadToFile`, pipe response body to `fs.createWriteStream(outputPath)` after validating headers. Save heap, remove blocking `fs.writeFileSync`.

7. **[MEDIUM] src/workflows/runner.js:587-596 — Sequential `getFeatureFlag` calls in voice-conversion path**
   - Issue: Seedvc path issues 7 sequential awaits: `seedvc_cfg_rate`, `seedvc_diffusion_steps_*`, `seedvc_auto_f0_adjust`, `seedvc_f0_condition`, `seedvc_pitch_shift`, `timbre_blend_ratio`, `timbre_cfg_rate`. Cached, but on cache miss = 7 round-trips.
   - Impact: On runner restart (cold cache), adds ~50–150ms to first render of each kind. Compounds with similar pattern at line 522-524 (elevenlabs flags) and elsewhere.
   - Fix: Use `getFeatureFlags(db, [...])` (already imported) once. Same speed warm, much faster cold.

8. **[MEDIUM] src/services/suno-voice-persona-service.js — `assertProviderJobStillAllowed` runs 3 SELECTs, called 6+ times per persona job**
   - Issue: Each call issues 3 DB reads (`getVoiceProviderJobById`, `getProviderProfileById`, `getEnrollmentSession`) plus `voice_profiles` SELECT in `assertProviderJobReady`. Called between every step.
   - Impact: 18–24 DB reads per persona job execution just for cancellation propagation. Background worker so doesn't hit API SLO; during fan-out (multiple voice profiles enrolling at once) adds noticeable PG load.
   - Fix: Combine 3 lookups into single JOIN query when possible. OR relax cadence — check before each external API call (3 instead of 6 times).

9. **[MEDIUM] src/workflows/runner.js:5337-5359 — N+1 in tick when blockedUserIds is non-empty**
   - Issue: Candidate-filter loop does `await getTrackVersion.get(job.track_version_id)` then `await getTrack.get(tv.track_id)` per candidate. Sequential. `fetchLimit = availableSlots + blockedUserIds.size`.
   - Impact: With 5 blocked users and 3 slots, fetches 8 candidates × 2 reads = 16 sequential reads inside a 1s tick that should complete in <50ms. Backs up polling cadence.
   - Fix: Batch with `IN (?)`: collect `track_version_id`s, do one `SELECT tv.id, t.user_id FROM track_versions tv JOIN tracks t ... WHERE tv.id IN (...)`. OR denormalize `user_id` onto `jobs` table.

### SUGGESTION

10. **[SUGGESTION] src/server.js:750-769 — `ensureUser` does 2 DB reads on every authenticated request**
    - Issue: `requireUserId` calls `ensureUser` which always does `SELECT FROM users` + `SELECT FROM entitlements`. Pre-existing (not from this diff), but hot path: 85 callsites.
    - Impact: At 60 RPS sustained, 120 DB reads/sec just for auth. Railway PG round-trip ~3-10ms each = ~300ms/sec wasted DB time, consumes connections.
    - Fix: Tiny in-memory LRU keyed by userId with 60s TTL. Skip both selects when present. Idempotent (INSERT ON CONFLICT covers race).
