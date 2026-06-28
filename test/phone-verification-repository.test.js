process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createPhoneVerificationRepository,
} = require("../src/database/phone-verification-repository");
const smsService = require("../src/services/sms-service");

const PHONE = "+15551234567";
const CODE = "123456";
const FUTURE = "9999-12-31T23:59:59.000Z";

let db;
let repository;

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function insertVerification({
  id,
  phoneNumber = PHONE,
  code = CODE,
  attempts = 0,
  expiresAt = FUTURE,
  verifiedAt = null,
  createdAt = "2026-06-27T10:00:00.000Z",
} = {}) {
  await db
    .prepare(
      `INSERT INTO phone_verifications (
        id, phone_number, code, code_hash, attempts, expires_at, verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      phoneNumber,
      code,
      hashCode(code),
      attempts,
      expiresAt,
      verifiedAt,
      createdAt,
    );
}

describe("phone verification repository boundary", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createPhoneVerificationRepository(db);
    smsService.initialize(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("repository counts recent verification codes for rate limiting", async () => {
    await insertVerification({
      id: "phone_recent_1",
      createdAt: "2026-06-27T09:30:00.000Z",
    });
    await insertVerification({
      id: "phone_recent_2",
      createdAt: "2026-06-27T09:45:00.000Z",
    });
    await insertVerification({
      id: "phone_old",
      createdAt: "2026-06-27T08:00:00.000Z",
    });

    const count = await repository.countRecentCodes({
      phoneNumber: PHONE,
      createdAfter: "2026-06-27T09:00:00.000Z",
    });
    assert.equal(Number(count.count), 2);

    const oldest = await repository.getOldestRecentCode({
      phoneNumber: PHONE,
      createdAfter: "2026-06-27T09:00:00.000Z",
    });
    assert.equal(oldest.created_at, "2026-06-27T09:30:00.000Z");
  });

  test("verifyCode increments attempts on mismatch and verifies valid codes", async () => {
    await insertVerification({ id: "phone_verify" });

    const mismatch = await smsService.verifyCode("+1 (555) 123-4567", "000000");
    assert.deepEqual(mismatch, {
      success: true,
      verified: false,
      remainingAttempts: 4,
    });
    const afterMismatch = await db
      .prepare("SELECT attempts, verified_at FROM phone_verifications WHERE id = ?")
      .get("phone_verify");
    assert.equal(Number(afterMismatch.attempts), 1);
    assert.equal(afterMismatch.verified_at, null);

    const verified = await smsService.verifyCode(PHONE, CODE);
    assert.deepEqual(verified, { success: true, verified: true });
    const afterVerify = await db
      .prepare("SELECT attempts, verified_at FROM phone_verifications WHERE id = ?")
      .get("phone_verify");
    assert.equal(Number(afterVerify.attempts), 2);
    assert.ok(afterVerify.verified_at);
  });

  test("verifyCode marks max-attempt records used and getRemainingAttempts handles no active code", async () => {
    await insertVerification({
      id: "phone_exhausted",
      attempts: 5,
    });

    const exhausted = await smsService.verifyCode(PHONE, CODE);
    assert.equal(exhausted.success, true);
    assert.equal(exhausted.verified, false);
    assert.equal(exhausted.remainingAttempts, 0);

    const row = await db
      .prepare("SELECT verified_at FROM phone_verifications WHERE id = ?")
      .get("phone_exhausted");
    assert.ok(row.verified_at);

    const remaining = await smsService.getRemainingAttempts(PHONE);
    assert.deepEqual(remaining, {
      success: true,
      remainingAttempts: 5,
      hasActiveCode: false,
    });
  });

  test("cleanupExpiredCodes deletes records created before the cleanup window", async () => {
    await insertVerification({
      id: "phone_cleanup_old",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    await insertVerification({
      id: "phone_cleanup_recent",
      createdAt: new Date().toISOString(),
    });

    const result = await smsService.cleanupExpiredCodes();
    assert.equal(result.deleted, 1);

    const remaining = await db
      .prepare("SELECT id FROM phone_verifications ORDER BY id")
      .all();
    assert.deepEqual(remaining.map((row) => row.id), ["phone_cleanup_recent"]);
  });
});
