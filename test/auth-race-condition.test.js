/**
 * Test: Concurrent Token Rotation Race Condition
 *
 * Verifies that when two concurrent refresh requests arrive with the same
 * refresh token, only ONE succeeds and the other gets TOKEN_ALREADY_ROTATED.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const authService = require("../src/services/auth-service");
const { initDb } = require("../src/db");

describe("Token Rotation Race Condition", () => {
  let db;
  let dbPath;
  let tmpDir;
  let testUserId;
  let testRefreshToken;

  before(async () => {
    // Create temp db file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-race-test-"));
    dbPath = path.join(tmpDir, "test.db");

    // Initialize db with migrations
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });

    // Initialize auth service with db
    authService.initialize(db);

    // Create a test user
    testUserId = "test-user-" + Date.now();
    await db
      .prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        testUserId,
        "test-" + Date.now() + "@test.com",
        "Test User",
        new Date().toISOString(),
      );

    // Create a refresh token for testing, bound to a session — rotateRefreshToken
    // checks session binding first, so an unbound token makes BOTH concurrent
    // rotations fail ("session binding missing"), masking the rotation-conflict
    // guard this test targets.
    const raceSession = await authService.createSession(testUserId, {
      deviceName: "Race Test Device",
    });
    const tokenResult = await authService.createRefreshToken(testUserId, {
      sessionId: raceSession.id,
    });
    testRefreshToken = tokenResult.token;
    console.log("Created test refresh token for user: " + testUserId);
  });

  after(async () => {
    // Cleanup
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should fail one of two concurrent refresh requests", async () => {
    console.log("Starting concurrent rotation test...");

    // Fire two concurrent rotations with the SAME token
    const [result1, result2] = await Promise.allSettled([
      authService.rotateRefreshToken(testRefreshToken),
      authService.rotateRefreshToken(testRefreshToken),
    ]);

    // Count successes and failures
    const successes = [result1, result2].filter(
      (r) => r.status === "fulfilled",
    );
    const failures = [result1, result2].filter((r) => r.status === "rejected");

    console.log("Successes: " + successes.length);
    console.log("Failures: " + failures.length);

    if (failures.length > 0) {
      console.log(
        "Failure reason: " +
          (failures[0].reason?.code || failures[0].reason?.message),
      );
    }

    // Assertions
    assert.strictEqual(
      successes.length,
      1,
      "Exactly one request should succeed",
    );
    assert.strictEqual(failures.length, 1, "Exactly one request should fail");

    const failureCode = failures[0].reason?.code;
    assert.ok(
      ["TOKEN_ALREADY_ROTATED", "TOKEN_ROTATION_CONFLICT"].includes(
        failureCode,
      ),
      "Expected TOKEN_ALREADY_ROTATED or TOKEN_ROTATION_CONFLICT, got: " +
        failureCode,
    );

    console.log("✅ PASS: Race condition properly handled");
  });
});
