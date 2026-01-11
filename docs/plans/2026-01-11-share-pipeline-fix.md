# Share Pipeline Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken share pipeline so web recipients can play shared songs.

**Architecture:** The share pipeline has 4 critical issues: (1) share URL points to non-existent route, (2) web player expects wrong API fields, (3) HLS auth requires headers browsers can't send, (4) Hls.js library is not loaded. We'll fix each sequentially with code review checkpoints.

**Tech Stack:** Node.js/Fastify backend, vanilla JS web player, HLS.js for streaming

---

## Verified Issues (from codebase audit)

| # | Issue | Status | Fix |
|---|-------|--------|-----|
| 1 | `POST /tracks/:id/share` returns `/s/${shareId}` - route doesn't exist | BROKEN | Use `/play/${shareId}` |
| 2 | API returns `track_preview`, player expects `shareData.track` | BROKEN | Update player |
| 3 | HLS routes require `x-device-id`/`x-platform` headers | BROKEN | Skip auth for web unclaimed |
| 4 | Hls.js not loaded in index.html | BROKEN | Add CDN script |
| 5 | Missing `can_access` field in API response | BROKEN | Add field |

---

## Task 1: Fix Share URL Generation

**Files:**
- Modify: `src/config.js` (add new env var)
- Modify: `src/server.js:2686-2692` (fix URL)
- Test: `test/share-url.test.js` (new file)

### Step 1.1: Write failing test

Create `test/share-url.test.js`:

```javascript
const tap = require("tap");
const { buildTestApp } = require("./helpers");

tap.test("POST /tracks/:id/share returns correct play URL", async (t) => {
  const { app, db, userId, cleanup } = await buildTestApp();

  try {
    // Create a track with a rendered version
    const trackId = "test-track-" + Date.now();
    db.prepare(`
      INSERT INTO tracks (id, user_id, title, occasion, recipient_name, style, status, latest_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(trackId, userId, "Test Song", "birthday", "Friend", "pop", "ready", 1);

    db.prepare(`
      INSERT INTO track_versions (id, track_id, version_num, status, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("tv-" + Date.now(), trackId, 1, "ready", "/storage/preview.m4a");

    const response = await app.inject({
      method: "POST",
      url: `/tracks/${trackId}/share`,
      headers: { "x-user-id": userId },
      payload: {},
    });

    t.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);

    // Key assertion: URL should use /play/ route, not /s/
    t.ok(body.share_url.includes("/play/"), "share_url should use /play/ route");
    t.notOk(body.share_url.includes("/s/"), "share_url should NOT use /s/ route");
    t.ok(body.share_id, "should return share_id");
    t.ok(body.claim_pin, "should return claim_pin");

  } finally {
    await cleanup();
  }
});
```

### Step 1.2: Run test to verify it fails

```bash
npm test -- test/share-url.test.js
```

Expected: FAIL with assertion "share_url should use /play/ route"

### Step 1.3: Add PUBLIC_BASE_URL to config

Modify `src/config.js` - add after line 13 (STREAM_BASE_URL):

```javascript
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
```

And add to module.exports:

```javascript
  PUBLIC_BASE_URL,
```

### Step 1.4: Fix share URL in server.js

Modify `src/server.js` line 2688 - change from:

```javascript
      share_url: `https://app.porizo.local/s/${shareId}`,
```

to:

```javascript
      share_url: `${config.PUBLIC_BASE_URL}/play/${shareId}`,
```

Add import at top of file if not present:
```javascript
const config = require("./config");
```

### Step 1.5: Run test to verify it passes

```bash
npm test -- test/share-url.test.js
```

Expected: PASS

### Step 1.6: Checkpoint - Request code review

```bash
# Stage the changes
git add src/config.js src/server.js test/share-url.test.js

# Run code review agent
```

**CHECKPOINT: Use superpowers:requesting-code-review before continuing**

### Step 1.7: Commit

```bash
git commit -m "fix(share): use /play/:shareId route in share URL generation

- Add PUBLIC_BASE_URL config for flexible base URL
- Change hardcoded /s/ URL to use /play/ route that actually exists
- Add test for share URL format"
```

---

## Task 2: Fix API/Player Schema Mismatch

**Files:**
- Modify: `src/server.js:2766-2775` (add `track` alias and `can_access`)
- Modify: `web-player/player.js:120,186` (use correct field)
- Test: `test/share-api.test.js` (new file)

### Step 2.1: Write failing test

Create `test/share-api.test.js`:

```javascript
const tap = require("tap");
const { buildTestApp } = require("./helpers");

tap.test("GET /share/:id returns track and can_access fields", async (t) => {
  const { app, db, userId, cleanup } = await buildTestApp();

  try {
    // Create track, version, and share
    const trackId = "test-track-" + Date.now();
    const shareId = "test-share-" + Date.now();
    const versionId = "tv-" + Date.now();

    db.prepare(`
      INSERT INTO tracks (id, user_id, title, occasion, recipient_name, style, status, latest_version, share_token_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(trackId, userId, "Birthday Song", "birthday", "Alice", "pop", "ready", 1, shareId);

    db.prepare(`
      INSERT INTO track_versions (id, track_id, version_num, status, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(versionId, trackId, 1, "ready", "/storage/preview.m4a");

    db.prepare(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at, web_stream_allowed, stream_key_id, stream_key, claim_pin)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'), datetime('now'), 1, 'sk-1', 'key123', '123456')
    `).run(shareId, trackId, versionId, userId);

    const response = await app.inject({
      method: "GET",
      url: `/share/${shareId}`,
    });

    t.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);

    // Key assertions: web player expects these fields
    t.ok(body.track, "should have track field (alias for track_preview)");
    t.equal(body.track.title, "Birthday Song", "track.title should match");
    t.equal(body.track.recipient_name, "Alice", "track.recipient_name should be included");
    t.type(body.can_access, "boolean", "should have can_access boolean field");

  } finally {
    await cleanup();
  }
});

tap.test("GET /share/:id with claimed share shows can_access based on device", async (t) => {
  const { app, db, userId, cleanup } = await buildTestApp();

  try {
    const trackId = "test-track-" + Date.now();
    const shareId = "test-share-" + Date.now();
    const versionId = "tv-" + Date.now();
    const boundDeviceId = "device-123";

    db.prepare(`
      INSERT INTO tracks (id, user_id, title, occasion, recipient_name, style, status, latest_version, share_token_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(trackId, userId, "Song", "birthday", "Bob", "pop", "ready", 1, shareId);

    db.prepare(`
      INSERT INTO track_versions (id, track_id, version_num, status, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(versionId, trackId, 1, "ready", "/storage/preview.m4a");

    db.prepare(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, bound_device_id, bound_device_platform, expires_at, created_at, web_stream_allowed, stream_key_id, stream_key, claim_pin)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'), datetime('now'), 0, 'sk-1', 'key123', '123456')
    `).run(shareId, trackId, versionId, userId, "claimed", boundDeviceId, "web");

    // Request from same device
    const response = await app.inject({
      method: "GET",
      url: `/share/${shareId}`,
      headers: { "x-device-id": boundDeviceId },
    });

    t.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    t.equal(body.can_access, true, "can_access should be true for bound device");

  } finally {
    await cleanup();
  }
});
```

### Step 2.2: Run test to verify it fails

```bash
npm test -- test/share-api.test.js
```

Expected: FAIL with "should have track field"

### Step 2.3: Update GET /share/:id response

Modify `src/server.js` lines 2766-2775. Replace the reply.send block with:

```javascript
    // Check if requesting device matches bound device (for can_access)
    const requestDeviceId = request.headers["x-device-id"];
    const canAccess = share.status === "unbound" ||
      (share.bound_device_id && share.bound_device_id === requestDeviceId);

    const trackInfo = {
      title: track.title,
      recipient_name: track.recipient_name,
      duration_sec: track.duration_target || 60,
      cover_image_url: null,
    };

    const shareStreamUrl = share.web_stream_allowed
      ? rewriteStreamUrl(trackVersion.full_url || trackVersion.preview_url || null, getBaseUrl(request))
      : null;

    reply.send({
      status: "unbound",
      track_preview: trackInfo,
      track: trackInfo, // Alias for web player compatibility
      can_access: canAccess,
      web_stream_url: shareStreamUrl,
      app_download_url: `${config.PUBLIC_BASE_URL}/download`,
    });
```

### Step 2.4: Run test to verify it passes

```bash
npm test -- test/share-api.test.js
```

Expected: PASS

### Step 2.5: Update web player to use correct fields

The player already uses `shareData.track` which now works. But update the `can_access` check in `web-player/player.js` line ~120:

Change:
```javascript
      // If already claimed by this device, skip PIN entry
      if (shareData.status === 'claimed' && shareData.can_access) {
```

This code is already correct - no change needed since we added `can_access` to API.

### Step 2.6: Checkpoint - Request code review

```bash
git add src/server.js test/share-api.test.js
```

**CHECKPOINT: Use superpowers:requesting-code-review before continuing**

### Step 2.7: Commit

```bash
git commit -m "fix(share): add track alias and can_access to share API response

- Add 'track' field as alias for track_preview (web player compatibility)
- Include recipient_name in track info
- Add can_access boolean based on device binding
- Use PUBLIC_BASE_URL for app download link
- Add tests for share API schema"
```

---

## Task 3: Add Hls.js Library to Web Player

**Files:**
- Modify: `web-player/index.html` (add script tag)

### Step 3.1: Add Hls.js CDN script

Modify `web-player/index.html` - add before the player.js script (before line 113):

```html
  <!-- HLS.js for non-Safari browsers -->
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"></script>
  <script src="player.js"></script>
```

### Step 3.2: Verify manually

```bash
# Start dev server
npm run dev

# Open browser to check Hls.js loads
# Check browser console for: typeof Hls !== 'undefined'
```

### Step 3.3: Checkpoint - Request code review

```bash
git add web-player/index.html
```

**CHECKPOINT: Use superpowers:requesting-code-review before continuing**

### Step 3.4: Commit

```bash
git commit -m "fix(web-player): add Hls.js library for HLS streaming

- Add Hls.js 1.5.7 from CDN
- Required for HLS playback in non-Safari browsers"
```

---

## Task 4: Fix HLS Streaming for Web (Simplify Auth)

**Files:**
- Modify: `src/server.js:2850-2922` (simplify stream endpoint for unclaimed shares)
- Modify: `src/server.js:2925-2949` (allow header-less access for shares)
- Test: `test/share-stream.test.js` (new file)

### Step 4.1: Write failing test

Create `test/share-stream.test.js`:

```javascript
const tap = require("tap");
const { buildTestApp } = require("./helpers");

tap.test("GET /share/:id/stream works without headers for unclaimed web share", async (t) => {
  const { app, db, userId, cleanup } = await buildTestApp();

  try {
    const trackId = "test-track-" + Date.now();
    const shareId = "test-share-" + Date.now();
    const versionId = "tv-" + Date.now();

    db.prepare(`
      INSERT INTO tracks (id, user_id, title, occasion, recipient_name, style, status, latest_version, share_token_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(trackId, userId, "Song", "birthday", "Test", "pop", "ready", 1, shareId);

    db.prepare(`
      INSERT INTO track_versions (id, track_id, version_num, status, preview_url, full_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(versionId, trackId, 1, "ready", "/storage/preview.m4a", "/storage/full.m4a");

    db.prepare(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at, web_stream_allowed, stream_key_id, stream_key, claim_pin)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'), datetime('now'), 1, 'sk-1', 'key123', '123456')
    `).run(shareId, trackId, versionId, userId);

    // Request WITHOUT x-device-id headers (like a browser)
    const response = await app.inject({
      method: "GET",
      url: `/share/${shareId}/stream`,
      // No headers!
    });

    t.equal(response.statusCode, 200, "should return 200 for unclaimed share");
    const body = JSON.parse(response.body);
    t.ok(body.stream_url, "should return stream_url");

  } finally {
    await cleanup();
  }
});

tap.test("GET /share/:id/stream requires device match for claimed share", async (t) => {
  const { app, db, userId, cleanup } = await buildTestApp();

  try {
    const trackId = "test-track-" + Date.now();
    const shareId = "test-share-" + Date.now();
    const versionId = "tv-" + Date.now();

    db.prepare(`
      INSERT INTO tracks (id, user_id, title, occasion, recipient_name, style, status, latest_version, share_token_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(trackId, userId, "Song", "birthday", "Test", "pop", "ready", 1, shareId);

    db.prepare(`
      INSERT INTO track_versions (id, track_id, version_num, status, preview_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(versionId, trackId, 1, "ready", "/storage/preview.m4a");

    db.prepare(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, bound_device_id, bound_device_platform, expires_at, created_at, web_stream_allowed, stream_key_id, stream_key, claim_pin)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'), datetime('now'), 0, 'sk-1', 'key123', '123456')
    `).run(shareId, trackId, versionId, userId, "claimed", "device-abc", "web");

    // Wrong device
    const response = await app.inject({
      method: "GET",
      url: `/share/${shareId}/stream`,
      headers: { "x-device-id": "wrong-device", "x-platform": "web" },
    });

    t.equal(response.statusCode, 403, "should return 403 for wrong device");

  } finally {
    await cleanup();
  }
});
```

### Step 4.2: Run test to verify it fails

```bash
npm test -- test/share-stream.test.js
```

Expected: FAIL with 400 "MISSING_DEVICE_HEADERS"

### Step 4.3: Update stream endpoint to allow header-less access for unclaimed

Modify `src/server.js` lines 2850-2922. Replace the entire `/share/:shareId/stream` handler:

```javascript
  app.get("/share/:shareId/stream", async (request, reply) => {
    const share = db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(request.params.shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Share token not found.");
      return;
    }
    if (new Date(share.expires_at) < new Date()) {
      db.prepare("UPDATE share_tokens SET status = ? WHERE id = ?").run("expired", share.id);
      sendError(reply, 410, "SHARE_EXPIRED", "Share token expired.");
      return;
    }

    const deviceId = request.headers["x-device-id"];
    const platform = request.headers["x-platform"];

    // For CLAIMED shares, require device match
    if (share.status === "claimed") {
      if (!deviceId || !platform) {
        sendError(reply, 400, "MISSING_DEVICE_HEADERS", "x-device-id and x-platform headers are required for claimed shares.");
        return;
      }
      if (share.bound_device_id !== deviceId || share.bound_device_platform !== platform) {
        addShareAccessLog({
          shareTokenId: share.id,
          eventType: "access_denied",
          metadata: { reason: "device_mismatch" },
        });
        sendError(reply, 403, "TOKEN_ALREADY_BOUND", "Share token bound to another device.");
        return;
      }
    }

    // For UNCLAIMED shares with web_stream_allowed, allow direct streaming
    // This enables web preview before claiming
    if (share.status === "unbound" && !share.web_stream_allowed) {
      sendError(reply, 403, "WEB_STREAM_NOT_ALLOWED", "Web streaming not allowed for this share.");
      return;
    }

    addShareAccessLog({
      shareTokenId: share.id,
      eventType: "stream_started",
      metadata: { platform: platform || "web", claimed: share.status === "claimed" },
    });

    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(share.track_id);
    const trackVersion = db.prepare("SELECT * FROM track_versions WHERE id = ?").get(share.track_version_id);
    const baseUrl = getBaseUrl(request);

    // Check if CDN (CloudFront) is configured
    if (cdnSignerInstance && track && trackVersion) {
      const hlsPath = `/tracks/${track.user_id}/${track.id}/v${trackVersion.version_num}/hls/playlist.m3u8`;
      const signedPlaylist = cdnSignerInstance.createSignedStreamUrl({
        path: hlsPath,
        expiresInSeconds: 300,
      });
      reply.send({
        stream_url: signedPlaylist.url,
        cdn_enabled: true,
        expires_at: signedPlaylist.expiresAt,
      });
      return;
    }

    // For unclaimed web shares, return direct audio URL (simpler, no HLS auth issues)
    if (share.status === "unbound" && share.web_stream_allowed) {
      const audioUrl = trackVersion.preview_url || trackVersion.full_url;
      if (audioUrl) {
        reply.send({
          stream_url: rewriteStreamUrl(audioUrl, baseUrl),
          cdn_enabled: false,
          format: "audio", // Direct audio file, not HLS
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        return;
      }
    }

    // Fallback to HLS playlist (for claimed shares with proper headers)
    reply.send({
      stream_url: `${baseUrl}/share/${share.id}/playlist`,
      key_url: `${baseUrl}/share/${share.id}/key`,
      cdn_enabled: false,
      format: "hls",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  });
```

### Step 4.4: Run test to verify it passes

```bash
npm test -- test/share-stream.test.js
```

Expected: PASS

### Step 4.5: Checkpoint - Request code review

```bash
git add src/server.js test/share-stream.test.js
```

**CHECKPOINT: Use superpowers:requesting-code-review before continuing**

### Step 4.6: Commit

```bash
git commit -m "fix(share): allow header-less streaming for unclaimed web shares

- Unclaimed shares with web_stream_allowed can stream without headers
- Return direct audio URL for unclaimed web shares (avoids HLS auth)
- Claimed shares still require device headers for security
- Add format field to indicate audio vs hls response
- Add tests for share streaming auth logic"
```

---

## Task 5: Update Web Player Stream Loading

**Files:**
- Modify: `web-player/player.js:100-115,180-210` (handle direct audio and fix stream flow)

### Step 5.1: Update player to handle pre-claim streaming

Modify `web-player/player.js`. Update the `initializePlayer` function around line 100:

```javascript
  async function initializePlayer() {
    try {
      // Get share ID from URL
      const pathParts = window.location.pathname.split('/');
      shareId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

      if (!shareId || shareId === 'web-player') {
        showError('Invalid share link');
        return;
      }

      // Get device ID
      deviceId = getDeviceId();

      // Fetch share info
      shareData = await fetchShareInfo(shareId);

      if (shareData.status === 'expired') {
        showScreen('expired');
        return;
      }

      // Update track info immediately (available before claim)
      if (shareData.track) {
        elements.trackTitle.textContent = shareData.track.title || 'Your Song';
        elements.trackRecipient.textContent = `Made for ${shareData.track.recipient_name || 'You'}`;
      }

      // If already claimed by this device, skip PIN entry and load player
      if (shareData.status === 'claimed' && shareData.can_access) {
        await loadPlayer();
        return;
      }

      // If unclaimed and web streaming allowed, we can preview before PIN
      // But still show PIN entry for claiming
      if (shareData.status === 'unbound' && shareData.web_stream_url) {
        // Store the preview URL for after PIN entry
        streamUrl = shareData.web_stream_url;
      }

      // Show PIN entry
      showScreen('pinEntry');

    } catch (error) {
      console.error('Init error:', error);
      if (error.message === 'SHARE_NOT_FOUND') {
        showError('This share link was not found or has been revoked.');
      } else if (error.message === 'SHARE_EXPIRED') {
        showScreen('expired');
      } else {
        showError(error.message);
      }
    }
  }
```

### Step 5.2: Update loadPlayer to use direct stream URL when available

Update the `loadPlayer` function around line 160:

```javascript
  async function loadPlayer() {
    showScreen('loading');

    try {
      // If we don't have a stream URL yet, fetch it
      if (!streamUrl) {
        const streamData = await getStreamUrl(shareId);
        streamUrl = streamData.stream_url;
      }

      // Update UI with track info
      if (shareData && shareData.track) {
        elements.trackTitle.textContent = shareData.track.title || 'Your Song';
        elements.trackRecipient.textContent = `Made for ${shareData.track.recipient_name || 'You'}`;
      }

      // Set up audio player
      setupAudioPlayer(streamUrl);
      showScreen('player');

    } catch (error) {
      console.error('Load player error:', error);
      if (error.message === 'TOKEN_ALREADY_BOUND') {
        showError('This link is already claimed on another device.');
      } else {
        showError('Unable to load the song. Please try again.');
      }
    }
  }
```

### Step 5.3: Update getStreamUrl to handle no-header case

Update the `getStreamUrl` function around line 85:

```javascript
  async function getStreamUrl(shareId) {
    // For unclaimed shares, we may not have device binding yet
    // Try without headers first, fallback to headers if needed
    const headers = {};
    if (deviceId) {
      headers['X-Device-Id'] = deviceId;
      headers['X-Platform'] = 'web';
    }

    const response = await fetch(`${getApiBaseUrl()}/share/${shareId}/stream`, {
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json();
  }
```

### Step 5.4: Verify manually

```bash
npm run dev
# Open /play/[shareId] in browser
# Should show PIN entry
# Enter PIN
# Should play audio
```

### Step 5.5: Checkpoint - Request code review

```bash
git add web-player/player.js
```

**CHECKPOINT: Use superpowers:requesting-code-review before continuing**

### Step 5.6: Commit

```bash
git commit -m "fix(web-player): update stream loading for new API contract

- Handle direct audio URLs in addition to HLS
- Update track info display with recipient_name
- Handle streaming without device headers for unclaimed shares
- Use web_stream_url from share info when available"
```

---

## Task 6: Final Review

### Step 6.1: Run all tests

```bash
npm test
```

Expected: All tests pass

### Step 6.2: Run build

```bash
npm run build
```

Expected: Success (or skip if no build step)

### Step 6.3: Manual E2E test

1. Start server: `npm run dev`
2. Create a user and track via API or app
3. Create share via `POST /tracks/:id/share`
4. Open share URL in browser
5. Verify:
   - Page loads (no 404)
   - Track title and recipient shown
   - PIN entry works
   - After PIN, audio plays
   - Check browser console for errors

### Step 6.4: Final code review

**CHECKPOINT: Run /review before committing**

---

## Verification Checklist

After completing all tasks:

- [ ] `POST /tracks/:id/share` returns URL with `/play/` route
- [ ] `/play/:shareId` serves web player (no 404)
- [ ] `GET /share/:shareId` returns `track` and `can_access` fields
- [ ] Web player loads Hls.js from CDN
- [ ] Unclaimed shares can stream without device headers
- [ ] PIN entry and claim flow works
- [ ] Audio actually plays in browser

---

## Rollback Plan

If issues arise:
1. Revert commits with `git revert <commit>`
2. Config change (PUBLIC_BASE_URL) is additive, non-breaking
3. API changes add new fields, don't remove old ones
4. Web player changes are isolated to web-player/ directory
