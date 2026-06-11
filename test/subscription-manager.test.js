/**
 * Subscription Manager Tests
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { createPlanConfigService } = require("../src/services/plan-config");
const { clearCache, setFeatureFlag } = require("../src/services/feature-flags");
const {
  createSubscriptionManager,
  TRANSACTION_TYPES,
  STATUS,
} = require("../src/services/subscription-manager");

describe("Subscription Manager", async () => {
  let db;
  let planService;
  let manager;
  let testUserId;
  let testTxCounter = 0;

  /**
   * Generate unique mock Apple validation per test
   * Each call gets unique transaction IDs to avoid conflicts
   */
  function createMockAppleValidation(overrides = {}) {
    const uniqueId = `${Date.now()}_${++testTxCounter}`;
    return {
      valid: true,
      type: "subscription",
      platform: "apple",
      transactionId: `tx_${uniqueId}`,
      originalTransactionId: `otx_${uniqueId}`,
      productId: "com.porizo.plus_monthly",
      status: "active",
      isActive: true,
      isExpired: false,
      isRevoked: false,
      isInGracePeriod: false,
      isInBillingRetry: false,
      purchaseDate: new Date(),
      originalPurchaseDate: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodExpiresAt: null,
      autoRenewEnabled: true,
      isTrialPeriod: false,
      environment: "sandbox",
      ...overrides,
    };
  }

  beforeEach(async () => {
    clearCache();
    db = await getDatabase();
    planService = createPlanConfigService(db);
    manager = createSubscriptionManager(db, { planConfigService: planService });

    // Create test user with unique ID
    testUserId = `user_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
      [testUserId],
    );
  });

  async function enableTrialConfig() {
    await db.query(
      "UPDATE trial_config SET songs_allowed = 2, duration_days = 7, is_active = 1, updated_at = datetime('now') WHERE id = 1",
    );
  }

  describe("createFreeEntitlements", () => {
    it("grants the default two one-time signup songs and records the grant", async () => {
      await manager.createFreeEntitlements(testUserId);

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "free");
      assert.equal(ent.baseSongsRemaining, 2);
      assert.equal(ent.songsRemaining, 2);
      assert.equal(ent.trialSongsRemaining, 0);

      const tx = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
      );
      assert.equal(tx.rows.length, 1);
      assert.equal(Number(tx.rows[0].amount), 2);
      assert.equal(Number(tx.rows[0].balance_before), 0);
      assert.equal(Number(tx.rows[0].balance_after), 2);
    });

    it("honors the admin-configured signup song grant for future users", async () => {
      await setFeatureFlag(db, "free_tier_songs_grant", 3, "test");

      await manager.createFreeEntitlements(testUserId);

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 3);

      const tx = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
      );
      assert.equal(Number(tx.rows[0].amount), 3);
    });

    it("does not duplicate the signup grant when entitlements already exist", async () => {
      await manager.createFreeEntitlements(testUserId);
      await manager.createFreeEntitlements(testUserId);

      const tx = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
      );
      assert.equal(tx.rows.length, 1);

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 2);
    });
  });

  describe("activateTrial", () => {
    it("does not activate trial by default", async () => {
      await assert.rejects(
        () => manager.activateTrial(testUserId),
        /Free trial is currently disabled/,
      );
    });

    it("grants trial songs to new user", async () => {
      await enableTrialConfig();

      const result = await manager.activateTrial(testUserId);

      assert.equal(result.songsGranted, 2);
      assert.equal(result.durationDays, 7);
      assert.ok(result.trialExpiresAt instanceof Date);

      // Verify entitlements
      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "free");
      assert.equal(ent.trialSongsRemaining, 2);
      assert.equal(ent.songsRemaining, 2);
    });

    it("prevents duplicate trial activation", async () => {
      await enableTrialConfig();

      await manager.activateTrial(testUserId);

      await assert.rejects(
        () => manager.activateTrial(testUserId),
        /already used their free trial/,
      );
    });

    it("records song transaction for trial grant", async () => {
      await enableTrialConfig();

      await manager.activateTrial(testUserId);

      const txResult = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.TRIAL_GRANT],
      );

      assert.equal(txResult.rows.length, 1);
      assert.equal(txResult.rows[0].amount, 2);
      assert.equal(txResult.rows[0].balance_after, 2);
    });
  });

  describe("syncSubscription", () => {
    it("creates new subscription and grants songs", async () => {
      const mockValidation = createMockAppleValidation();
      const result = await manager.syncSubscription(testUserId, mockValidation);

      assert.ok(result.subscriptionId);
      assert.equal(result.isNewSubscription, true);
      assert.equal(result.tier, "plus");
      assert.equal(result.songsGranted, 10);
      assert.equal(result.status, "active");

      // Verify entitlements updated
      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "plus");
      assert.equal(ent.songsRemaining, 10);
      assert.equal(ent.songsAllowance, 10);
    });

    it("handles subscription renewal", async () => {
      // First subscription - create with shared originalTransactionId for renewal
      const originalTxId = `otx_renewal_${Date.now()}`;
      const firstValidation = createMockAppleValidation({
        transactionId: `tx_first_${Date.now()}`,
        originalTransactionId: originalTxId,
      });
      const firstResult = await manager.syncSubscription(
        testUserId,
        firstValidation,
      );

      // Simulate renewal with same originalTransactionId but new transactionId
      const renewalValidation = createMockAppleValidation({
        transactionId: `tx_renewal_${Date.now()}`,
        originalTransactionId: originalTxId,
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });

      const renewResult = await manager.syncSubscription(
        testUserId,
        renewalValidation,
      );

      assert.equal(renewResult.subscriptionId, firstResult.subscriptionId);
      assert.equal(renewResult.isRenewal, true);
      assert.equal(renewResult.songsGranted, 10);

      // Should have 10 songs (reset to plan allowance on renewal)
      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 10);
    });

    it("does not grant renewal songs when subscription is expired and downgrades entitlements", async () => {
      const originalTxId = `otx_expired_${Date.now()}`;
      await manager.syncSubscription(
        testUserId,
        createMockAppleValidation({
          transactionId: `tx_active_${Date.now()}`,
          originalTransactionId: originalTxId,
        }),
      );

      const expiredValidation = createMockAppleValidation({
        transactionId: `tx_expired_${Date.now()}`,
        originalTransactionId: originalTxId,
        isActive: false,
        isExpired: true,
        autoRenewEnabled: false,
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
      const result = await manager.syncSubscription(
        testUserId,
        expiredValidation,
      );

      assert.equal(result.isRenewal, true);
      assert.equal(result.songsGranted, 0);
      assert.equal(result.status, STATUS.EXPIRED);
      assert.equal(result.tier, "free");

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "free");
      assert.equal(ent.songsRemaining, 0);
      assert.equal(ent.songsAllowance, 0);
      assert.equal(ent.planId, null);
    });

    it("creates purchase receipt record", async () => {
      const mockValidation = createMockAppleValidation();
      await manager.syncSubscription(testUserId, mockValidation);

      const receiptResult = await db.query(
        "SELECT * FROM purchase_receipts WHERE user_id = ?",
        [testUserId],
      );

      assert.equal(receiptResult.rows.length, 1);
      assert.equal(
        receiptResult.rows[0].transaction_id,
        mockValidation.transactionId,
      );
      assert.equal(receiptResult.rows[0].verification_status, "verified");
    });

    it("rejects invalid validation", async () => {
      await assert.rejects(
        () =>
          manager.syncSubscription(testUserId, {
            valid: false,
            error: "Invalid",
          }),
        /Invalid/,
      );
    });

    it("rejects unknown product ID", async () => {
      const unknownProduct = createMockAppleValidation({
        productId: "com.unknown.product",
      });

      await assert.rejects(
        () => manager.syncSubscription(testUserId, unknownProduct),
        /Unknown product/,
      );
    });

    it("resets balance to plan allowance on renewal (no accumulation)", async () => {
      const originalTxId = `otx_noaccum_${Date.now()}`;

      // First subscription: 10 songs granted
      await manager.syncSubscription(
        testUserId,
        createMockAppleValidation({
          transactionId: `tx_first_${Date.now()}`,
          originalTransactionId: originalTxId,
        }),
      );

      // User spends 1 song, leaving 9
      await manager.spendSong(testUserId, "track_1");
      let ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 9);

      // Renewal: should reset to 10, not add 10 to 9
      await manager.syncSubscription(
        testUserId,
        createMockAppleValidation({
          transactionId: `tx_renewal_${Date.now()}`,
          originalTransactionId: originalTxId,
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        }),
      );

      ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 10); // Reset, not 19
    });

    it("ignores stale competing Apple chains with earlier expiry", async () => {
      // Anchor to "now" so the live monthly stays active regardless of when
      // the suite runs. Relationships preserved from the original prod repro:
      // live monthly purchased earlier with a LATER expiry; stale daily
      // purchased later but with an EARLIER (already-passed) expiry.
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const activeMonthly = createMockAppleValidation({
        transactionId: "tx_live_monthly",
        originalTransactionId: "otx_live_monthly",
        originalPurchaseDate: new Date(now - 3 * DAY),
        purchaseDate: new Date(now - 3 * DAY),
        expiresAt: new Date(now + 27 * DAY),
        autoRenewEnabled: true,
        environment: "production",
      });

      await manager.syncSubscription(testUserId, activeMonthly);

      const staleCompetingChain = createMockAppleValidation({
        transactionId: "tx_stale_daily",
        originalTransactionId: "otx_stale_daily",
        originalPurchaseDate: new Date(now - 11 * DAY),
        purchaseDate: new Date(now - 1 * DAY),
        expiresAt: new Date(now - 0.5 * DAY),
        autoRenewEnabled: false,
        isActive: false,
        isExpired: true,
        status: "expired",
        environment: "production",
      });

      const result = await manager.syncSubscription(
        testUserId,
        staleCompetingChain,
      );

      assert.equal(result.ignoredAsStaleCompetingChain, true);

      const sub = await db.query(
        "SELECT original_transaction_id, latest_transaction_id, expires_at, auto_renew_enabled, status FROM subscriptions WHERE user_id = ?",
        [testUserId],
      );
      assert.equal(sub.rows.length, 1);
      assert.equal(sub.rows[0].original_transaction_id, "otx_live_monthly");
      assert.equal(sub.rows[0].latest_transaction_id, "tx_live_monthly");
      assert.equal(sub.rows[0].auto_renew_enabled, 1);
      assert.equal(sub.rows[0].status, "active");

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "plus");
      assert.equal(ent.songsRemaining, 10);
    });
  });

  describe("spendSong", () => {
    it("spends from trial songs first", async () => {
      await enableTrialConfig();

      // Activate trial
      await manager.activateTrial(testUserId);

      // Spend a song
      const result = await manager.spendSong(testUserId, "track_123");

      assert.equal(result.source, "trial");
      assert.equal(result.songsRemaining, 1);

      // Verify entitlements
      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.trialSongsRemaining, 1);
    });

    it("spends from subscription when no trial songs", async () => {
      // Create subscription with unique IDs
      await manager.syncSubscription(testUserId, createMockAppleValidation());

      const result = await manager.spendSong(testUserId, "track_456");

      assert.equal(result.source, "subscription");
      assert.equal(result.songsRemaining, 9);
    });

    it("throws when no songs remaining", async () => {
      // Create entitlements with 0 songs
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at)
         VALUES (?, 'free', 0, datetime('now'))`,
        [testUserId],
      );

      await assert.rejects(
        () => manager.spendSong(testUserId, "track_789"),
        /Insufficient songs remaining/,
      );
    });

    it("records spend transaction", async () => {
      await enableTrialConfig();

      await manager.activateTrial(testUserId);
      await manager.spendSong(testUserId, "track_123");

      const txResult = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.SPEND],
      );

      assert.equal(txResult.rows.length, 1);
      assert.equal(txResult.rows[0].amount, -1);
      assert.equal(txResult.rows[0].reference_id, "track_123");
    });

    it("drains trial songs before subscription songs", async () => {
      await enableTrialConfig();

      // Activate trial (2 songs) then subscribe (10 songs)
      await manager.activateTrial(testUserId);
      await manager.syncSubscription(testUserId, createMockAppleValidation());

      // First two spends should come from trial
      const s1 = await manager.spendSong(testUserId, "t1");
      assert.equal(s1.source, "trial");

      const s2 = await manager.spendSong(testUserId, "t2");
      assert.equal(s2.source, "trial");

      // Next spend should come from subscription
      const s3 = await manager.spendSong(testUserId, "t3");
      assert.equal(s3.source, "subscription");

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.trialSongsRemaining, 0);
      assert.equal(ent.songsRemaining, 9); // 10 sub - 1 spent + 0 trial = 9 total
    });

    it("throws for user with no entitlements record", async () => {
      await assert.rejects(
        () => manager.spendSong(testUserId, "track_none"),
        /No entitlements found/,
      );
    });
  });

  describe("handleExpiration", () => {
    it("downgrades user to free tier", async () => {
      // Create subscription first (Pro plan for 20 songs)
      const mockValidation = createMockAppleValidation({
        productId: "com.porizo.pro_monthly",
        expiresAt: new Date(Date.now() - 1000), // Expired
        autoRenewEnabled: false,
      });
      const subResult = await manager.syncSubscription(
        testUserId,
        mockValidation,
      );

      const result = await manager.handleExpiration(subResult.subscriptionId);

      assert.equal(result.previousTier, "pro");
      assert.equal(result.newTier, "free");

      // Credits should be zeroed on expiration
      assert.equal(result.songsRemaining, 0);

      // Verify subscription status
      const sub = await db.query("SELECT * FROM subscriptions WHERE id = ?", [
        subResult.subscriptionId,
      ]);
      assert.equal(sub.rows[0].status, "expired");

      // Verify entitlements
      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.tier, "free");
      assert.equal(ent.songsRemaining, 0);
    });

    it("zeroes out credits on subscription expiration", async () => {
      const mockValidation = createMockAppleValidation({
        productId: "com.porizo.pro_monthly",
      });
      const subResult = await manager.syncSubscription(
        testUserId,
        mockValidation,
      );

      // User has 20 songs from Pro plan
      let ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 20);

      // Expire the subscription
      await manager.handleExpiration(subResult.subscriptionId);

      // Credits should be gone
      ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 0);
      assert.equal(ent.poemsRemaining, 0);
    });
  });

  describe("handleRevocation", () => {
    it("revokes subscription and removes songs", async () => {
      const subResult = await manager.syncSubscription(
        testUserId,
        createMockAppleValidation(),
      );

      const result = await manager.handleRevocation(subResult.subscriptionId);

      assert.equal(result.songsRevoked, 10);
      assert.equal(result.songsRemaining, 0);

      // Verify subscription status
      const sub = await db.query("SELECT * FROM subscriptions WHERE id = ?", [
        subResult.subscriptionId,
      ]);
      assert.equal(sub.rows[0].status, "revoked");
    });

    it("records refund transaction", async () => {
      const subResult = await manager.syncSubscription(
        testUserId,
        createMockAppleValidation(),
      );

      await manager.handleRevocation(subResult.subscriptionId);

      const txResult = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.REFUND],
      );

      assert.equal(txResult.rows.length, 1);
      assert.equal(txResult.rows[0].amount, -10);
    });
  });

  describe("getActiveSubscription", () => {
    it("does not return expired active rows", async () => {
      const validation = createMockAppleValidation({
        transactionId: "tx_expired_lookup",
        originalTransactionId: "otx_expired_lookup",
        expiresAt: new Date(Date.now() - 60 * 1000),
        autoRenewEnabled: false,
        isActive: false,
        isExpired: true,
        status: "expired",
      });

      const result = await manager.syncSubscription(testUserId, validation);
      const activeSubscription =
        await manager.getActiveSubscription(testUserId);

      assert.equal(result.status, "expired");
      assert.equal(activeSubscription, null);
    });
  });

  describe("adminGrantSongs", () => {
    it("grants songs to user", async () => {
      const result = await manager.adminGrantSongs(testUserId, 5, "Test grant");

      assert.equal(result.songsGranted, 5);
      assert.equal(result.songsRemaining, 5);

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsRemaining, 5);
    });

    it("records admin grant transaction", async () => {
      await manager.adminGrantSongs(testUserId, 3, "Compensation");

      const txResult = await db.query(
        "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
        [testUserId, TRANSACTION_TYPES.ADMIN_GRANT],
      );

      assert.equal(txResult.rows.length, 1);
      assert.equal(txResult.rows[0].amount, 3);
      assert.equal(txResult.rows[0].description, "Compensation");
    });
  });

  describe("getEntitlements", () => {
    it("returns null for user without entitlements", async () => {
      const newUserId = `user_new_${Date.now()}`;
      await db.query(
        "INSERT INTO users (id, created_at) VALUES (?, datetime('now'))",
        [newUserId],
      );

      const ent = await manager.getEntitlements(newUserId);
      assert.equal(ent, null);
    });

    it("combines trial and regular songs in total", async () => {
      await enableTrialConfig();

      // Activate trial
      await manager.activateTrial(testUserId);

      // Grant additional songs
      await manager.adminGrantSongs(testUserId, 3, "Bonus");

      const ent = await manager.getEntitlements(testUserId);
      // 2 trial + 3 admin = 5 total
      assert.equal(ent.songsRemaining, 5);
      assert.equal(ent.trialSongsRemaining, 2);
    });
  });

  describe("getActiveSubscription", () => {
    it("returns active subscription", async () => {
      await manager.syncSubscription(testUserId, createMockAppleValidation());

      const sub = await manager.getActiveSubscription(testUserId);
      assert.ok(sub);
      assert.equal(sub.tier, "plus");
      assert.equal(sub.status, "active");
    });

    it("returns null for user without subscription", async () => {
      const sub = await manager.getActiveSubscription(testUserId);
      assert.equal(sub, null);
    });
  });

  describe("spendSong with gift_wallet (pay-per-song)", () => {
    async function seedGiftWallet(userId, balance) {
      await db.query(
        `INSERT INTO gift_wallet (user_id, balance, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET balance = ?`,
        [userId, balance, balance],
      );
    }

    async function getGiftWalletBalance(userId) {
      const res = await db.query(
        "SELECT balance FROM gift_wallet WHERE user_id = ?",
        [userId],
      );
      return res.rows.length ? Number(res.rows[0].balance) : null;
    }

    it("spend order: trial -> songs_remaining -> gift_wallet", async () => {
      // trial=1, songs_remaining=1, gift=1
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 1, 1, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 1);

      const s1 = await manager.spendSong(testUserId, "g_track_1");
      assert.equal(s1.source, "trial");

      const s2 = await manager.spendSong(testUserId, "g_track_2");
      assert.equal(s2.source, "subscription");

      const s3 = await manager.spendSong(testUserId, "g_track_3");
      assert.equal(s3.source, "gift_token");

      assert.equal(await getGiftWalletBalance(testUserId), 0);
    });

    it("trial=0,songs=0,gift=1 spends via gift_token and records ledger row", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 0, 0, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 1);

      const result = await manager.spendSong(testUserId, "g_track_gift");
      assert.equal(result.source, "gift_token");

      assert.equal(await getGiftWalletBalance(testUserId), 0);

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsUsedTotal, 1);
      assert.equal(ent.giftSongsUsedTotal, 1);

      const ledger = await db.query(
        "SELECT * FROM gift_wallet_transactions WHERE user_id = ? AND reference_id = ?",
        [testUserId, "g_track_gift"],
      );
      assert.equal(ledger.rows.length, 1);
      assert.equal(Number(ledger.rows[0].amount), -1);
      assert.equal(Number(ledger.rows[0].balance_before), 1);
      assert.equal(Number(ledger.rows[0].balance_after), 0);
    });

    it("tracks gift spend as a subset of total song spend", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 1, 0, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 1);

      const first = await manager.spendSong(testUserId, "regular_track");
      assert.equal(first.source, "subscription");

      const second = await manager.spendSong(testUserId, "gift_track");
      assert.equal(second.source, "gift_token");

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsUsedTotal, 2);
      assert.equal(ent.giftSongsUsedTotal, 1);
    });

    it("all zero (trial=0,songs=0,gift=0) throws INSUFFICIENT", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 0, 0, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 0);

      await assert.rejects(
        () => manager.spendSong(testUserId, "g_track_zero"),
        /Insufficient songs remaining/,
      );
    });

    it("atomic guard prevents double-spend of last gift token", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 0, 0, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 1);

      const first = await manager.spendSong(testUserId, "g_dbl_1");
      assert.equal(first.source, "gift_token");

      // Second spend must fail — no balance left, guard holds.
      await assert.rejects(
        () => manager.spendSong(testUserId, "g_dbl_2"),
        /Insufficient songs remaining/,
      );

      assert.equal(await getGiftWalletBalance(testUserId), 0);

      // Exactly one debit ledger row recorded.
      const ledger = await db.query(
        "SELECT * FROM gift_wallet_transactions WHERE user_id = ? AND amount = -1",
        [testUserId],
      );
      assert.equal(ledger.rows.length, 1);
    });

    it("getEntitlements returns giftWalletBalance without changing songsRemaining", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 2, 1, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 3);

      const ent = await manager.getEntitlements(testUserId);
      // base(2) + trial(1) unchanged
      assert.equal(ent.songsRemaining, 3);
      assert.equal(ent.giftWalletBalance, 3);
    });

    it("getEntitlements returns giftWalletBalance 0 when no wallet row", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, updated_at)
         VALUES (?, 'free', 1, datetime('now'))`,
        [testUserId],
      );

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.giftWalletBalance, 0);
    });
  });

  describe("constants", () => {
    it("exports transaction types", () => {
      assert.ok(TRANSACTION_TYPES.FREE_SIGNUP_GRANT);
      assert.ok(TRANSACTION_TYPES.SUBSCRIPTION_GRANT);
      assert.ok(TRANSACTION_TYPES.TRIAL_GRANT);
      assert.ok(TRANSACTION_TYPES.SPEND);
      assert.ok(TRANSACTION_TYPES.REFUND);
    });

    it("exports status values", () => {
      assert.equal(STATUS.ACTIVE, "active");
      assert.equal(STATUS.EXPIRED, "expired");
      assert.equal(STATUS.GRACE_PERIOD, "grace_period");
    });
  });
});
