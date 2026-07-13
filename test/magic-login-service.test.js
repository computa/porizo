"use strict";

process.env.NODE_ENV = "test";

const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../src/database/sqlite");
const {
  createMagicLoginRepository,
} = require("../src/database/magic-login-repository");
const {
  createMagicLoginService,
  MAGIC_LOGIN_TTL_MS,
} = require("../src/services/magic-login-service");

describe("magic login service", () => {
  let db;
  let repository;
  let service;
  let now;

  before(async () => {
    db = await initDb({
      migrationsDir: path.join(__dirname, "..", "migrations"),
    });
    repository = createMagicLoginRepository(db);
    now = new Date("2026-07-11T02:00:00.000Z");
    service = createMagicLoginService({
      repository,
      now: () => new Date(now),
    });
  });

  after(async () => db.close());

  it("stores two independent hashes and expires transactions after 15 minutes", async () => {
    const created = await service.createTransaction({
      email: " Person@Example.COM ",
      platform: "ios",
      purpose: "login",
      requesterKey: "device-a",
      ipAddress: "203.0.113.4",
    });

    const row = await repository.findById(created.transactionId);
    assert.equal(row.emailNormalized, "person@example.com");
    assert.equal(row.platform, "ios");
    assert.notEqual(row.linkSecretHash, created.linkSecret);
    assert.notEqual(row.requestSecretHash, created.requestSecret);
    assert.notEqual(row.linkSecretHash, row.requestSecretHash);
    assert.equal(
      Date.parse(row.expiresAt) - Date.parse(row.createdAt),
      MAGIC_LOGIN_TTL_MS,
    );
  });

  it("rejects a mismatched platform without consuming the transaction", async () => {
    const created = await service.createTransaction({
      email: "person@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "device-b",
    });

    const result = await service.exchange({
      transactionId: created.transactionId,
      platform: "android",
      linkSecret: created.linkSecret,
      requestSecret: created.requestSecret,
      consume: async () => ({ sessionId: "must-not-run" }),
    });

    assert.equal(result.status, "invalid");
    assert.equal((await repository.findById(created.transactionId)).status, "pending");
  });

  it("requires both secrets and conditionally consumes only once", async () => {
    const created = await service.createTransaction({
      email: "person@example.com",
      platform: "web",
      purpose: "login",
      requesterKey: "browser-a",
    });

    assert.equal(
      (
        await service.exchange({
          transactionId: created.transactionId,
          platform: "web",
          linkSecret: created.linkSecret,
          requestSecret: "wrong",
        })
      ).status,
      "invalid",
    );

    const first = await service.exchange({
      transactionId: created.transactionId,
      platform: "web",
      linkSecret: created.linkSecret,
      requestSecret: created.requestSecret,
      consume: async (_transaction, transactionRepository) => {
        assert.ok(transactionRepository);
        return { sessionId: "session-one", tokenFamilyId: "family-one" };
      },
    });
    assert.deepEqual(first, {
      status: "consumed",
      result: { sessionId: "session-one", tokenFamilyId: "family-one" },
    });

    const replay = await service.exchange({
      transactionId: created.transactionId,
      platform: "web",
      linkSecret: created.linkSecret,
      requestSecret: "another-requester",
    });
    assert.equal(replay.status, "invalid");
  });

  it("recovers a committed result once for the original requester", async () => {
    const created = await service.createTransaction({
      email: "person@example.com",
      platform: "android",
      purpose: "login",
      requesterKey: "device-c",
    });
    await service.exchange({
      transactionId: created.transactionId,
      platform: "android",
      linkSecret: created.linkSecret,
      requestSecret: created.requestSecret,
      consume: async () => ({ sessionId: "session-recover" }),
    });
    const stored = await repository.findById(created.transactionId);
    assert.equal(stored.recoveryResult.sessionId, undefined);
    assert.equal(stored.recoveryResult.v, 1);
    assert.ok(stored.recoveryResult.ciphertext);

    const recovered = await service.exchange({
      transactionId: created.transactionId,
      platform: "android",
      linkSecret: created.linkSecret,
      requestSecret: created.requestSecret,
    });
    assert.deepEqual(recovered, {
      status: "recovered",
      result: { sessionId: "session-recover" },
    });
    assert.equal(
      (
        await service.exchange({
          transactionId: created.transactionId,
          platform: "android",
          linkSecret: created.linkSecret,
          requestSecret: created.requestSecret,
        })
      ).status,
      "invalid",
    );
  });

  it("provides active-cap, cooldown, and expiry cleanup primitives", async () => {
    await service.createTransaction({
      email: "caps@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "device-caps",
      accountId: null,
    });

    assert.equal(
      await repository.countActive({ emailNormalized: "caps@example.com" }, now.toISOString()),
      1,
    );
    assert.ok(
      await repository.findRecentActive({
        requesterKeyHash: service.hashRequesterKey("device-caps"),
        since: new Date(now.getTime() - 60_000).toISOString(),
      }),
    );

    now = new Date(now.getTime() + MAGIC_LOGIN_TTL_MS + 1);
    assert.ok((await repository.cleanupExpired(now.toISOString())) >= 1);
    assert.equal(
      await repository.countActive({ emailNormalized: "caps@example.com" }, now.toISOString()),
      0,
    );
  });
});
