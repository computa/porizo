"use strict";

/**
 * Full-song MP3 route contract (plan 2026-07-21-001 Task 3).
 *
 * GET /full/:trackVersionId.mp3 must mirror the existing /full/:id.m4a route:
 * owner-gated (requireUserId + ownership) and, when storage has the object,
 * proxy non-zero bytes to the client as audio/mpeg.
 *
 * The byte-flow assertion is deliberate: a 200 with Content-Length: 0 shipped
 * here before (serveTrackAudio R2 branch, 2026-05-10) and looks healthy to
 * status-only monitoring. This pins bytes-flowed, not just status.
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-full-song-mp3-route-32bytes";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");

const FAKE_AUDIO = Buffer.concat([
  Buffer.from("ID3", "binary"),
  Buffer.alloc(4096, 0x55),
]);
const FAKE_CONTENT_TYPE = "audio/mpeg";

function makeFakeR2Server() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": FAKE_CONTENT_TYPE,
        "Content-Length": String(FAKE_AUDIO.length),
        "Accept-Ranges": "bytes",
      });
      res.end(FAKE_AUDIO);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function makeFakeS3Storage(baseUrl, seenKeys) {
  return {
    type: "s3",
    createPresignedDownload({ key }) {
      seenKeys.push(key);
      return {
        url: `${baseUrl}/${key}`,
        method: "GET",
        headers: {},
        expiresAt: Date.now() + 300_000,
      };
    },
    async putObject() {},
    async getObject() {
      return null;
    },
    async deleteObject() {},
    async objectExists() {
      return true;
    },
    async getObjectStream() {
      return null;
    },
    async copyObject() {},
    createPresignedUpload() {
      return {
        url: `${baseUrl}/upload`,
        method: "PUT",
        headers: {},
        expiresAt: Date.now() + 300_000,
      };
    },
  };
}

describe("GET /full/:trackVersionId.mp3", () => {
  let app;
  let db;
  let r2Server;
  let seenKeys;
  let ownerToken;
  const ownerId = "full_mp3_owner";
  const strangerId = "full_mp3_stranger";

  beforeEach(async () => {
    const { server, baseUrl } = await makeFakeR2Server();
    r2Server = server;
    seenKeys = [];
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        NODE_ENV: "test",
        JWT_SECRET: process.env.JWT_SECRET,
        STORAGE_DIR: path.join(
          require("os").tmpdir(),
          `full-mp3-${Date.now()}`,
        ),
        STORAGE_PROVIDER: "s3",
      },
      storage: makeFakeS3Storage(baseUrl, seenKeys),
    });
    await app.ready();

    for (const id of [ownerId, strangerId]) {
      await db
        .prepare(
          "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, CURRENT_TIMESTAMP, 'low', 'active')",
        )
        .run(id);
    }
    const session = await authService.createSession(ownerId, {
      platform: "web",
      authMethod: "web_guest",
    });
    ownerToken = authService.generateAccessToken(ownerId, {
      sessionId: session.id,
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    if (r2Server) await new Promise((r) => r2Server.close(r));
  });

  async function seedFullReadyVersion(userId) {
    const now = new Date().toISOString();
    const trackId = `trk_${userId}`;
    const versionId = `${trackId}_v1`;
    await db
      .prepare(
        `INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, voice_mode, message, created_at, updated_at)
         VALUES (?, ?, 'complete', 'Full Song', 'birthday', 'Sam', 'pop', 'ai_voice', 'For you', ?, ?)`,
      )
      .run(trackId, userId, now, now);
    await db
      .prepare(
        `INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, lyrics_status, full_url, created_at)
         VALUES (?, ?, 1, 'full_ready', 'full', ?, 'approved', ?, ?)`,
      )
      .run(
        versionId,
        trackId,
        `${trackId}_hash`,
        "https://api.porizo.co/full/x.mp3",
        now,
      );
    return versionId;
  }

  it("serves owner's full song as audio/mpeg with non-zero body bytes", async () => {
    const versionId = await seedFullReadyVersion(ownerId);
    const res = await app.inject({
      method: "GET",
      url: `/full/${versionId}.mp3`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.headers["content-type"], "audio/mpeg");
    const len = Number(res.headers["content-length"]);
    assert.ok(len > 0, `content-length must be > 0, got ${len}`);
    assert.strictEqual(
      res.rawPayload.length,
      FAKE_AUDIO.length,
      "body bytes must match upstream payload size (byte-flow contract)",
    );
    // The mp3 key must be requested, not the .m4a master.
    assert.ok(
      seenKeys.some((k) => k.endsWith("master.mp3")),
      `expected an mp3 storage key, saw ${JSON.stringify(seenKeys)}`,
    );
  });

  it("requires authentication", async () => {
    const versionId = await seedFullReadyVersion(ownerId);
    const res = await app.inject({
      method: "GET",
      url: `/full/${versionId}.mp3`,
    });
    assert.strictEqual(res.statusCode, 401, res.body);
  });

  it("forbids a non-owner from downloading the full song", async () => {
    const versionId = await seedFullReadyVersion(ownerId);
    const strangerSession = await authService.createSession(strangerId, {
      platform: "web",
      authMethod: "web_guest",
    });
    const strangerToken = authService.generateAccessToken(strangerId, {
      sessionId: strangerSession.id,
    });
    const res = await app.inject({
      method: "GET",
      url: `/full/${versionId}.mp3`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(res.json().error, "FORBIDDEN");
  });

  it("404s an unknown track version", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/full/does_not_exist.mp3",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(res.json().error, "TRACK_VERSION_NOT_FOUND");
  });
});
