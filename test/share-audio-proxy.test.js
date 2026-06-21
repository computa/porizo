/**
 * Audio Proxy Contract Tests (serveTrackAudio R2 -> client)
 *
 * Pins the contract that broke silently on 2026-05-10:
 *   serveTrackAudio MUST return non-zero body bytes when upstream R2 has the file.
 *
 * The bug was in src/server.js serveTrackAudio's R2-proxy branch — it shipped
 * 200 OK with content-length: 0 because Readable.fromWeb(r2Response.body)
 * silently emitted 0 bytes under Node 20 + Fastify 4.29 + undici. Headers were
 * correct, body was empty. Web players showed "Unable to play this audio."
 *
 * Exercised via the public /preview/:trackVersionId.m4a route, which uses the
 * same serveTrackAudio proxy. (The /share/:id/audio route is now app-only-gated
 * and preview-only-at-source, so it no longer proxies the full master — but the
 * byte-forwarding contract of serveTrackAudio itself is unchanged and still
 * matters for every route that proxies from R2.)
 *
 * The existing share-flow tests use local storage so they never exercise the
 * proxy branch. This file spins up a fake R2 over loopback and asserts the
 * proxy actually forwards bytes.
 */

require("dotenv/config");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

const FAKE_AUDIO = Buffer.concat([
  Buffer.from("\x00\x00\x00\x18ftypmp42", "binary"),
  Buffer.alloc(2048, 0x42),
]);
const FAKE_CONTENT_TYPE = "audio/mp4";

function makeFakeR2Server() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (!match) {
          res.writeHead(416, {
            "Content-Range": `bytes */${FAKE_AUDIO.length}`,
            "Cache-Control": "no-store",
          });
          res.end();
          return;
        }
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : FAKE_AUDIO.length - 1;
        if (start >= FAKE_AUDIO.length || end < start) {
          res.writeHead(416, {
            "Content-Range": `bytes */${FAKE_AUDIO.length}`,
            "Cache-Control": "no-store",
          });
          res.end();
          return;
        }
        const slice = FAKE_AUDIO.subarray(start, end + 1);
        res.writeHead(206, {
          "Content-Type": FAKE_CONTENT_TYPE,
          "Content-Length": String(slice.length),
          "Content-Range": `bytes ${start}-${end}/${FAKE_AUDIO.length}`,
          "Accept-Ranges": "bytes",
        });
        res.end(slice);
        return;
      }
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

function makeFakeS3Storage(baseUrl) {
  return {
    type: "s3",
    createPresignedDownload({ key }) {
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

describe("Share audio proxy contract (R2 -> client)", () => {
  let app;
  let db;
  let r2Server;
  let storage;
  const testUserId = "share_audio_proxy_user";

  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_ANON_USER_ID = "true";

    const { server, baseUrl } = await makeFakeR2Server();
    r2Server = server;
    storage = makeFakeS3Storage(baseUrl);

    const config = {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      PUBLIC_BASE_URL: "http://localhost:3000",
      STORAGE_DIR: path.join(
        require("os").tmpdir(),
        `share-audio-proxy-${Date.now()}`,
      ),
      STORAGE_PROVIDER: "s3",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
      ALLOW_DEVICE_TOKEN_FALLBACK: true,
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({ db, config, storage });

    db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
    ).run(testUserId, new Date().toISOString(), "low");
  });

  after(async () => {
    if (r2Server) await new Promise((r) => r2Server.close(r));
    if (app) await app.close();
  });

  async function createPreviewBackedVersion() {
    const trackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": testUserId },
      payload: {
        title: "Audio Proxy Contract Song",
        recipient_name: "Tester",
        message: "Contract test message",
        style: "pop",
        occasion: "birthday",
      },
    });
    const { track_id } = JSON.parse(trackRes.body);

    const verRes = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/versions`,
      headers: { "x-user-id": testUserId },
      payload: { style: "pop" },
    });
    const { version_num } = JSON.parse(verRes.body);

    db.prepare(
      "UPDATE track_versions SET preview_url = ?, status = 'full_ready' WHERE track_id = ? AND version_num = ?",
    ).run("https://api.porizo.co/preview/x.m4a", track_id, version_num);

    const trackVersion = db
      .prepare(
        "SELECT id FROM track_versions WHERE track_id = ? AND version_num = ?",
      )
      .get(track_id, version_num);

    return {
      track_version_id: trackVersion.id,
      track_id,
      version_num,
    };
  }

  it("returns non-zero body bytes for a full-body GET", async () => {
    const { track_version_id } = await createPreviewBackedVersion();
    const res = await app.inject({
      method: "GET",
      url: `/preview/${track_version_id}.m4a`,
    });
    assert.strictEqual(res.statusCode, 200, "should be 200 OK");
    assert.match(
      res.headers["content-type"] || "",
      /^audio\//,
      "content-type should start with audio/",
    );
    const len = Number(res.headers["content-length"]);
    assert.ok(len > 0, `content-length must be > 0, got ${len}`);
    assert.ok(
      res.rawPayload.length > 0,
      `body bytes must be > 0, got ${res.rawPayload.length}`,
    );
    assert.strictEqual(
      res.rawPayload.length,
      len,
      "body bytes must match content-length header",
    );
    assert.strictEqual(
      res.rawPayload.length,
      FAKE_AUDIO.length,
      "body bytes must match upstream payload size",
    );
  });

  it("returns non-zero Content-Length for HEAD without a response body", async () => {
    const { track_version_id } = await createPreviewBackedVersion();
    const res = await app.inject({
      method: "HEAD",
      url: `/preview/${track_version_id}.m4a`,
    });
    assert.strictEqual(res.statusCode, 200, "should be 200 OK");
    const len = Number(res.headers["content-length"]);
    assert.ok(len > 0, `content-length must be > 0, got ${len}`);
    assert.strictEqual(
      len,
      FAKE_AUDIO.length,
      "HEAD content-length must match upstream payload size",
    );
    assert.strictEqual(res.rawPayload.length, 0, "HEAD must not return a body");
  });

  it("forwards Range requests with correct partial bytes", async () => {
    const { track_version_id } = await createPreviewBackedVersion();
    const res = await app.inject({
      method: "GET",
      url: `/preview/${track_version_id}.m4a`,
      headers: { Range: "bytes=0-99" },
    });
    assert.strictEqual(res.statusCode, 206, "should be 206 Partial Content");
    assert.strictEqual(
      res.rawPayload.length,
      100,
      "should return exactly 100 bytes for bytes=0-99",
    );
    assert.match(
      res.headers["content-range"] || "",
      /^bytes 0-99\//,
      "content-range must reflect requested slice",
    );
  });

  it("passes unsatisfiable Range requests through as 416", async () => {
    const { track_version_id } = await createPreviewBackedVersion();
    const res = await app.inject({
      method: "GET",
      url: `/preview/${track_version_id}.m4a`,
      headers: { Range: `bytes=${FAKE_AUDIO.length + 10}-` },
    });
    assert.strictEqual(
      res.statusCode,
      416,
      "should preserve upstream 416 for out-of-range requests",
    );
    assert.match(
      res.headers["content-range"] || "",
      /^\*\/\d+$|^bytes \*\/\d+$/,
      "content-range must expose total object length",
    );
    assert.strictEqual(res.rawPayload.length, 0, "416 must not return audio");
  });

  it("returns 502 STORAGE_EMPTY when upstream returns zero bytes", async () => {
    const emptyServer = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Length": "0",
      });
      res.end();
    });
    await new Promise((r) => emptyServer.listen(0, "127.0.0.1", r));
    const { port } = emptyServer.address();

    const original = storage.createPresignedDownload;
    storage.createPresignedDownload = ({ key }) => ({
      url: `http://127.0.0.1:${port}/${key}`,
      method: "GET",
      headers: {},
      expiresAt: Date.now() + 300_000,
    });
    try {
      const { track_version_id } = await createPreviewBackedVersion();
      const res = await app.inject({
        method: "GET",
        url: `/preview/${track_version_id}.m4a`,
      });
      assert.strictEqual(
        res.statusCode,
        502,
        "must return 502 (not 200) when upstream is empty",
      );
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "STORAGE_EMPTY");
    } finally {
      storage.createPresignedDownload = original;
      await new Promise((r) => emptyServer.close(r));
    }
  });

  it("returns 502 STORAGE_OVERSIZED before proxying oversized upstream files", async () => {
    const oversizedServer = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "audio/mp4",
        "Content-Length": String(51 * 1024 * 1024),
      });
      res.end();
    });
    await new Promise((r) => oversizedServer.listen(0, "127.0.0.1", r));
    const { port } = oversizedServer.address();

    const original = storage.createPresignedDownload;
    storage.createPresignedDownload = ({ key }) => ({
      url: `http://127.0.0.1:${port}/${key}`,
      method: "GET",
      headers: {},
      expiresAt: Date.now() + 300_000,
    });
    try {
      const { track_version_id } = await createPreviewBackedVersion();
      const res = await app.inject({
        method: "GET",
        url: `/preview/${track_version_id}.m4a`,
      });
      assert.strictEqual(res.statusCode, 502);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.error, "STORAGE_OVERSIZED");
    } finally {
      storage.createPresignedDownload = original;
      await new Promise((r) => oversizedServer.close(r));
    }
  });
});
