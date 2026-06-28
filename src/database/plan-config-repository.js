"use strict";

const PLAN_UPDATE_FIELDS = [
  "name",
  "songs_per_month",
  "poems_per_month",
  "previews_per_day",
  "price_monthly_cents",
  "price_annual_cents",
  "description",
  "features_json",
  "is_active",
  "sort_order",
];

function createPlanConfigRepository(db) {
  async function listPlans({ includeInactive = false } = {}) {
    const whereClause = includeInactive ? "" : "WHERE is_active = 1";
    const result = await db.query(
      `SELECT
        id, name, tier, songs_per_month, poems_per_month, previews_per_day,
        price_monthly_cents, price_annual_cents,
        description, features_json, is_active, sort_order,
        created_at, updated_at
      FROM subscription_plans
      ${whereClause}
      ORDER BY sort_order ASC, id ASC`,
    );
    return result.rows;
  }

  async function listActiveProductMappings() {
    const result = await db.query(
      `SELECT
        pp.id, pp.plan_id, pp.platform, pp.product_id, pp.billing_period,
        sp.tier, sp.name as plan_name, sp.songs_per_month, sp.poems_per_month, sp.previews_per_day
      FROM plan_products pp
      JOIN subscription_plans sp ON sp.id = pp.plan_id
      WHERE sp.is_active = 1`,
    );
    return result.rows;
  }

  async function getTrialConfig() {
    const result = await db.query(
      "SELECT songs_allowed, duration_days, is_active, updated_at FROM trial_config WHERE id = 1",
    );
    return result.rows[0] || null;
  }

  async function updatePlan(planId, updates) {
    const setClause = [];
    const values = [];

    for (const field of PLAN_UPDATE_FIELDS) {
      if (updates[field] === undefined) continue;

      setClause.push(`${field} = ?`);

      if (field === "features_json" && Array.isArray(updates[field])) {
        values.push(JSON.stringify(updates[field]));
      } else if (field === "is_active") {
        values.push(updates[field] ? 1 : 0);
      } else {
        values.push(updates[field]);
      }
    }

    if (setClause.length === 0) {
      throw new Error("No valid fields to update");
    }

    setClause.push("updated_at = CURRENT_TIMESTAMP");
    values.push(planId);

    return db.query(
      `UPDATE subscription_plans SET ${setClause.join(", ")} WHERE id = ?`,
      values,
    );
  }

  async function trialConfigExists() {
    const result = await db.query("SELECT id FROM trial_config WHERE id = 1");
    return result.rows.length > 0;
  }

  async function insertTrialConfig({
    songsAllowed,
    durationDays,
    isActive,
  }) {
    return db.query(
      `INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
       VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [songsAllowed, durationDays, isActive],
    );
  }

  async function updateTrialConfig({
    songsAllowed,
    durationDays,
    isActive,
  }) {
    return db.query(
      `UPDATE trial_config SET
         songs_allowed = ?,
         duration_days = ?,
         is_active = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [songsAllowed, durationDays, isActive],
    );
  }

  async function findProductMapping(platform, productId) {
    const result = await db.query(
      "SELECT id FROM plan_products WHERE platform = ? AND product_id = ?",
      [platform, productId],
    );
    return result.rows[0] || null;
  }

  async function updateProductMapping({
    id,
    planId,
    billingPeriod,
  }) {
    return db.query(
      "UPDATE plan_products SET plan_id = ?, billing_period = ? WHERE id = ?",
      [planId, billingPeriod, id],
    );
  }

  async function insertProductMapping({
    id,
    planId,
    platform,
    productId,
    billingPeriod,
  }) {
    return db.query(
      `INSERT INTO plan_products (id, plan_id, platform, product_id, billing_period, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, planId, platform, productId, billingPeriod],
    );
  }

  async function removeProductMapping(platform, productId) {
    return db.query(
      "DELETE FROM plan_products WHERE platform = ? AND product_id = ?",
      [platform, productId],
    );
  }

  async function listProductsForPlan(planId) {
    const result = await db.query(
      `SELECT id, platform, product_id, billing_period, created_at
       FROM plan_products
       WHERE plan_id = ?`,
      [planId],
    );
    return result.rows;
  }

  async function createPlan({
    id,
    name,
    tier,
    songsPerMonth,
    poemsPerMonth,
    previewsPerDay,
    priceMonthlyCents,
    priceAnnualCents,
    description,
    featuresJson,
    isActive,
    sortOrder,
  }) {
    return db.query(
      `INSERT INTO subscription_plans (
        id, name, tier, songs_per_month, poems_per_month, previews_per_day,
        price_monthly_cents, price_annual_cents, description,
        features_json, is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        name,
        tier,
        songsPerMonth,
        poemsPerMonth,
        previewsPerDay,
        priceMonthlyCents,
        priceAnnualCents,
        description,
        featuresJson,
        isActive,
        sortOrder,
      ],
    );
  }

  return {
    listPlans,
    listActiveProductMappings,
    getTrialConfig,
    updatePlan,
    trialConfigExists,
    insertTrialConfig,
    updateTrialConfig,
    findProductMapping,
    updateProductMapping,
    insertProductMapping,
    removeProductMapping,
    listProductsForPlan,
    createPlan,
  };
}

module.exports = { createPlanConfigRepository };
