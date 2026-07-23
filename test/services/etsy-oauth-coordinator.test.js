"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-etsy-oauth-32-bytes";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, beforeEach, describe, it } = require("node:test");
const { initDb } = require("../../src/db");
const {
  bootstrapEtsyConnection,
  createEtsyOAuthCoordinator,
} = require("../../src/services/etsy-oauth-coordinator");
const { decryptValue, encryptValue } = require("../../src/services/etsy-secrets");

describe("distributed Etsy OAuth refresh coordination", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
    await db
      .prepare(
        `INSERT INTO etsy_connections
          (shop_id, access_token_encrypted, refresh_token_encrypted,
           token_version, bootstrap_token_fingerprint, status, created_at,
           updated_at, bootstrap_generation)
         VALUES ('shop_123', ?, ?, 4, ?, 'connected', CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP, 4
                )`,
      )
      .run(
        encryptValue("expired-access"),
        encryptValue("refresh-4"),
        crypto.createHash("sha256").update("refresh-4").digest("hex"),
      );
  });

  afterEach(async () => {
    await db.close();
  });

  it("leases one refresh and lets another replica reuse the rotated token", async () => {
    const first = createEtsyOAuthCoordinator({
      db,
      shopId: "shop_123",
      pollMs: 5,
      maxPolls: 20,
    });
    const second = createEtsyOAuthCoordinator({
      db,
      shopId: "shop_123",
      pollMs: 5,
      maxPolls: 20,
    });
    let providerRefreshes = 0;
    const tokens = {
      accessToken: "expired-access",
      refreshToken: "refresh-4",
      tokenVersion: 4,
    };
    const winner = first.coordinate({
      tokens,
      performRefresh: async () => {
        providerRefreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        await db
          .prepare(
            `UPDATE etsy_connections
                SET access_token_encrypted = ?, refresh_token_encrypted = ?,
                    token_version = 5, refresh_lease_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE shop_id = 'shop_123'`,
          )
          .run(encryptValue("access-5"), encryptValue("refresh-5"));
        return {
          accessToken: "access-5",
          refreshToken: "refresh-5",
          tokenVersion: 5,
        };
      },
    });
    const follower = second.coordinate({
      tokens,
      performRefresh: async () => {
        providerRefreshes += 1;
        throw new Error("second replica must not refresh");
      },
    });

    const [winnerTokens, followerTokens] = await Promise.all([winner, follower]);
    assert.equal(providerRefreshes, 1);
    assert.equal(winnerTokens.accessToken, "access-5");
    assert.equal(followerTokens.accessToken, "access-5");
    assert.equal(followerTokens.tokenVersion, 5);
  });

  it("does not let stale invalid_grant mark a newer token version disconnected", async () => {
    await db
      .prepare(
        "UPDATE etsy_connections SET token_version = 5 WHERE shop_id = 'shop_123'",
      )
      .run();
    const coordinator = createEtsyOAuthCoordinator({
      db,
      shopId: "shop_123",
    });
    const result = await coordinator.markReconnectRequired({
      tokens: { tokenVersion: 4 },
    });
    assert.equal(result.changes, 0);
    const row = await db
      .prepare(
        "SELECT status, token_version FROM etsy_connections WHERE shop_id = 'shop_123'",
      )
      .get();
    assert.equal(row.status, "connected");
    assert.equal(Number(row.token_version), 5);
  });

  it("reconnect bootstrap replaces only a reconnect-required token generation", async () => {
    const untouched = await bootstrapEtsyConnection({
      db,
      shopId: "shop_123",
      accessToken: "must-not-overwrite",
      refreshToken: "must-not-overwrite",
      bootstrapGeneration: 4,
    });
    assert.equal(untouched.changed, false);

    await db
      .prepare(
        "UPDATE etsy_connections SET status = 'reconnect_required' WHERE shop_id = 'shop_123'",
      )
      .run();
    const stale = await bootstrapEtsyConnection({
      db,
      shopId: "shop_123",
      accessToken: "expired-access",
      refreshToken: "refresh-4",
      bootstrapGeneration: 4,
    });
    assert.equal(stale.changed, false);
    const stillDisconnected = await db
      .prepare(
        "SELECT status FROM etsy_connections WHERE shop_id = 'shop_123'",
      )
      .get();
    assert.equal(stillDisconnected.status, "reconnect_required");

    const replaced = await bootstrapEtsyConnection({
      db,
      shopId: "shop_123",
      accessToken: "reconnected-access",
      refreshToken: "reconnected-refresh",
      bootstrapGeneration: 5,
    });
    assert.equal(replaced.changed, true);
    const row = await db
      .prepare(
        `SELECT access_token_encrypted, refresh_token_encrypted, status,
                token_version
           FROM etsy_connections WHERE shop_id = 'shop_123'`,
      )
      .get();
    assert.equal(row.status, "connected");
    assert.equal(Number(row.token_version), 5);
    assert.equal(decryptValue(row.access_token_encrypted), "reconnected-access");
    assert.equal(
      decryptValue(row.refresh_token_encrypted),
      "reconnected-refresh",
    );

    await db
      .prepare(
        "UPDATE etsy_connections SET status = 'reconnect_required' WHERE shop_id = 'shop_123'",
      )
      .run();
    const rolledBack = await bootstrapEtsyConnection({
      db,
      shopId: "shop_123",
      accessToken: "rolled-back-access",
      refreshToken: "refresh-4",
      bootstrapGeneration: 4,
    });
    assert.equal(rolledBack.changed, false);
    const afterRollback = await db
      .prepare(
        "SELECT access_token_encrypted, bootstrap_generation FROM etsy_connections WHERE shop_id = 'shop_123'",
      )
      .get();
    assert.equal(decryptValue(afterRollback.access_token_encrypted), "reconnected-access");
    assert.equal(Number(afterRollback.bootstrap_generation), 5);
  });
});
