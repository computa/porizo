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
