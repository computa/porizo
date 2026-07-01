process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createPlanConfigRepository,
} = require("../src/database/plan-config-repository");

describe("PlanConfigRepository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createPlanConfigRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("lists active and inactive plans in sort order", async () => {
    await repository.updatePlan("free", { is_active: false });

    const activePlans = await repository.listPlans();
    const allPlans = await repository.listPlans({ includeInactive: true });

    assert.equal(activePlans.some((plan) => plan.id === "free"), false);
    assert.ok(allPlans.some((plan) => plan.id === "free"));
    for (let index = 1; index < allPlans.length; index += 1) {
      assert.ok(allPlans[index].sort_order >= allPlans[index - 1].sort_order);
    }
  });

  test("updates only whitelisted plan fields and serializes features", async () => {
    await repository.updatePlan("plus", {
      songs_per_month: 12,
      features_json: ["12 songs", "Priority rendering"],
      is_active: true,
      ignored_field: "must not persist",
    });

    const plus = (await repository.listPlans({ includeInactive: true }))
      .find((plan) => plan.id === "plus");

    assert.equal(plus.songs_per_month, 12);
    assert.equal(plus.features_json, JSON.stringify(["12 songs", "Priority rendering"]));
    assert.equal(plus.is_active, 1);
    assert.equal(Object.hasOwn(plus, "ignored_field"), false);
    await assert.rejects(
      () => repository.updatePlan("plus", { ignored_field: "nope" }),
      /No valid fields to update/,
    );
  });

  test("reads, inserts, and updates trial config", async () => {
    assert.equal(await repository.trialConfigExists(), true);
    await db.query("DELETE FROM trial_config WHERE id = 1");
    assert.equal(await repository.getTrialConfig(), null);
    assert.equal(await repository.trialConfigExists(), false);

    await repository.insertTrialConfig({
      songsAllowed: 2,
      durationDays: 7,
      isActive: 1,
    });
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(await repository.getTrialConfig())
          .filter(([key]) => key !== "updated_at"),
      ),
      {
        songs_allowed: 2,
        duration_days: 7,
        is_active: 1,
      },
    );

    await repository.updateTrialConfig({
      songsAllowed: 3,
      durationDays: 14,
      isActive: 0,
    });
    const updated = await repository.getTrialConfig();
    assert.equal(updated.songs_allowed, 3);
    assert.equal(updated.duration_days, 14);
    assert.equal(updated.is_active, 0);
  });

  test("creates, updates, lists, and removes product mappings", async () => {
    await repository.insertProductMapping({
      id: "apple_plus_test_monthly",
      planId: "plus",
      platform: "apple",
      productId: "com.porizo.plus_test",
      billingPeriod: "monthly",
    });
    const existing = await repository.findProductMapping(
      "apple",
      "com.porizo.plus_test",
    );
    assert.equal(existing.id, "apple_plus_test_monthly");

    await repository.updateProductMapping({
      id: existing.id,
      planId: "pro",
      billingPeriod: "annual",
    });
    const products = await repository.listProductsForPlan("pro");
    assert.ok(products.some((product) => (
      product.id === "apple_plus_test_monthly" &&
      product.billing_period === "annual"
    )));

    const activeMappings = await repository.listActiveProductMappings();
    assert.ok(activeMappings.some((mapping) => (
      mapping.product_id === "com.porizo.plus_test" &&
      mapping.plan_id === "pro" &&
      mapping.tier === "pro"
    )));

    await repository.removeProductMapping("apple", "com.porizo.plus_test");
    assert.equal(
      await repository.findProductMapping("apple", "com.porizo.plus_test"),
      null,
    );
  });

  test("creates plans with persisted billing fields", async () => {
    await repository.createPlan({
      id: "repo_plan",
      name: "Repository Plan",
      tier: "repo",
      songsPerMonth: 5,
      poemsPerMonth: 6,
      previewsPerDay: 7,
      priceMonthlyCents: 899,
      priceAnnualCents: 8999,
      description: "Repository test plan",
      featuresJson: JSON.stringify(["Repo feature"]),
      isActive: 1,
      sortOrder: 88,
    });

    const plan = (await repository.listPlans({ includeInactive: true }))
      .find((row) => row.id === "repo_plan");

    assert.equal(plan.name, "Repository Plan");
    assert.equal(plan.tier, "repo");
    assert.equal(plan.songs_per_month, 5);
    assert.equal(plan.poems_per_month, 6);
    assert.equal(plan.previews_per_day, 7);
    assert.equal(plan.price_monthly_cents, 899);
    assert.equal(plan.price_annual_cents, 8999);
    assert.equal(plan.features_json, JSON.stringify(["Repo feature"]));
    assert.equal(plan.is_active, 1);
    assert.equal(plan.sort_order, 88);
  });
});
