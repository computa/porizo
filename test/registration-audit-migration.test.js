"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
const path = require("node:path");

test("guest auth-event migration preserves existing events and constraints", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE auth_events (
        id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL, ip_address TEXT, user_agent TEXT,
        metadata TEXT, created_at TEXT
      );
      INSERT INTO users VALUES ('audit_user');
      INSERT INTO auth_events VALUES (
        'retained_event', 'audit_user', 'signup_success', NULL, NULL,
        '{"method":"email","name_supplied":false}', '2026-10-01T00:00:00Z'
      );
    `);
    db.exec(readFileSync(path.join(__dirname, "../migrations/142_guest_creation_auth_event.sql"), "utf8"));
    const event = db.prepare("SELECT event_type, metadata, created_at FROM auth_events WHERE id = ?").get("retained_event");
    assert.equal(event.event_type, "signup_success");
    assert.deepEqual(JSON.parse(event.metadata), { method: "email", name_supplied: false });
    assert.equal(event.created_at, "2026-10-01T00:00:00Z");
    db.prepare("INSERT INTO auth_events (id, user_id, event_type) VALUES (?, ?, ?)").run("guest_event", "audit_user", "guest_created");
    assert.throws(() => db.prepare("INSERT INTO auth_events (id, event_type) VALUES (?, ?)").run("invalid_event", "unsupported"), /CHECK constraint/);
    db.prepare("DELETE FROM users WHERE id = ?").run("audit_user");
    assert.equal(db.prepare("SELECT user_id FROM auth_events WHERE id = ?").get("guest_event").user_id, null);
  } finally {
    db.close();
  }
});
