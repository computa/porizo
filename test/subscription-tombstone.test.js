/**
 * Sybil identity tombstone tests (WS3 / P1-ECON)
 *
 * Verifies that free credit grants are floored by the granted_identities tombstone:
 *   - first signup with an identity grants N songs and records the tombstone
 *   - re-registering with the SAME identity hash grants 0 songs (0-song row only)
 *   - the trial tombstone blocks a re-grant for a previously-granted identity
 *   - paid/subscription grants are NOT gated by the tombstone
 *   - high/blocked risk_level grants 0 songs
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { createPlanConfigService } = require("../src/services/plan-config");
const { clearCache } = require("../src/services/feature-flags");
const identityService = require("../src/services/identity-service");
const {
  createSubscriptionManager,
  TRANSACTION_TYPES,
} = require("../src/services/subscription-manager");

describe("Subscription tombstone (Sybil floor)", async () => {
  let db;
  let planService;
  let manager;
  let userCounter = 0;

  async function newUser(riskLevel = "low") {
    const id = `user_tomb_${Date.now()}_${++userCounter}`;
    await db.query(
      "INSERT INTO users (id, risk_level, created_at) VALUES (?, ?, datetime('now'))",
      [id, riskLevel],
    );
    return id;
  }

  async function enableTrialConfig() {
    await db.query(
      "UPDATE trial_config SET songs_allowed = 2, duration_days = 7, is_active = 1, updated_at = datetime('now') WHERE id = 1",
    );
  }

  beforeEach(async () => {
    clearCache();
    db = await getDatabase();
    planService = createPlanConfigService(db);
    manager = createSubscriptionManager(db, { planConfigService: planService });
  });

  it("first signup with an identity grants songs and records the tombstone", async () => {
    const userId = await newUser();
    const identity = { provider: "apple", subject: "apple-sub-AAA" };

    await manager.createFreeEntitlements(userId, { identity });

    const ent = await manager.getEntitlements(userId);
    assert.equal(ent.songsRemaining, 2);

    const hash = identityService.identityHash(
      identity.provider,
      identity.subject,
    );
    const rows = await db.query(
      "SELECT * FROM granted_identities WHERE identity_hash = ?",
      [hash],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].grant_kind, "signup");
  });

  it("re-registering with the same identity hash grants 0 songs", async () => {
    const identity = { provider: "apple", subject: "apple-sub-BBB" };

    // First user gets the grant.
    const first = await newUser();
    await manager.createFreeEntitlements(first, { identity });
    const firstEnt = await manager.getEntitlements(first);
    assert.equal(firstEnt.songsRemaining, 2);

    // Second user (same identity hash — e.g. delete + re-register) gets 0.
    const second = await newUser();
    await manager.createFreeEntitlements(second, { identity });
    const secondEnt = await manager.getEntitlements(second);
    assert.equal(secondEnt.songsRemaining, 0);

    // No grant ledger entry for the second user.
    const tx = await db.query(
      "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
      [second, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
    );
    assert.equal(tx.rows.length, 0);
  });

  it("grants 0 songs when risk_level is high or blocked", async () => {
    const highUser = await newUser("high");
    await manager.createFreeEntitlements(highUser, {
      identity: { provider: "email", subject: "risky@example.com" },
    });
    const highEnt = await manager.getEntitlements(highUser);
    assert.equal(highEnt.songsRemaining, 0);

    const blockedUser = await newUser("blocked");
    await manager.createFreeEntitlements(blockedUser, {
      identity: { provider: "email", subject: "blocked@example.com" },
    });
    const blockedEnt = await manager.getEntitlements(blockedUser);
    assert.equal(blockedEnt.songsRemaining, 0);
  });

  it("activateTrial is blocked by the trial tombstone for a previously-granted identity", async () => {
    await enableTrialConfig();
    const identity = { provider: "apple", subject: "apple-sub-TRIAL" };

    // First user activates trial — grants and records the trial tombstone.
    const first = await newUser();
    const result = await manager.activateTrial(first, { identity });
    assert.equal(result.songsGranted, 2);

    const hash = identityService.identityHash(
      identity.provider,
      identity.subject,
    );
    const rows = await db.query(
      "SELECT * FROM granted_identities WHERE identity_hash = ? AND grant_kind = 'trial'",
      [hash],
    );
    assert.equal(rows.rows.length, 1);

    // Second user with the same identity gets 0 trial songs.
    const second = await newUser();
    const secondResult = await manager.activateTrial(second, { identity });
    assert.equal(secondResult.songsGranted, 0);
    const secondEnt = await manager.getEntitlements(second);
    assert.equal(secondEnt.trialSongsRemaining, 0);
  });

  it("does NOT gate a paid/subscription grant by the tombstone", async () => {
    const identity = { provider: "apple", subject: "apple-sub-PAID" };

    // Burn the free tombstone with a first user.
    const first = await newUser();
    await manager.createFreeEntitlements(first, { identity });

    // A second user with the same identity is tombstoned for FREE songs...
    const second = await newUser();
    await manager.createFreeEntitlements(second, { identity });
    assert.equal((await manager.getEntitlements(second)).songsRemaining, 0);

    // ...but an admin/paid grant still works (paid path is never gated).
    await manager.adminGrantSongs(second, 5, "paid grant");
    const ent = await manager.getEntitlements(second);
    assert.equal(ent.songsRemaining, 5);
  });
});
