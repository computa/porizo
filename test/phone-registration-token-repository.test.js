process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createPhoneRegistrationTokenRepository,
} = require("../src/database/phone-registration-token-repository");

let db;
let repository;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function insertToken({
  token = "registration-token",
  phoneHash = "phone-hash",
  ipAddress = "203.0.113.10",
  verifiedAt = "2026-06-28 10:00:00",
  expiresAt = "9999-12-31 23:59:59",
} = {}) {
  const tokenHash = sha256(token);
  await repository.insert({
    tokenHash,
    phoneNumberHash: phoneHash,
    ipAddress,
    verifiedAt,
    expiresAt,
  });
  return tokenHash;
}

describe("PhoneRegistrationTokenRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createPhoneRegistrationTokenRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("consume marks a matching token once and rejects replay", async () => {
    const tokenHash = await insertToken();

    const consumed = await repository.consume({
      tokenHash,
      phoneNumberHash: "phone-hash",
      ipAddress: "203.0.113.10",
    });
    assert.equal(consumed.changes, 1);

    const replay = await repository.consume({
      tokenHash,
      phoneNumberHash: "phone-hash",
      ipAddress: "203.0.113.10",
    });
    assert.equal(replay.changes, 0);
  });

  test("consume preserves legacy null-IP fallback and rejects mismatched IP-bound tokens", async () => {
    const legacyTokenHash = await insertToken({
      token: "legacy-token",
      ipAddress: null,
    });
    const ipBoundTokenHash = await insertToken({
      token: "ip-bound-token",
      ipAddress: "203.0.113.20",
    });

    const legacy = await repository.consume({
      tokenHash: legacyTokenHash,
      phoneNumberHash: "phone-hash",
      ipAddress: "203.0.113.99",
    });
    assert.equal(legacy.changes, 1);

    const mismatch = await repository.consume({
      tokenHash: ipBoundTokenHash,
      phoneNumberHash: "phone-hash",
      ipAddress: "203.0.113.99",
    });
    assert.equal(mismatch.changes, 0);
  });

  test("findRecentVerification returns newest matching token for IP-bound or legacy proof", async () => {
    await insertToken({
      token: "old-token",
      verifiedAt: "2026-06-28 09:00:00",
    });
    await insertToken({
      token: "new-token",
      verifiedAt: "2026-06-28 10:00:00",
      ipAddress: "203.0.113.10",
    });
    await insertToken({
      token: "wrong-ip-token",
      verifiedAt: "2026-06-28 11:00:00",
      ipAddress: "203.0.113.20",
    });

    const recent = await repository.findRecentVerification({
      phoneNumberHash: "phone-hash",
      verifiedAfter: "2026-06-28 08:00:00",
      ipAddress: "203.0.113.10",
    });
    assert.deepEqual(recent, { token_hash: sha256("new-token") });
  });

  test("deleteExpired and deleteAll preserve cleanup semantics", async () => {
    await insertToken({
      token: "expired-token",
      expiresAt: "2000-01-01 00:00:00",
    });
    await insertToken({
      token: "future-token",
      expiresAt: "9999-12-31 23:59:59",
    });

    const deletedExpired = await repository.deleteExpired();
    assert.equal(deletedExpired.changes, 1);
    assert.deepEqual(
      (await db.prepare("SELECT token_hash FROM phone_registration_tokens").all())
        .map((row) => row.token_hash),
      [sha256("future-token")],
    );

    const deletedAll = await repository.deleteAll();
    assert.equal(deletedAll.changes, 1);
    assert.deepEqual(
      await db.prepare("SELECT token_hash FROM phone_registration_tokens").all(),
      [],
    );
  });
});
