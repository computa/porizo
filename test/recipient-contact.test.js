// test/recipient-contact.test.js — TDD: assert POST /tracks stores recipient contact
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const config = require("../src/config");

let app, db;
const USER = "rc-user";
before(async () => {
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?,?,?)",
  ).run(USER, new Date().toISOString(), "low");
  app = buildServer({
    db,
    config: { ...config, STORAGE_PROVIDER: "local" },
    storage: createStorageProvider({ ...config, STORAGE_PROVIDER: "local" }),
  });
});
after(async () => {
  if (app) await app.close();
});

describe("recipient contact on tracks", () => {
  it("POST /tracks stores recipient_phone + recipient_channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": USER },
      payload: {
        title: "T",
        recipient_name: "R",
        message: "m",
        style: "pop",
        occasion: "birthday",
        recipient_phone: "+61412345678",
        recipient_channel: "imessage",
      },
    });
    const { track_id } = JSON.parse(res.body);
    const row = db
      .prepare(
        "SELECT recipient_phone, recipient_channel FROM tracks WHERE id = ?",
      )
      .get(track_id);
    assert.equal(row.recipient_phone, "+61412345678");
    assert.equal(row.recipient_channel, "imessage");
  });
  it("POST /tracks works with no recipient contact (nullable)", async () => {
    const res = await app.inject({
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
    assert.equal(res.statusCode, 201);
  });
});

describe("PIN-less shares", () => {
  it("POST /tracks/:id/share with require_pin:false sets no claim_pin", async () => {
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
    await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/versions`,
      headers: { "x-user-id": USER },
      payload: { style: "pop" },
    });
    db.prepare(
      "UPDATE track_versions SET preview_url='x', status='preview_ready' WHERE track_id=?",
    ).run(track_id);
    const s = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1, require_pin: false },
    });
    const { share_id } = JSON.parse(s.body);
    const row = db
      .prepare("SELECT claim_pin FROM share_tokens WHERE id = ?")
      .get(share_id);
    assert.equal(row.claim_pin, null);
  });
  it("re-sharing an existing PINned share with require_pin:false strips the PIN", async () => {
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
    await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/versions`,
      headers: { "x-user-id": USER },
      payload: { style: "pop" },
    });
    db.prepare(
      "UPDATE track_versions SET preview_url='x', status='preview_ready' WHERE track_id=?",
    ).run(track_id);
    // First share WITH a PIN (default), then re-share PIN-less. The idempotent
    // route path must reuse the SAME token and STRIP its PIN, not hand back the
    // stale PINned token nor mint a fresh one.
    const s1 = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1 },
    });
    const id1 = JSON.parse(s1.body).share_id;
    const s2 = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1, require_pin: false },
    });
    const { share_id } = JSON.parse(s2.body);
    assert.equal(share_id, id1, "same token reused, not recreated");
    const row = db
      .prepare("SELECT claim_pin FROM share_tokens WHERE id = ?")
      .get(share_id);
    assert.equal(row.claim_pin, null);
  });
});
