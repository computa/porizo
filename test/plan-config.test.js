/**
 * Plan Configuration Service Tests
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { createPlanConfigService } = require("../src/services/plan-config");

describe("Plan Configuration Service", async () => {
  let db;
  let planService;

  beforeEach(async () => {
    db = await getDatabase();
    planService = createPlanConfigService(db, { cacheTTL: 100 }); // Short TTL for tests
  });

  describe("getPlans", () => {
    it("returns default plans after migration", async () => {
      const plans = await planService.getPlans();

      assert.ok(plans.length >= 3, "Should have at least 3 default plans");

      const freePlan = plans.find((p) => p.tier === "free");
      const plusPlan = plans.find((p) => p.tier === "plus");
      const proPlan = plans.find((p) => p.tier === "pro");

      assert.ok(freePlan, "Should have free plan");
      assert.ok(plusPlan, "Should have plus plan");
      assert.ok(proPlan, "Should have pro plan");

      assert.equal(freePlan.songs_per_month, 0);
      assert.equal(plusPlan.songs_per_month, 4);
      assert.equal(proPlan.songs_per_month, 10);
    });

    it("filters inactive plans by default", async () => {
      // Deactivate a plan
      await planService.updatePlan("free", { is_active: false });

      const activePlans = await planService.getPlans();
      const freePlan = activePlans.find((p) => p.tier === "free");
      assert.equal(freePlan, undefined, "Free plan should be filtered out");

      // Include inactive
      const allPlans = await planService.getPlans({ includeInactive: true });
      const freeInactive = allPlans.find((p) => p.tier === "free");
      assert.ok(freeInactive, "Free plan should be included when inactive requested");

      // Re-activate for other tests
      await planService.updatePlan("free", { is_active: true });
    });

    it("parses features JSON correctly", async () => {
      const plans = await planService.getPlans();
      const plusPlan = plans.find((p) => p.tier === "plus");

      assert.ok(Array.isArray(plusPlan.features), "Features should be array");
      assert.ok(plusPlan.features.length > 0, "Features should not be empty");
    });

    it("returns plans sorted by sort_order", async () => {
      const plans = await planService.getPlans();

      for (let i = 1; i < plans.length; i++) {
        assert.ok(
          plans[i].sort_order >= plans[i - 1].sort_order,
          "Plans should be sorted by sort_order"
        );
      }
    });
  });

  describe("getPlanById", () => {
    it("returns plan by ID", async () => {
      const plan = await planService.getPlanById("plus");
      assert.ok(plan);
      assert.equal(plan.id, "plus");
      assert.equal(plan.tier, "plus");
    });

    it("returns null for non-existent plan", async () => {
      const plan = await planService.getPlanById("nonexistent");
      assert.equal(plan, null);
    });
  });

  describe("getPlanByTier", () => {
    it("returns plan by tier", async () => {
      const plan = await planService.getPlanByTier("pro");
      assert.ok(plan);
      assert.equal(plan.tier, "pro");
      assert.equal(plan.songs_per_month, 10);
    });
  });

  describe("getPlanByProductId", () => {
    it("maps Apple product ID to plan", async () => {
      const plan = await planService.getPlanByProductId("com.porizo.plus_monthly", "apple");
      assert.ok(plan);
      assert.equal(plan.plan_id, "plus");
      assert.equal(plan.billing_period, "monthly");
      assert.equal(plan.platform, "apple");
    });

    it("maps Google product ID to plan", async () => {
      const plan = await planService.getPlanByProductId("pro_annual", "google");
      assert.ok(plan);
      assert.equal(plan.plan_id, "pro");
      assert.equal(plan.billing_period, "annual");
      assert.equal(plan.platform, "google");
    });

    it("returns null for unknown product ID", async () => {
      const plan = await planService.getPlanByProductId("unknown_product", "apple");
      assert.equal(plan, null);
    });
  });

  describe("getSongAllowance", () => {
    it("returns correct allowance for each tier", async () => {
      assert.equal(await planService.getSongAllowance("free"), 0);
      assert.equal(await planService.getSongAllowance("plus"), 4);
      assert.equal(await planService.getSongAllowance("pro"), 10);
    });

    it("returns 0 for unknown tier", async () => {
      assert.equal(await planService.getSongAllowance("unknown"), 0);
    });
  });

  describe("getPreviewLimit", () => {
    it("returns correct limit for each tier", async () => {
      assert.equal(await planService.getPreviewLimit("free"), 5);
      assert.equal(await planService.getPreviewLimit("plus"), 20);
      assert.equal(await planService.getPreviewLimit("pro"), -1); // Unlimited
    });
  });

  describe("getTrialConfig", () => {
    it("returns default trial config", async () => {
      const trial = await planService.getTrialConfig();
      assert.ok(trial);
      assert.equal(trial.songs_allowed, 2);
      assert.equal(trial.duration_days, 7);
      assert.equal(trial.is_active, true);
    });
  });

  describe("updateTrialConfig", () => {
    it("updates trial configuration", async () => {
      await planService.updateTrialConfig({
        songs_allowed: 3,
        duration_days: 14,
      });

      const trial = await planService.getTrialConfig();
      assert.equal(trial.songs_allowed, 3);
      assert.equal(trial.duration_days, 14);

      // Reset for other tests
      await planService.updateTrialConfig({
        songs_allowed: 2,
        duration_days: 7,
      });
    });

    it("can disable trial", async () => {
      await planService.updateTrialConfig({ is_active: false });
      const trial = await planService.getTrialConfig();
      assert.equal(trial.is_active, false);

      // Reset
      await planService.updateTrialConfig({ is_active: true });
    });
  });

  describe("updatePlan", () => {
    it("updates plan fields", async () => {
      await planService.updatePlan("plus", {
        songs_per_month: 5,
        price_monthly_cents: 1099,
      });

      const plan = await planService.getPlanById("plus");
      assert.equal(plan.songs_per_month, 5);
      assert.equal(plan.price_monthly_cents, 1099);

      // Reset
      await planService.updatePlan("plus", {
        songs_per_month: 4,
        price_monthly_cents: 999,
      });
    });

    it("updates features array", async () => {
      const newFeatures = ["Feature A", "Feature B"];
      await planService.updatePlan("plus", { features_json: newFeatures });

      const plan = await planService.getPlanById("plus");
      assert.deepEqual(plan.features, newFeatures);

      // Reset
      await planService.updatePlan("plus", {
        features_json: ["4 songs per month", "20 previews per day", "All occasions", "All music styles"],
      });
    });

    it("rejects empty updates", async () => {
      await assert.rejects(
        async () => planService.updatePlan("plus", {}),
        /No valid fields to update/
      );
    });
  });

  describe("product mappings", () => {
    it("adds and retrieves product mapping", async () => {
      await planService.addProductMapping({
        plan_id: "plus",
        platform: "apple",
        product_id: "com.porizo.plus_test",
        billing_period: "monthly",
      });

      const plan = await planService.getPlanByProductId("com.porizo.plus_test", "apple");
      assert.ok(plan);
      assert.equal(plan.plan_id, "plus");

      // Cleanup
      await planService.removeProductMapping("apple", "com.porizo.plus_test");
    });

    it("gets products for a plan", async () => {
      const products = await planService.getProductsForPlan("plus");
      assert.ok(products.length >= 2, "Plus plan should have apple and google products");

      const appleMonthly = products.find(
        (p) => p.platform === "apple" && p.billing_period === "monthly"
      );
      assert.ok(appleMonthly);
    });
  });

  describe("caching", () => {
    it("caches plans", async () => {
      // First call populates cache
      const plans1 = await planService.getPlans();

      // Directly modify DB (bypass service)
      await db.query("UPDATE subscription_plans SET songs_per_month = 99 WHERE id = 'plus'");

      // Second call should return cached value
      const plans2 = await planService.getPlans();
      const plusPlan = plans2.find((p) => p.id === "plus");
      assert.equal(plusPlan.songs_per_month, 4, "Should return cached value");

      // Reset DB
      await db.query("UPDATE subscription_plans SET songs_per_month = 4 WHERE id = 'plus'");
    });

    it("invalidates cache on update", async () => {
      // First call
      await planService.getPlans();

      // Update through service (invalidates cache)
      await planService.updatePlan("plus", { songs_per_month: 6 });

      // Should get fresh value
      const plans = await planService.getPlans();
      const plusPlan = plans.find((p) => p.id === "plus");
      assert.equal(plusPlan.songs_per_month, 6);

      // Reset
      await planService.updatePlan("plus", { songs_per_month: 4 });
    });

    it("respects cache TTL", async () => {
      // Use a very short TTL
      const shortCacheService = createPlanConfigService(db, { cacheTTL: 50 });

      await shortCacheService.getPlans();

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Directly modify DB
      await db.query("UPDATE subscription_plans SET description = 'test' WHERE id = 'plus'");

      // Should get fresh value after TTL
      const plans = await shortCacheService.getPlans();
      const plusPlan = plans.find((p) => p.id === "plus");
      assert.equal(plusPlan.description, "test");

      // Reset
      await db.query(
        "UPDATE subscription_plans SET description = 'Perfect for occasional gifting' WHERE id = 'plus'"
      );
    });
  });

  describe("createPlan", () => {
    it("creates a new plan", async () => {
      const newPlan = await planService.createPlan({
        id: "test_plan",
        name: "Test Plan",
        tier: "test",
        songs_per_month: 15,
        previews_per_day: 100,
        price_monthly_cents: 1999,
        description: "A test plan",
        features_json: ["Feature 1"],
        sort_order: 99,
      });

      assert.ok(newPlan);
      assert.equal(newPlan.name, "Test Plan");
      assert.equal(newPlan.songs_per_month, 15);

      // Cleanup
      await db.query("DELETE FROM subscription_plans WHERE id = 'test_plan'");
      planService.invalidateCache();
    });

    it("generates ID if not provided", async () => {
      const newPlan = await planService.createPlan({
        name: "Auto ID Plan",
        tier: "auto",
        songs_per_month: 1,
      });

      assert.ok(newPlan.id);
      assert.ok(newPlan.id.startsWith("plan_"));

      // Cleanup
      await db.query("DELETE FROM subscription_plans WHERE id = ?", [newPlan.id]);
      planService.invalidateCache();
    });
  });
});
