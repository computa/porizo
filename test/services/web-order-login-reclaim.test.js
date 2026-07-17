"use strict";

process.env.NODE_ENV = "test";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  reclaimGuestOrdersOnLogin,
} = require("../../src/services/web-order-login-reclaim");
const {
  createIdentityRepository,
} = require("../../src/database/identity-repository");
const { createPreparedDbFromQuery } = require("../../src/utils/db-adapter");

const NOW = "2026-07-17T10:00:00.000Z";

function txIdentityRepo(query, db) {
  return createIdentityRepository(createPreparedDbFromQuery(query, db));
}

async function seedUser(db, id, accountStatus = "active") {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', ?)",
    )
    .run(id, NOW, accountStatus);
  await db
    .prepare(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
    )
    .run(id, NOW);
}

async function addEmailAuthFactor(db, userId, email) {
  await db
    .prepare(
      `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, status, created_at)
       VALUES (?, ?, 'email', ?, 'active', ?)`,
    )
    .run(`uap_${userId}`, userId, email, NOW);
}

async function seedOrder(
  db,
  { id, userId, email, status = "delivered", versionSuffix = "v1" },
) {
  const trackId = `trk_${id}`;
  const versionId = `${trackId}_${versionSuffix}`;
  await db
    .prepare(
      `INSERT INTO web_orders (
         id, checkout_session_id, user_id, track_id, track_version_id,
         price_key, amount_cents, currency, email, status,
         render_attempts, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'gift_bundle_1', 199, 'usd', ?, ?, 0, ?, ?)`,
    )
    .run(id, `cs_${id}`, userId, trackId, versionId, email, status, NOW, NOW);
  return { orderId: id, trackId, versionId };
}

async function ownerOfOrder(db, orderId) {
  const row = await db
    .prepare("SELECT user_id FROM web_orders WHERE id = ?")
    .get(orderId);
  return row?.user_id;
}

describe("reclaimGuestOrdersOnLogin", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
  });

  afterEach(async () => {
    await db.close?.();
  });

  it("reclaims a paid order from a promoted-guest shell into the logging-in account", async () => {
    // First-time buyer: guest was promoted to 'active' at payment, holds an
    // unverified email contact but NO auth factor (a merge-safe shell).
    await seedUser(db, "guest_buyer", "active");
    await seedOrder(db, {
      id: "ord_1",
      userId: "guest_buyer",
      email: "chioma@example.com",
    });
    // The account this login resolves to (fresh account created by the login).
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");

    const out = await db.transaction(async (query) => {
      const identityRepository = txIdentityRepo(query, db);
      return reclaimGuestOrdersOnLogin(query, {
        loginUserId: "login_acct",
        emailNormalized: "chioma@example.com",
        identityRepository,
      });
    });

    assert.equal(out.reclaimed, 1);
    assert.equal(await ownerOfOrder(db, "ord_1"), "login_acct");
  });

  it("does NOT reclaim an order whose checkout email differs from the login email", async () => {
    await seedUser(db, "guest_buyer", "active");
    await seedOrder(db, {
      id: "ord_2",
      userId: "guest_buyer",
      email: "someone-else@example.com",
    });
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");

    const out = await db.transaction(async (query) => {
      const identityRepository = txIdentityRepo(query, db);
      return reclaimGuestOrdersOnLogin(query, {
        loginUserId: "login_acct",
        emailNormalized: "chioma@example.com",
        identityRepository,
      });
    });

    assert.equal(out.reclaimed, 0);
    assert.equal(await ownerOfOrder(db, "ord_2"), "guest_buyer");
  });

  it("does NOT merge away a real account that has its own non-email auth factor", async () => {
    // The checkout email happens to sit on an account that ALSO logs in with
    // Apple — reclaiming it would be account takeover / data loss. Skip it.
    await seedUser(db, "real_acct", "active");
    await db
      .prepare(
        `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, status, created_at)
         VALUES ('uap_apple', 'real_acct', 'apple', 'apple_sub_xyz', 'active', ?)`,
      )
      .run(NOW);
    await seedOrder(db, {
      id: "ord_3",
      userId: "real_acct",
      email: "chioma@example.com",
    });
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");

    const out = await db.transaction(async (query) => {
      const identityRepository = txIdentityRepo(query, db);
      return reclaimGuestOrdersOnLogin(query, {
        loginUserId: "login_acct",
        emailNormalized: "chioma@example.com",
        identityRepository,
      });
    });

    assert.equal(out.reclaimed, 0);
    assert.equal(await ownerOfOrder(db, "ord_3"), "real_acct");
  });

  it("does NOT reclaim a pending/abandoned order (no delivered value)", async () => {
    await seedUser(db, "guest_buyer", "active");
    await seedOrder(db, {
      id: "ord_4",
      userId: "guest_buyer",
      email: "chioma@example.com",
      status: "pending",
    });
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");

    const out = await db.transaction(async (query) => {
      const identityRepository = txIdentityRepo(query, db);
      return reclaimGuestOrdersOnLogin(query, {
        loginUserId: "login_acct",
        emailNormalized: "chioma@example.com",
        identityRepository,
      });
    });

    assert.equal(out.reclaimed, 0);
    assert.equal(await ownerOfOrder(db, "ord_4"), "guest_buyer");
  });

  it("is idempotent — a second login finds nothing to move", async () => {
    await seedUser(db, "guest_buyer", "active");
    await seedOrder(db, {
      id: "ord_5",
      userId: "guest_buyer",
      email: "chioma@example.com",
    });
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");

    const run = () =>
      db.transaction(async (query) => {
        const identityRepository = txIdentityRepo(query, db);
        return reclaimGuestOrdersOnLogin(query, {
          loginUserId: "login_acct",
          emailNormalized: "chioma@example.com",
          identityRepository,
        });
      });

    const first = await run();
    const second = await run();
    assert.equal(first.reclaimed, 1);
    assert.equal(second.reclaimed, 0);
    assert.equal(await ownerOfOrder(db, "ord_5"), "login_acct");
  });

  it("returns 0 when the login user already owns the order (no self-merge)", async () => {
    await seedUser(db, "login_acct", "active");
    await addEmailAuthFactor(db, "login_acct", "chioma@example.com");
    await seedOrder(db, {
      id: "ord_6",
      userId: "login_acct",
      email: "chioma@example.com",
    });

    const out = await db.transaction(async (query) => {
      const identityRepository = txIdentityRepo(query, db);
      return reclaimGuestOrdersOnLogin(query, {
        loginUserId: "login_acct",
        emailNormalized: "chioma@example.com",
        identityRepository,
      });
    });

    assert.equal(out.reclaimed, 0);
    assert.equal(await ownerOfOrder(db, "ord_6"), "login_acct");
  });
});
