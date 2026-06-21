require("dotenv/config");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

let app, db, storageDir, config;
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
  process.env.NODE_ENV = "test";
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-app-only-test-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    UPLOAD_SIGNING_SECRET: "test-upload-secret",
    UPLOAD_URL_TTL_SEC: 900,
    ALLOW_DEVICE_TOKEN_FALLBACK: true,
  };
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run(USER, new Date().toISOString(), "low");
  const storage = createStorageProvider(config);
  app = buildServer({ db, config, storage });
});

after(async () => {
  if (app && app.close) await app.close();
  if (storageDir && fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true });
  }
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
