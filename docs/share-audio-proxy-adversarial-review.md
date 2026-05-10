# Share-audio proxy — adversarial review (2026-05-10)

Pressure-testing `serveTrackAudio` after switching from `Readable.fromWeb` streaming to buffered `arrayBuffer()`. Goal: find the next way this code can fail silently and either fix it or capture it as a known risk.

## Threat model

The proxy sits between R2 (storage) and untrusted browser clients. It's reached via `/share/:id/audio` after the share-token auth check passes. Once a client has a valid share token, they can hit the audio endpoint as many times as they want.

| Attacker capability         | Fix scope                                                      |
| --------------------------- | -------------------------------------------------------------- |
| Forge share token           | Out of scope — share-token auth is upstream of this code       |
| Choose `Range` header       | In scope — must not crash or leak                              |
| Spam requests for one track | In scope — must not OOM or burn unbounded R2 egress            |
| Influence upstream key/file | Out of scope — keys are derived server-side from track/version |

## Failure modes — analysis + status

### 1. ✅ FIXED: Silent zero-body response (today's bug)

**Mechanism:** `Readable.fromWeb(r2Response.body)` emits 0 bytes under Node 20 + Fastify 4.29 + undici. Headers were correct, body was empty. Status 200 with `Content-Length: 0`.

**Why silent:** No error log, browsers showed generic "Unable to play this audio." Cloudflare cached the bad response (`Cache-Control: public, max-age=3600`) so the failure was sticky.

**Fix shipped:** `Buffer.from(await r2Response.arrayBuffer())` + Fastify recomputes Content-Length truthfully from the buffer.

**Hardening shipped:**

- `BYTE_MISMATCH` warning when upstream Content-Length ≠ actual buffer length
- `EMPTY_BODY` → 502 STORAGE_EMPTY (instead of silent 200/empty)
- Contract test (`test/share-audio-proxy.test.js`) — empirically catches a regression that returns zero bytes
- Synthetic probe (`scripts/probe-share-audio.mjs`) — runs every 4h via launchd, exits non-zero on any byte-flow failure

### 2. ✅ FIXED: Memory pressure / OOM via oversized upstream

**Mechanism:** Buffering means the full upstream payload is in RAM until the response completes. A misuploaded 1 GB file would OOM the dyno (Railway small dyno = 512 MB).

**Fix shipped:** 50 MB cap on upstream Content-Length. Files larger than 50 MB get rejected with `STORAGE_OVERSIZED` 502 instead of triggering OOM. 50 MB covers the largest plausible full master with 4× headroom — current full m4a outputs are 2-3 MB.

### 3. 🟡 ATTEMPTED, REVERTED: HEAD upstream optimization

**Mechanism:** Fastify auto-handles HEAD by running the GET handler and stripping the body downstream — but our handler still does a GET upstream and downloads the full body to throw away.

**Attempted fix (reverted):** Use HEAD upstream for HEAD requests. Failed because R2 presigned URLs are signed for the GET method specifically — sending HEAD against a GET-signed URL returns 403 Forbidden. R2 fell to our 404 AUDIO_NOT_FOUND branch, breaking HEAD entirely.

**Decision:** Keep GET upstream always. HEAD requests are rare from real audio elements (browsers GET first then range). The R2 egress cost on HEAD is acceptable given the rarity. To revisit, we'd need a `createPresignedHead` helper in the storage layer.

### 4. ✅ FIXED: 416 Range Not Satisfiable was coerced to 404

**Mechanism:** `if (!r2Response.ok && r2Response.status !== 206)` returned 404 for any non-200/206 — including 416 (Range Not Satisfiable). A client doing a probe with `Range: bytes=999999999-` got "audio not found" instead of "range invalid."

**Fix shipped:** 416 passes through verbatim with `Content-Range` header.

### 5. 🟡 ACCEPTED RISK: Concurrency memory pressure

**Mechanism:** Each in-flight request holds its full upstream payload in memory. 100 concurrent listeners on a viral track × 3 MB = 300 MB peak RAM — within budget for a 512 MB dyno but uncomfortable.

**Mitigation (not yet implemented):**

- Cloudflare cache (`max-age=3600`) absorbs most repeats. Real R2 hits should be ~1/track-per-hour from the edge.
- The `iniflight` gauge: if we ever see Railway approaching memory limits, revisit streaming with a _known-good_ implementation (`stream.pipeline(r2Response.body, reply.raw)` with proper error handling).

**Tracking:** TODO if production traffic hits ~1k concurrent share players.

### 6. 🟡 ACCEPTED RISK: R2 truncation (correct length, partial body)

**Mechanism:** R2 advertises `Content-Length: 2290638` but only delivers 1.5 MB before connection closes mid-`arrayBuffer()`. Currently undici throws → caught by `try/catch` → 502.

If undici doesn't throw and returns a short buffer, our `BYTE_MISMATCH` warning fires but we still ship the partial data. Browsers may play the prefix before erroring.

**Decision:** Acceptable. Partial data is better than nothing for users; the warning makes the partial visible in logs. A stricter "block partial" mode could be added if it becomes a problem.

### 7. 🟡 ACCEPTED RISK: Cache poisoning of error responses

**Mechanism:** `sendError` returns JSON without explicit `Cache-Control`. Cloudflare default behavior on 4xx/5xx with no Cache-Control is generally not to cache, but edge configs vary.

**Mitigation:** Already added `Cache-Control: no-store` on the 416 response. The other error paths (`AUDIO_NOT_FOUND`, `STORAGE_EMPTY`, `STORAGE_OVERSIZED`, `STORAGE_ERROR`) inherit Fastify defaults. If we observe stale errors in production, revisit `sendError` to set `Cache-Control: no-store` for all error responses.

### 8. 🟡 NOTED: No upstream conditional headers forwarded

**Mechanism:** We only forward `Range`. We don't forward `If-None-Match`, `If-Modified-Since`, `If-Range`. R2 may return 304s that our proxy doesn't get to see, costing extra round-trips.

**Decision:** Low impact. Audio files are static; client cache (`max-age=3600`) avoids most re-requests anyway. Add forwarding only if measurements show otherwise.

### 9. 🟡 NOTED: No rate limit on `/share/:id/audio`

**Mechanism:** Documented as intentional (route comment: "No rate limit on playback — serving a cached audio file costs nothing"). True for our own bytes; not true for R2 egress costs if a malicious client spams.

**Decision:** Cloudflare caches the 200 response for 3600s, so most repeat hits don't reach origin. If we see anomalous R2 egress, add a per-token soft limit (e.g., 1000 hits/hour).

### 10. ✅ COVERED: Slow-trickle DoS

**Mechanism:** R2 sends bytes at 1 KB/s, holding the proxy connection open and tying up dyno resources.

**Fix in place:** `AbortSignal.timeout(30_000)` aborts after 30s. fetch throws → caught → 502 STORAGE_ERROR.

## Open follow-ups (not blocking)

| #   | Item                                                                   | Trigger to act                               |
| --- | ---------------------------------------------------------------------- | -------------------------------------------- |
| 5   | Streaming with `pipeline()` for memory headroom                        | If concurrent listeners >1k or memory alerts |
| 7   | `Cache-Control: no-store` on all error paths                           | If we see stale errors in production         |
| 8   | Forward conditional headers                                            | If R2 egress spikes                          |
| 9   | Per-token soft rate limit                                              | If R2 egress shows anomalous spikes          |
| —   | Rotate canary share token to a dedicated long-lived "monitoring" track | Within 30 days                               |

## Contracts now enforced

| Contract                       | Mechanism                                                    |
| ------------------------------ | ------------------------------------------------------------ |
| Bytes flow end-to-end          | Contract test `share-audio-proxy.test.js` + production probe |
| Empty body never silently 200s | `EMPTY_BODY` → 502 STORAGE_EMPTY                             |
| Content-Length matches body    | `BYTE_MISMATCH` warning log + Fastify recomputes from buffer |
| Oversized files don't OOM      | `OVERSIZED` → 502 STORAGE_OVERSIZED at 50 MB                 |
| Slow upstream eventually fails | `AbortSignal.timeout(30_000)`                                |
| Range failures are honest      | 416 passes through with Content-Range                        |
| HEAD doesn't waste R2 egress   | Upstream HEAD short-circuit                                  |
