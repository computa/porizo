const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, describe, test } = require("node:test");

const { initDb } = require("../../src/db");
const {
  getEnrollmentSession,
  revokeEnrollmentSessionToken,
  revokeAllEnrollmentSessionTokensForUser,
} = require("../../src/services/enrollment-session-service");

describe("enrollment-session-service (U3)", () => {
  let db;

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run("user_a", now);
    await db
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run("user_b", now);
    const insertSession = db.prepare(
      `INSERT INTO enrollment_sessions (
        id, user_id, status, prompt_set_id, prompts_json, chunk_count,
        quality_metrics, started_at, expires_at, consent_version,
        consent_scopes, access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await insertSession.run(
      "sess_a1",
      "user_a",
      "completed",
      "default",
      "[]",
      0,
      "{}",
      now,
      now,
      "1.0",
      "voice_suno_persona_v1",
      "tok_a1",
    );
    await insertSession.run(
      "sess_a2",
      "user_a",
      "completed",
      "default",
      "[]",
      0,
      "{}",
      now,
      now,
      "1.0",
      null,
      "tok_a2",
    );
    await insertSession.run(
      "sess_b1",
      "user_b",
      "completed",
      "default",
      "[]",
      0,
      "{}",
      now,
      now,
      "1.0",
      null,
      "tok_b1",
    );
  });

  test("getEnrollmentSession returns columns persona-service consumers need", async () => {
    const row = await getEnrollmentSession(db, "sess_a1");
    assert.equal(row.id, "sess_a1");
    assert.equal(row.user_id, "user_a");
    assert.equal(row.access_token, "tok_a1");
    assert.equal(row.consent_version, "1.0");
    assert.equal(row.consent_scopes, "voice_suno_persona_v1");
  });

  test("getEnrollmentSession returns null for unknown / invalid ids", async () => {
    assert.equal(await getEnrollmentSession(db, "sess_missing"), undefined);
    assert.equal(await getEnrollmentSession(db, ""), null);
    assert.equal(await getEnrollmentSession(db, null), null);
  });

  test("revokeEnrollmentSessionToken clears access_token on a single session only", async () => {
    const result = await revokeEnrollmentSessionToken(db, "sess_a1");
    assert.equal(result.affected, 1);

    const a1 = await getEnrollmentSession(db, "sess_a1");
    const a2 = await getEnrollmentSession(db, "sess_a2");
    const b1 = await getEnrollmentSession(db, "sess_b1");
    assert.equal(a1.access_token, null, "target session token cleared");
    assert.equal(a2.access_token, "tok_a2", "sibling session untouched");
    assert.equal(b1.access_token, "tok_b1", "other-user session untouched");
  });

  test("revokeEnrollmentSessionToken on missing id is a no-op (0 affected)", async () => {
    const result = await revokeEnrollmentSessionToken(
      db,
      "sess_does_not_exist",
    );
    assert.equal(result.affected, 0);
  });

  test("revokeEnrollmentSessionToken on null/empty input is a guard no-op", async () => {
    assert.equal((await revokeEnrollmentSessionToken(db, null)).affected, 0);
    assert.equal((await revokeEnrollmentSessionToken(db, "")).affected, 0);
  });

  test("revokeAllEnrollmentSessionTokensForUser clears all sessions for one user", async () => {
    const result = await revokeAllEnrollmentSessionTokensForUser(db, "user_a");
    assert.equal(result.affected, 2);

    const a1 = await getEnrollmentSession(db, "sess_a1");
    const a2 = await getEnrollmentSession(db, "sess_a2");
    const b1 = await getEnrollmentSession(db, "sess_b1");
    assert.equal(a1.access_token, null);
    assert.equal(a2.access_token, null);
    assert.equal(b1.access_token, "tok_b1", "other-user sessions untouched");
  });

  test("revokeAllEnrollmentSessionTokensForUser is a guard no-op for empty userId", async () => {
    assert.equal(
      (await revokeAllEnrollmentSessionTokensForUser(db, null)).affected,
      0,
    );
    assert.equal(
      (await revokeAllEnrollmentSessionTokensForUser(db, "")).affected,
      0,
    );
  });
});
