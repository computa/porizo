# Feature 1 — App-Only Share Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shared songs from being playable in a web browser so the only way a recipient hears the full song is to install the Porizo app and claim it (device binding), while preserving social-unfurl rich previews and all in-app streaming.

**Architecture:** Two layers of enforcement. (1) **Source layer:** the public preview routes can only ever yield the short preview — the full master is unreachable except through the device-token-gated HLS path. (2) **Gate layer:** non-demo shares requested by a browser (no app context) are refused at `/audio`, `/teaser`, and `/stream`; the social `share.mp4` is capped to a ≤15s preview-sourced teaser with a new cache key. Demo shares (`share_type='demo'`, admin-only) and in-app requests are exempt. A final client task swaps the broken-player UX for a clean "Open in Porizo" app-wall.

**Tech Stack:** Node.js, Fastify, `node:test` + `app.inject`, SQLite (`:memory:`) test DB via `initDb`, ffmpeg child process for `share.mp4`.

**Design spec:** `docs/superpowers/specs/2026-06-21-device-binding-app-only-recipient-first-design.md`

**Test command (single file):**

```
NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/<file>.test.js
```

**Full suite:** `npm test` · **Lint:** `npm run lint`

**Why "preview-only at source" matters (review finding P0-1):** `servePublicSharePreviewAudio` currently serves `preview.m4a` if present locally, else falls back to streaming the **full master** (`full.m4a`) when `trackVersion.full_url` is set. Because the app-context gate trusts spoofable headers, a one-header request would otherwise reach this fallback and pull the full song on any server instance that doesn't have the preview on local disk. So the gate alone does NOT close the leak — Task 3 removes the full fallback.

---

## File Structure

| File                                            | Responsibility                                                                                                                           | Action                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `src/utils/request-context.js`                  | Decide whether a request comes from the Porizo app vs a browser                                                                          | Create                      |
| `test/request-context.test.js`                  | Unit tests for `isAppContext`                                                                                                            | Create                      |
| `src/routes/sharing.js`                         | App-only gate on `/audio`, `/teaser`, `/stream`; preview-only `servePublicSharePreviewAudio`; (Task 5) app-only flag on `GET /share/:id` | Modify                      |
| `src/server.js`                                 | `ensureShareMp4` → preview-only source + duration cap + new cache key                                                                    | Modify                      |
| `src/media/share-video-source.js`               | Pure helper: choose share.mp4 audio source (preview-only)                                                                                | Create                      |
| `test/share-video-source.test.js`               | Unit tests for the source chooser                                                                                                        | Create                      |
| `test/share-app-only.test.js`                   | Integration tests for the gated routes via `app.inject`                                                                                  | Create                      |
| `web-player/player.js`, `web-player/index.html` | App-wall screen when server says app-only                                                                                                | Modify (Task 5, read-first) |

**Routes that serve audio/stream bytes — final state after this plan:**

| Route                                      | Source                             | Browser access after plan                                     |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `/share/:id/audio`                         | preview only (Task 3)              | gated → 403 `APP_REQUIRED` (non-demo)                         |
| `/share/:id/teaser`                        | preview only (Task 3)              | gated → 403 `APP_REQUIRED` (non-demo)                         |
| `/share/:id/stream`                        | JSON manifest                      | gated → 403 `APP_REQUIRED` (non-demo)                         |
| `/share/:id/share.mp4`                     | ≤15s preview teaser (Task 4)       | open (crawlers) — teaser only                                 |
| `/share/:id/download.mp4`                  | `ensureShareMp4` → teaser (Task 4) | inherits teaser — verify in Task 4                            |
| `/embed/:id`                               | embeds `share.mp4`                 | open (crawlers) — inherits teaser, do NOT gate                |
| `/share/:id/playlist`,`/segment/:s`,`/key` | HLS full song                      | already hard-gated by valid bound device token — out of scope |

---

## Task 1: `isAppContext` request helper

**Files:**

- Create: `src/utils/request-context.js`
- Test: `test/request-context.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/request-context.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isAppContext } = require("../src/utils/request-context");

describe("isAppContext", () => {
  it("is true when x-device-token header is present", () => {
    assert.equal(isAppContext({ headers: { "x-device-token": "abc" } }), true);
  });
  it("is true when x-device-id + x-platform headers are present", () => {
    assert.equal(
      isAppContext({ headers: { "x-device-id": "dev1", "x-platform": "ios" } }),
      true,
    );
  });
  it("is true for a PorizoApp User-Agent", () => {
    assert.equal(
      isAppContext({ headers: { "user-agent": "PorizoApp/1.6.0 (42; iOS)" } }),
      true,
    );
  });
  it("is false for a plain browser request", () => {
    assert.equal(
      isAppContext({ headers: { "user-agent": "Mozilla/5.0 (iPhone)" } }),
      false,
    );
  });
  it("is false with no headers", () => {
    assert.equal(isAppContext({}), false);
    assert.equal(isAppContext({ headers: {} }), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/request-context.test.js`
Expected: FAIL — `Cannot find module '../src/utils/request-context'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/utils/request-context.js
"use strict";

/**
 * True when a request originates from the Porizo native app rather than a
 * browser. Used to gate share audio so browsers are pushed into the app while
 * in-app requests keep working. Presence-based and browser-spoofable by design:
 * it is a routing signal, NOT a security boundary. The security boundary is that
 * the gated routes can only ever yield the short preview (Task 3), never the
 * full master.
 */
function isAppContext(request) {
  const headers = (request && request.headers) || {};
  if (headers["x-device-token"]) return true;
  if (headers["x-device-id"] && headers["x-platform"]) return true;
  const ua = headers["user-agent"] || "";
  return ua.startsWith("PorizoApp/");
}

module.exports = { isAppContext };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/request-context.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/request-context.js test/request-context.test.js
git commit -m "feat(share): add isAppContext request helper

Co-authored by Ambrose Obimma"
```

---

## Task 2: App-only gate on `/audio`, `/teaser`, and `/stream`

Non-demo shares without app context → `403 APP_REQUIRED`. Demo shares and in-app requests pass.

**Files:**

- Modify: `src/routes/sharing.js` (`/share/:shareId/audio` ~2451, `/share/:shareId/teaser` ~2491, `/share/:shareId/stream` ~2274)
- Test: `test/share-app-only.test.js`

- [ ] **Step 1: Write the failing integration test**

```js
// test/share-app-only.test.js
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const config = require("../src/config");

let app, db;
const USER = "user-app-only";

async function seedShare({ demo = false, fullOnly = false } = {}) {
  const t = await app.inject({
    method: "POST",
    url: "/tracks",
    headers: { "x-user-id": USER },
    payload: {
      title: "T",
      recipient_name: "R",
      message: "m",
      style: "pop",
      occasion: "birthday",
    },
  });
  const { track_id } = JSON.parse(t.body);
  const v = await app.inject({
    method: "POST",
    url: `/tracks/${track_id}/versions`,
    headers: { "x-user-id": USER },
    payload: { style: "pop" },
  });
  const { version_num } = JSON.parse(v.body);
  if (fullOnly) {
    db.prepare(
      "UPDATE track_versions SET full_url = ?, preview_url = NULL WHERE track_id = ? AND version_num = ?",
    ).run("https://api.porizo.co/full/x.m4a", track_id, version_num);
  } else {
    db.prepare(
      "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?",
    ).run("http://stream.local/p.m3u8", track_id, version_num);
  }
  const s = await app.inject({
    method: "POST",
    url: `/tracks/${track_id}/share`,
    headers: { "x-user-id": USER },
    payload: { version_num, expires_in_days: 7, web_stream_allowed: true },
  });
  const { share_id } = JSON.parse(s.body);
  if (demo)
    db.prepare("UPDATE share_tokens SET share_type = 'demo' WHERE id = ?").run(
      share_id,
    );
  return share_id;
}

before(async () => {
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  // Seed the test user exactly as share-flow.test.js does (match its column list if this differs).
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run(USER, new Date().toISOString(), "low");
  const storage = createStorageProvider({
    ...config,
    storage: { type: "local" },
  });
  app = buildServer({ db, config, storage });
});

after(async () => {
  if (app && app.close) await app.close();
});

describe("app-only share audio gate", () => {
  it("blocks a browser GET /audio with APP_REQUIRED", async () => {
    const id = await seedShare();
    const res = await app.inject({ method: "GET", url: `/share/${id}/audio` });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, "APP_REQUIRED");
  });
  it("blocks a browser GET /teaser with APP_REQUIRED", async () => {
    const id = await seedShare();
    const res = await app.inject({ method: "GET", url: `/share/${id}/teaser` });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, "APP_REQUIRED");
  });
  it("blocks a browser GET /stream with APP_REQUIRED", async () => {
    const id = await seedShare();
    const res = await app.inject({ method: "GET", url: `/share/${id}/stream` });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, "APP_REQUIRED");
  });
  it("does NOT return APP_REQUIRED when app headers are present", async () => {
    const id = await seedShare();
    const res = await app.inject({
      method: "GET",
      url: `/share/${id}/audio`,
      headers: { "x-device-id": "dev1", "x-platform": "ios" },
    });
    if (res.statusCode === 403)
      assert.notEqual(JSON.parse(res.body).error, "APP_REQUIRED");
  });
  it("does NOT return APP_REQUIRED for a demo share in a browser", async () => {
    const id = await seedShare({ demo: true });
    const res = await app.inject({ method: "GET", url: `/share/${id}/audio` });
    if (res.statusCode === 403)
      assert.notEqual(JSON.parse(res.body).error, "APP_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-app-only.test.js`
Expected: FAIL — the three "blocks" tests get a non-403.

- [ ] **Step 3: Add the gate snippet to all three handlers**

Add the import near the existing `extractClientIp` require at the top of `src/routes/sharing.js`:

```js
const { isAppContext } = require("../utils/request-context");
```

In each of `/share/:shareId/audio`, `/share/:shareId/teaser`, and `/share/:shareId/stream`, immediately after `const share = await resolveValidShare(request, reply); if (!share) return;` (and before any `web_stream_allowed`/status logic), insert:

```js
// App-only: push browsers into the app; demo shares + in-app requests pass.
if (share.share_type !== "demo" && !isAppContext(request)) {
  sendError(
    reply,
    403,
    "APP_REQUIRED",
    "Open this song in the Porizo app to listen.",
  );
  return;
}
```

> Read each handler's opening lines before inserting so the snippet lands right after the `resolveValidShare` guard. `/stream` (~2274) resolves the share the same way — confirm the variable is named `share`.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-app-only.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Regression-check existing share suites**

Run:

```
NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-flow.test.js test/share-audio-proxy.test.js test/share-embed.test.js
```

Expected: PASS. Any existing test that asserted a browser could fetch `/audio`/`/teaser`/`/stream` must be updated to send app headers (`x-device-id`+`x-platform`) or use a demo share. **Also confirm here (open verification item 1) that no in-app code path depends on the public `/audio` for unbound preview — the app should claim then use `/stream`/HLS. If an in-app path uses `/audio`, it already sends `x-device-token`, so the gate passes.** Note every test change in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/routes/sharing.js test/share-app-only.test.js
git commit -m "feat(share): gate /audio, /teaser, /stream to app-only (demo exempt)

Co-authored by Ambrose Obimma"
```

---

## Task 3: Preview-only at source (remove the full-master fallback) — closes P0-1

The public preview path must never yield the full song, even to a spoofed app context. Make `servePublicSharePreviewAudio` serve the preview or 404 — never `full.m4a`.

**Files:**

- Modify: `src/routes/sharing.js` (`servePublicSharePreviewAudio` ~494–569)
- Test: `test/share-app-only.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/share-app-only.test.js`:

```js
describe("preview-only at source", () => {
  it("returns 404 AUDIO_NOT_AVAILABLE (never the full master) when no local preview exists", async () => {
    // full_url set, preview_url null, and no preview.m4a on local disk in tests.
    const id = await seedShare({ fullOnly: true });
    const res = await app.inject({
      method: "GET",
      url: `/share/${id}/audio`,
      headers: { "x-device-id": "dev1", "x-platform": "ios" }, // pass the gate
    });
    assert.notEqual(res.statusCode, 200); // must NOT stream the full master
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, "AUDIO_NOT_AVAILABLE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-app-only.test.js`
Expected: FAIL — currently falls back to `serveTrackAudio(full.m4a)`.

- [ ] **Step 3: Remove the full-master fallback**

In `servePublicSharePreviewAudio` (`src/routes/sharing.js` ~494–569), find the branch that — when `preview.m4a` is absent and `trackVersion.full_url` is set — builds `trackMasterKey({...})` and calls `serveTrackAudio(request, reply, { ... localFileName: "full.m4a" })`. **Delete that fallback branch.** When the local preview is absent (after the `ensureLocalFileFromStorage` preview-hydrate attempt), replace it with:

```js
sendError(reply, 404, "AUDIO_NOT_AVAILABLE", "Preview is not available yet.");
return;
```

> Read the full function body first. Keep the preview hydrate + `sendMediaFile(preview)` happy path intact. Only the `full_url`→full-master fallback is removed.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-app-only.test.js`
Expected: PASS.

- [ ] **Step 5: Regression-check**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-flow.test.js test/share-audio-proxy.test.js`
Expected: PASS. If a test relied on `/audio` serving the full master, update it (the full song is only available via the device-gated HLS path now). Note changes in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/routes/sharing.js test/share-app-only.test.js
git commit -m "fix(share): public preview path is preview-only, never the full master

Co-authored by Ambrose Obimma"
```

---

## Task 4: `share.mp4` → preview-only, ≤15s, new cache key

Source from `preview.m4a` only, cap to 15s via the existing `generateShareMp4` duration param, and write to a new filename so the ~600 existing cached `share.mp4` files regenerate. `download.mp4` and `/embed` inherit this automatically.

**Files:**

- Create: `src/media/share-video-source.js`
- Test: `test/share-video-source.test.js`
- Modify: `src/server.js` (`ensureShareMp4` ~1546–1598 and `shareVideoKeyForTrackVersion`)

- [ ] **Step 1: Write the failing unit test for the source chooser**

```js
// test/share-video-source.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveShareVideoAudio,
  SHARE_TEASER_MAX_SECONDS,
} = require("../src/media/share-video-source");
const fakeFs = (present) => ({ existsSync: (p) => present.includes(p) });

describe("resolveShareVideoAudio", () => {
  it("uses preview.m4a when present and caps duration to 15s", () => {
    const r = resolveShareVideoAudio({
      versionDir: "/v",
      fs: fakeFs(["/v/preview.m4a"]),
    });
    assert.equal(r.audioPath, "/v/preview.m4a");
    assert.equal(r.maxSeconds, SHARE_TEASER_MAX_SECONDS);
    assert.equal(SHARE_TEASER_MAX_SECONDS, 15);
  });
  it("NEVER selects full.m4a even when it is the only local file", () => {
    const r = resolveShareVideoAudio({
      versionDir: "/v",
      fs: fakeFs(["/v/full.m4a"]),
    });
    assert.equal(r.audioPath, null);
  });
  it("returns null audioPath when no preview exists locally", () => {
    const r = resolveShareVideoAudio({ versionDir: "/v", fs: fakeFs([]) });
    assert.equal(r.audioPath, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/share-video-source.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chooser**

```js
// src/media/share-video-source.js
"use strict";
const nodePath = require("node:path");

const SHARE_TEASER_MAX_SECONDS = 15;

/**
 * Pick the local audio source for the social-unfurl share video.
 * Teaser-only: the preview is the ONLY allowed source — the full master is
 * never embedded in a publicly-served unfurl video.
 */
function resolveShareVideoAudio({
  versionDir,
  fs = require("node:fs"),
  path = nodePath,
}) {
  const preview = path.join(versionDir, "preview.m4a");
  if (fs.existsSync(preview)) {
    return {
      audioPath: preview,
      maxSeconds: SHARE_TEASER_MAX_SECONDS,
      sourceKind: "preview",
    };
  }
  return {
    audioPath: null,
    maxSeconds: SHARE_TEASER_MAX_SECONDS,
    sourceKind: "none",
  };
}

module.exports = { resolveShareVideoAudio, SHARE_TEASER_MAX_SECONDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/share-video-source.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Rewire `ensureShareMp4` (server.js)**

First **read** `ensureShareMp4` (~1546–1689) in full AND `generateShareMp4` in `src/utils/ffmpeg.js` to learn the `maxDuration` semantics (confirm `maxDuration > 0` caps and the current default `0` means "no cap").

Then:

1. Add near the other requires:

```js
const {
  resolveShareVideoAudio,
  SHARE_TEASER_MAX_SECONDS,
} = require("./media/share-video-source");
```

2. Change `shareVideoKeyForTrackVersion` to a NEW filename so old caches don't serve:

```js
function shareVideoKeyForTrackVersion(track, trackVersion) {
  return `${trackVersionKey({ userId: track.user_id, trackId: track.id, versionNum: trackVersion.version_num })}/share-teaser.mp4`;
}
```

3. **Replace the entire region from the `mp4Path` local-path declaration (~line 1548) through the end of the full-vs-preview source-selection block (~line 1598)** — including the early `fs.existsSync(mp4Path)` cache-return and the `storageProvider.objectExists` branch (they reference the old `share.mp4` key) — with:

```js
const versionDir = getVersionDir(track, trackVersion);
const localPath = path.join(versionDir, "share-teaser.mp4");
const shareVideoKey = shareVideoKeyForTrackVersion(track, trackVersion);

if (fs.existsSync(localPath)) return localPath;
if (storageProvider !== "local") {
  const exists = await storageProvider
    .objectExists?.(shareVideoKey)
    .catch(() => false);
  if (exists) {
    await ensureLocalFileFromStorage({ key: shareVideoKey, localPath }).catch(
      () => {},
    );
    if (fs.existsSync(localPath)) return localPath;
  }
}

let { audioPath } = resolveShareVideoAudio({ versionDir });
if (!audioPath && storageProvider !== "local") {
  const previewKey = trackPreviewKey({
    userId: track.user_id,
    trackId: track.id,
    versionNum: trackVersion.version_num,
  });
  await ensureLocalFileFromStorage({
    key: previewKey,
    localPath: path.join(versionDir, "preview.m4a"),
  }).catch(() => {});
  ({ audioPath } = resolveShareVideoAudio({ versionDir }));
}
if (!audioPath) return null; // no preview → no unfurl video (route falls through to 404)
```

> Match the real `storageProvider` API shape you saw when reading the function (the existing code already uses `objectExists`/`ensureLocalFileFromStorage` — reuse the exact calls present there). Keep the artwork-selection block below unchanged.

4. In the `generateShareMp4({ ... })` call (~line 1665), pass the cap and write to the new path:

```js
    output: localPath,
    maxDuration: SHARE_TEASER_MAX_SECONDS,
```

(Replace the previous `maxDuration: shareVideoMaxDurationSec` and the old output path. If `generateShareMp4` writes its own filename, ensure it targets `share-teaser.mp4`.)

- [ ] **Step 6: Add integration tests for the unfurl + download routes**

Append to `test/share-app-only.test.js`:

```js
describe("share.mp4 + download.mp4 are teaser-only and ungated for crawlers", () => {
  it("GET /share.mp4 returns 200 video/mp4 or 404 (no preview) — never 403", async () => {
    const id = await seedShare();
    const res = await app.inject({
      method: "GET",
      url: `/share/${id}/share.mp4`,
    });
    assert.ok([200, 404].includes(res.statusCode));
    if (res.statusCode === 200)
      assert.match(res.headers["content-type"], /^video\/mp4/);
  });
  it("download.mp4 inherits the teaser (no full-master video to a browser)", async () => {
    // download.mp4 calls ensureShareMp4 — after this task it can only produce share-teaser.mp4.
    const id = await seedShare({ fullOnly: true });
    const res = await app.inject({
      method: "GET",
      url: `/share/${id}/download.mp4`,
    });
    // With no local preview, ensureShareMp4 returns null → route must 404, not stream full audio.
    assert.notEqual(res.statusCode, 200);
  });
});
```

> If `download.mp4` requires a `dl_token`, this test will fail earlier with 401/403 — that's still "not 200 full audio", which satisfies the assertion. Adjust only if the route 200s.

- [ ] **Step 7: Run tests**

Run: `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/share-video-source.test.js test/share-app-only.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/media/share-video-source.js test/share-video-source.test.js src/server.js test/share-app-only.test.js
git commit -m "feat(share): share.mp4 preview-only 15s teaser, new cache key

download.mp4 and /embed inherit the teaser via ensureShareMp4.

Co-authored by Ambrose Obimma"
```

---

## Task 5: App-wall on the web player (read-first client task)

Replace the broken-player UX with a clean "Open in Porizo" screen. Binding enforcement already happened in Tasks 2–4.

**Files:**

- Modify: `src/routes/sharing.js` (`GET /share/:shareId` JSON info handler)
- Modify: `web-player/player.js`, `web-player/index.html`

- [ ] **Step 1: Discovery — read before changing**

- `web-player/player.js` — the function that consumes `GET /share/:shareId` and chooses which `.screen` to show.
- `GET /share/:shareId` info handler in `src/routes/sharing.js`. **Note:** it already returns an `app_required` field driven by `claim_policy === "app_only"` (~lines 1754/1780). That is a DIFFERENT concern (claim policy). Do **not** rename it. Add a new, separate field for audio gating.
- `/download` route + `POST /share/:shareId/receiver-session` (how the client gets the App Store / OneLink URL).

- [ ] **Step 2: Server — add `app_only` to the info payload (failing test first)**

Append to `test/share-app-only.test.js`:

```js
describe("GET /share/:id app_only flag", () => {
  it("is true for normal shares, false for demo", async () => {
    const normal = await seedShare();
    const demo = await seedShare({ demo: true });
    const a = await app.inject({ method: "GET", url: `/share/${normal}` });
    const b = await app.inject({ method: "GET", url: `/share/${demo}` });
    assert.equal(JSON.parse(a.body).app_only, true);
    assert.equal(JSON.parse(b.body).app_only, false);
  });
});
```

Run it (fails), then in the `GET /share/:shareId` handler set `app_only: share.share_type !== "demo"` in the JSON response and omit `web_stream_url`/teaser URLs when `app_only` is true (keep `app_download_url`/receiver-save data). Re-run to green.

- [ ] **Step 3: Client — show an app-wall screen**

Add a dedicated `#app-wall` `.screen` to `web-player/index.html` (reuse `.cta-button`, artwork, the existing `apple-itunes-app` banner / `/download` link). Headline "[Sender] made [Recipient] a song", subtext "Open it in the Porizo app to listen and keep it forever", primary button → app download / receiver-save URL. In `player.js`, when the info payload has `app_only === true`, route to `#app-wall` and do NOT create the `<audio>` stream. Bump the `?v=` cache-buster on the `player.js`/`styles.css` includes.

- [ ] **Step 4: Manual verification (browser UI)**

Local `npm run dev` (or staging): open a normal share URL → app-wall shows, no audio plays; open a demo share URL → still plays. Record in the commit body. (Server contract is covered by Step 2's automated test.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/sharing.js web-player/index.html web-player/player.js test/share-app-only.test.js
git commit -m "feat(share): web app-wall for app-only shares (no browser playback)

Co-authored by Ambrose Obimma"
```

---

## Task 6: Full verification

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: PASS (compare any failures against a clean `git stash` baseline to separate pre-existing from new).
- [ ] **Step 2: Lint** — Run: `npm run lint` — Expected: clean for files this plan touched.
- [ ] **Step 3: "Can a browser still get the full song?" checklist (re-read the diff):**
  - `/audio`, `/teaser`, `/stream`: non-demo browser → `403 APP_REQUIRED`; app headers / demo → pass. ✔
  - `servePublicSharePreviewAudio`: preview or 404 — **never** `full.m4a`. ✔ (P0-1)
  - `share.mp4` / `download.mp4` / `/embed`: ≤15s preview teaser, new cache key. ✔
  - `/playlist` `/segment` `/key`: still require a valid bound device token (untouched). ✔
  - OG/meta in `web-player/index.html` `<head>` unchanged (unfurls intact). ✔

---

## Open verification items (carried from the spec)

1. Confirm during Task 2 Step 5 that no in-app path relies on the public `/audio` route (the app should claim then use `/stream`/HLS). If it does, it sends `x-device-token`, so the gate passes — verify in the share suite output.
2. Confirm the `share-teaser.mp4` cache-key change regenerates and that the duration cap produces a valid short clip on a real preview file (manual check on staging).
3. Confirm `generateShareMp4`'s `maxDuration` semantics in `src/utils/ffmpeg.js` before Task 4 Step 5 (that `>0` caps; legacy default `0` = no cap).
