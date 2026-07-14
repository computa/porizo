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

  it("keeps a committed result recoverable for the original requester during the recovery window", async () => {
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
    assert.deepEqual(
      await service.exchange({
        transactionId: created.transactionId,
        platform: "android",
        linkSecret: created.linkSecret,
        requestSecret: created.requestSecret,
      }),
      recovered,
    );
  });

  it("requires explicit link approval before requester-only completion", async () => {
    const created = await service.createTransaction({
      email: "browser-fallback@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "browser-fallback-device",
    });

    assert.equal((await service.status({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    })).status, "pending");
    assert.equal((await service.completeApproved({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    })).status, "invalid");
    assert.equal((await service.approve({
      transactionId: created.transactionId,
      platform: "ios",
      linkSecret: created.linkSecret,
    })).status, "approved");
    assert.equal((await service.status({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    })).status, "approved");

    const completed = await service.completeApproved({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
      consume: async () => ({ sessionId: "session-browser-fallback" }),
    });
    assert.deepEqual(completed, {
      status: "consumed",
      result: { sessionId: "session-browser-fallback" },
    });
    assert.equal((await service.status({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    })).status, "consumed");
  });

  it("keeps a consumed transaction recoverable after the original link expires", async () => {
    const createdAt = new Date(now);
    const created = await service.createTransaction({
      email: "response-loss@example.com",
      platform: "ios",
      purpose: "login",
      requesterKey: "response-loss-device",
    });
    now = new Date(createdAt.getTime() + MAGIC_LOGIN_TTL_MS - 1_000);
    assert.equal((await service.approve({
      transactionId: created.transactionId,
      platform: "ios",
      linkSecret: created.linkSecret,
    })).status, "approved");
    assert.equal((await service.completeApproved({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
      consume: async () => ({ sessionId: "session-response-loss" }),
    })).status, "consumed");

    now = new Date(createdAt.getTime() + MAGIC_LOGIN_TTL_MS + 1_000);
    assert.equal((await service.status({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    })).status, "consumed");
    assert.deepEqual(await service.completeApproved({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    }), {
      status: "recovered",
      result: { sessionId: "session-response-loss" },
    });
    assert.deepEqual(await service.completeApproved({
      transactionId: created.transactionId,
      platform: "ios",
      requestSecret: created.requestSecret,
    }), {
      status: "recovered",
      result: { sessionId: "session-response-loss" },
    });
  });

  it("does not approve with the wrong link factor", async () => {
    const created = await service.createTransaction({
      email: "wrong-link-factor@example.com",
      platform: "android",
      purpose: "login",
      requesterKey: "wrong-link-factor-device",
    });

    assert.equal((await service.approve({
      transactionId: created.transactionId,
      platform: "android",
      linkSecret: "wrong-secret",
    })).status, "invalid");
    assert.equal((await service.status({
      transactionId: created.transactionId,
      platform: "android",
      requestSecret: created.requestSecret,
    })).status, "pending");
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

  it("requires account and session binding together for add-email transactions", async () => {
    await assert.rejects(
      service.createTransaction({
        email: "binding@example.com",
        platform: "ios",
        purpose: "add_email",
        requesterKey: "binding-device",
        accountId: "account-only",
      }),
      /INVALID_MAGIC_LOGIN_SESSION_BINDING/,
    );
  });

  it("rejects oversized transaction and secret values before repository work", async () => {
    assert.deepEqual(
      await service.exchange({
        transactionId: "x".repeat(129),
        platform: "ios",
        linkSecret: "link",
        requestSecret: "request",
      }),
      { status: "invalid" },
    );
    assert.deepEqual(
      await service.exchange({
        transactionId: "valid-id",
        platform: "ios",
        linkSecret: "x".repeat(513),
        requestSecret: "request",
      }),
      { status: "invalid" },
    );
  });
});
