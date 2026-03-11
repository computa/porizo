# Final Arbiter Report: Bug Audit Dispute Resolution

**Date:** 2026-03-06
**Role:** Final arbiter with ground-truth verification
**Input:** Bug Finder report (116 bugs) + Skeptic review (8 disputed)
**Method:** 8 parallel source-code verification agents, plus spot-check of confirmed findings

## Scoring

- +1 point: Correct judgment
- -1 point: Incorrect judgment
- Checked against verified ground truth

---

## Disputed Bug Verdicts

### API-02: Admin impersonation via `x-user-id` header

**Bug Finder's claim:** `debug_user_id` propagates through `app.inject()` into auth middleware at `story.js:843-853`, enabling admin impersonation.

**Skeptic's counter:** Intentional admin tooling. The `x-user-id` header is only processed inside `app.inject()` calls from authenticated admin endpoints gated by `requireAdmin`.

**My analysis:**

Verified the actual code paths:

| Path | Location | External exploitable? | Admin gated? |
|------|----------|-----------------------|--------------|
| `buildInternalDebugFetchOptions` + `app.inject()` | `story.js:843, 979` | No (inject-only) | Yes (`requireV3OrchestrationAdmin`) |
| Debug-loop inline + `app.inject()` | `story.js:1385-1396` | No (inject-only) | Yes (`requireV3OrchestrationAdmin`) |

The `app.inject()` code paths at story.js:843-853 ARE properly gated by `requireV3OrchestrationAdmin`, which validates admin credentials through `adminAuthService`. An external attacker cannot reach these code paths without valid admin authentication. This is standard admin impersonation tooling for support operations.

**Important caveat:** The investigation revealed a SEPARATE, more serious issue: `requireUserId` at `server.js:604-611` accepts `x-user-id` from ANY external HTTP request when `ALLOW_ANON_USER_ID=true` (set in `.env`). This allows unauthenticated impersonation of ANY user on ALL endpoints — but this is a different vulnerability from what API-02 describes. It should be filed as a new finding.

**VERDICT: NOT A BUG** (as specifically described — the story.js admin impersonation is intentional, properly-gated tooling)

**Confidence: High**

---

### API-03: Missing authentication on `PUT /storage/upload`

**Bug Finder's claim:** No verification that the uploader owns the session in the key path at `enrollment.js:130-181`.

**Skeptic's counter:** Presigned URL IS the authentication. Dev-only endpoint.

**My analysis:**

Verified at the source:

1. **Dev-only confirmed** (lines 131-134): Hard `404` returned when `storageProvider.type !== "local"`. Production uses S3, so this endpoint is dead in production.

2. **HMAC authentication exists** (local.js lines 30-33): The presigned URL payload is `purpose | key | expiresAt | contentType`, signed with `UPLOAD_SIGNING_SECRET`. Forgery requires the server secret.

3. **Key prefix restriction** (line 149): `key.startsWith("enrollment/raw/")` — limits writable paths.

4. **No caller identity binding:** The HMAC does not include userId, so a leaked presigned URL is transferable to any caller. This is architecturally noted but is standard for presigned URL systems (S3 presigned URLs work the same way).

The presigned URL signature IS authentication — it proves the server authorized this specific upload to this specific key path. Calling this "missing authentication" mischaracterizes the design. Combined with it being dev-only, this is not a real vulnerability.

**VERDICT: NOT A BUG**

**Confidence: High**

---

### API-04: Path traversal in blend analysis

**Bug Finder's claim:** `userId`/`trackId` from DB used in `path.join()` without containment check at `admin.js:1009-1113`, unlike the `/paths` sibling endpoint.

**Skeptic's counter:** Values come from database query results, not user input. Admin-only endpoint.

**My analysis:**

Verified the code at lines 1031-1042:

```js
const userId = trackVersion.user_id;   // from DB result
const trackId = trackVersion.track_id; // from DB result
const basePath = path.join(process.cwd(), "storage/tracks", userId, trackId, `v${version}`);
```

Key findings:
- The `userId` and `trackId` are from a parameterized DB query result, not from request body/params
- The `/paths` sibling endpoint (lines 1132-1145) DOES have `path.resolve()` + `startsWith(storageRoot)` — confirming the inconsistency the Bug Finder identified
- ID columns are `TEXT PRIMARY KEY` — no UUID format constraint at schema level
- Endpoint is gated by `requireAdminSession`

However: exploiting this requires corrupting the database (inserting path traversal sequences as IDs). Anyone with DB write access already has full system control. The different containment approaches reflect different threat models: `/paths` accepts admin-supplied arbitrary paths; blend-analysis constructs paths from DB records.

**VERDICT: NOT A BUG** (defense-in-depth suggestion, not an exploitable vulnerability — different threat model than the /paths sibling)

**Confidence: Medium** — Borderline. The inconsistency IS real and the fix is trivial, but exploitation requires prior DB compromise, making it theoretical.

---

### API-05: PIN timing oracle in share claim

**Bug Finder's claim:** Plain `!==` comparison instead of `crypto.timingSafeEqual` at `sharing.js:688`. The web-verify endpoint correctly uses constant-time comparison.

**Skeptic's counter:** 5-attempt permanent lockout makes timing oracle infeasible.

**My analysis:**

Verified all facts:

1. **Non-constant-time comparison confirmed** (line 688): `pin !== share.claim_pin` uses plain `!==`
2. **Permanent lockout confirmed**: `claim_attempts` stored in DB row, incremented on failure, never reset (except on successful claim). No TTL, no sliding window.
3. **Web-verify uses `timingSafeEqual` confirmed** (lines 786-787): With an in-memory, time-windowed counter (weaker rate limiting, hence stronger cryptographic comparison)
4. **PIN is 6-digit numeric** (100000-999999, 900,000 possible values)

Timing oracle attacks against remote HTTPS endpoints require tens of thousands to millions of measurements to extract signal from network jitter. With a permanent 5-attempt cap, an attacker gets exactly 5 measurements total — orders of magnitude below the statistical threshold needed.

The code inconsistency (one endpoint uses `timingSafeEqual`, the other doesn't) is explained by the different rate-limiting designs: the share claim has a stronger, permanent DB-backed lockout that compensates for the weaker comparison.

**VERDICT: NOT A BUG** (as a Critical timing oracle vulnerability — the permanent lockout makes it computationally infeasible. Code quality inconsistency at most.)

**Confidence: High**

---

### API-13: Missing `await` on `findTrackVersion` at `routes/tracks.js:1583`

**Bug Finder's claim:** Missing `await` on `findTrackVersion` at `routes/tracks.js:1583` causes endpoint crash for all callers.

**Skeptic's counter:** File `routes/tracks.js` is 1143 lines long. Line 1583 does not exist. Finding was fabricated.

**My analysis:**

Verified both claims:

1. **`routes/tracks.js` is 1142 lines** — line 1583 does not exist. All 9 `findTrackVersion` calls in tracks.js properly use `await`. The Skeptic is correct about tracks.js.

2. **BUT: The bug IS real in `routes/sharing.js`** — confirmed at line 1583:
   ```
   Line 153:  const trackVersion = await findTrackVersion(...)  // correct
   Line 196:  const trackVersion = await findTrackVersion(...)  // correct
   Line 1583: const trackVersion = findTrackVersion(...)        // MISSING AWAIT
   ```

The Bug Finder identified a real crash-causing bug but cited the wrong file. The missing `await` at `sharing.js:1583` means `trackVersion` receives a Promise object instead of the row data, causing downstream property access to fail with `undefined`. This IS a real bug that affects the stream-check code path.

**VERDICT: REAL BUG** (wrong file cited, but the underlying issue exists at `sharing.js:1583` — a missing `await` causing crashes)

**Confidence: High**

---

### DB-01: Migrations never run for workers/tests

**Bug Finder's claim:** `buildServer()` calls `getDatabase()` without `migrationsDir` at `database/index.js:41-44`.

**Skeptic's counter:** Both `buildServer()` and the worker entry point pass `migrationsDir` correctly.

**My analysis:**

Verified all call sites:

| Caller | File | `migrationsDir` provided? |
|--------|------|---------------------------|
| `start()` | `server.js:3246-3249` | YES |
| `startWorker()` | `worker.js:22-24` | YES |
| Tests (6 files) | `test/*.test.js` | No, but SQLite has default fallback to `path.join(cwd, 'migrations')` |

Critical finding: **`buildServer()` does not call `getDatabase()` at all.** It accepts an already-initialized `db` as a parameter. The Bug Finder's premise is factually wrong — `buildServer()` never invokes `getDatabase()`. It is `start()` (the entry point) that calls `getDatabase()` with `migrationsDir` correctly set.

The SQLite adapter has a built-in default for `migrationsDir` when omitted, so test environments work. The PostgreSQL adapter requires explicit `migrationsDir` (no default), but both production entry points provide it.

**VERDICT: NOT A BUG**

**Confidence: High**

---

### SVC-03: Path traversal via `userId`/`sessionId` in enrollment.js

**Bug Finder's claim:** `userId`/`sessionId` at `enrollment.js:33-35` enable path traversal — `../../../etc/passwd` resolves outside storage.

**Skeptic's counter:** `userId` from JWT, `sessionId` DB-validated. Neither user-controllable.

**My analysis:**

Verified the code at lines 33-35:

```js
const chunkDir = storageDir
  ? path.join(storageDir, "enrollment", "raw", userId, sessionId)
  : null;
```

Tracing the call chain:
- `userId` comes from `requireUserId()` → JWT `payload.sub` — server-generated, not user-controllable
- `sessionId` comes from `request.body.session_id` but is immediately validated: `WHERE id = ? AND user_id = ?` (lines 596-601). Only DB-stored UUIDs pass.
- The `chunkDir` is a read-only fallback path that is `null`-guarded and rarely exercised in the normal flow.

The Skeptic is correct for lines 33-35. The values are JWT-derived and DB-validated.

**Note:** The investigation found a SEPARATE vulnerability in the debug upload endpoint (`routes/enrollment.js:524-530`) where `userId` can come from the `x-user-id` header (when `ALLOW_ANON_USER_ID=true`) and flows unsanitized into `path.join`. This is a different code path not covered by SVC-03.

**VERDICT: NOT A BUG** (at the specifically cited location)

**Confidence: High**

---

### BILL-10: `prepare().get()` breaks PostgreSQL

**Bug Finder's claim:** `getActiveSubscription`/`getEntitlements`/`createFreeEntitlements` use synchronous SQLite API that breaks on PostgreSQL.

**Skeptic's counter:** Compatibility shim exists at `postgres.js:196-226`.

**My analysis:**

Verified the shim at `postgres.js:196-226`:

```js
function prepare(sql) {
  let paramIndex = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  return {
    get: async (...params) => {
      const result = await query(pgSql, params);
      return result.rows[0];
    },
    all: async (...params) => { /* ... */ },
    run: async (...params) => { /* ... */ },
  };
}
```

The shim:
1. Converts `?` placeholders to PostgreSQL `$N` positional syntax
2. Returns async `.get()`, `.all()`, `.run()` methods that delegate to the pool's `query()`
3. All call sites in subscription-manager.js correctly `await` the results

The pattern `await db.prepare(sql).get(...args)` works because `prepare()` returns synchronously (the shim object), then `.get()` returns a Promise, which `await` resolves. This is valid JavaScript and works correctly on both SQLite and PostgreSQL.

**VERDICT: NOT A BUG**

**Confidence: High**

---

## Verdict Summary

| Bug ID | Bug Finder | Skeptic | Arbiter Verdict | Winner |
|--------|-----------|---------|-----------------|--------|
| API-02 | Admin impersonation via x-user-id | Intentional admin tooling | **NOT A BUG** | Skeptic |
| API-03 | Missing auth on upload | Presigned URL IS auth, dev-only | **NOT A BUG** | Skeptic |
| API-04 | Path traversal in admin | DB values, admin-only | **NOT A BUG** | Skeptic |
| API-05 | PIN timing oracle | 5-attempt permanent lockout | **NOT A BUG** | Skeptic |
| API-13 | Missing await (tracks.js:1583) | Line doesn't exist | **REAL BUG** (wrong file: sharing.js:1583) | Bug Finder |
| DB-01 | Migrations never run | migrationsDir passed correctly | **NOT A BUG** | Skeptic |
| SVC-03 | Path traversal enrollment | JWT/DB-validated values | **NOT A BUG** | Skeptic |
| BILL-10 | prepare().get() breaks PG | Compatibility shim exists | **NOT A BUG** | Skeptic |

**Disputed findings resolved:** 7 Skeptic wins, 1 Bug Finder win

---

## Spot-Check of Accepted Findings

To validate the Skeptic's acceptances, I verified two confirmed critical bugs:

### AUTH-01: Missing `await` on logout token revocation
**Verified at `auth.js:850`:**
```js
authService.revokeAllRefreshTokensForUser(payload.sub);  // NO await
```
**Confirmed REAL.** The revocation is fire-and-forget. If the async operation fails or hasn't completed by the time the response is sent, stolen refresh tokens remain usable after logout.

### AUTH-02: Missing `await` on password reset revocation
**Verified at `auth.js:940-941`:**
```js
authService.revokeAllRefreshTokensForUser(userId);           // NO await
authService.compromiseAllTokenFamiliesForUser(userId);       // NO await
```
**Confirmed REAL.** Both security-critical operations are fire-and-forget. Old sessions can survive a password change if these async operations fail silently.

The Skeptic's acceptances of these findings were correct.

---

## New Findings Discovered During Arbitration

The verification process uncovered issues not in the original audit:

| New ID | Location | Severity | Description |
|--------|----------|----------|-------------|
| NEW-01 | `server.js:604-611` | **CRITICAL** | `requireUserId` accepts `x-user-id` header from ANY external HTTP request when `ALLOW_ANON_USER_ID=true` (set in `.env`). Allows unauthenticated impersonation of any user on ALL endpoints. Broader than API-02's admin-tooling claim. |
| NEW-02 | `routes/enrollment.js:524-530` | Medium | Debug upload endpoint passes unsanitized `userId` (from `x-user-id` header when `ALLOW_ANON_USER_ID=true`) into `path.join`. Real path traversal — different code path than SVC-03's cited location. |
| API-13-CORRECTED | `routes/sharing.js:1583` | Critical | Missing `await` on `findTrackVersion` — confirmed at correct location. Causes crash (Promise object instead of row data). |

---

## Revised Final Tally

### Original Audit
- 116 findings, 523 points

### After Skeptic Review
- 108 findings, 453 points (8 disproved)

### After Arbiter Review
- 1 of 8 Skeptic dismissals overturned (API-13 — bug exists at corrected location)
- **109 confirmed bugs** from original audit
- **3 new findings** discovered during arbitration
- **112 total verified bugs**

### Severity Distribution (Final)

| Severity | Count | Points |
|----------|-------|--------|
| Critical | 17 (16 confirmed + API-13 restored) | 170 |
| Medium | 49 | 245 |
| Low | 43 | 43 |
| New Critical (NEW-01) | 1 | 10 |
| New Medium (NEW-02) | 1 | 5 |
| **Total** | **112** | **473** |

---

## Methodology Notes

- Each disputed bug was verified by a dedicated agent reading actual source code at the cited locations
- Agents traced data flow from route handlers through middleware to determine actual values at runtime
- Line counts were verified to confirm or deny cited locations
- Cross-references between similar code paths (e.g., web-verify vs share-claim PIN comparison) were checked
- Call site analysis traced parameter origins (JWT, DB query, request body) to determine controllability

## Confidence Distribution

| Level | Count | Bugs |
|-------|-------|------|
| High | 7 | API-02, API-03, API-05, API-13, DB-01, SVC-03, BILL-10 |
| Medium | 1 | API-04 (borderline — inconsistency is real but exploitation requires DB compromise) |
