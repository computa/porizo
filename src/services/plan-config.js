/**
 * Plan Configuration Service
 *
 * Manages subscription plans and trial configuration.
 * Provides caching for performance since plan data rarely changes.
 *
 * Usage:
 *   const planService = createPlanConfigService(db);
 *
 *   // Get all plans
 *   const plans = await planService.getPlans();
 *
 *   // Map product ID to plan
 *   const plan = await planService.getPlanByProductId('com.porizo.plus_monthly', 'apple');
 *
 *   // Get trial config
 *   const trial = await planService.getTrialConfig();
 */

const crypto = require("crypto");

/**
 * Default cache TTL in milliseconds (5 minutes)
 */
const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

/**
 * Create a plan configuration service instance
 * @param {Object} db - Database connection
 * @param {Object} options - Configuration options
 * @param {number} options.cacheTTL - Cache TTL in ms (default 5 minutes)
 * @returns {Object} Plan config service interface
 */
function createPlanConfigService(db, options = {}) {
  const cacheTTL = options.cacheTTL || DEFAULT_CACHE_TTL;

  // In-memory cache
  let plansCache = null;
  let plansCacheExpiry = 0;
  let trialCache = null;
  let trialCacheExpiry = 0;
  let productMappingCache = null;
  let productMappingCacheExpiry = 0;

  /**
   * Invalidate all caches
   */
  function invalidateCache() {
    plansCache = null;
    plansCacheExpiry = 0;
    trialCache = null;
    trialCacheExpiry = 0;
    productMappingCache = null;
    productMappingCacheExpiry = 0;
  }

  /**
   * Get all active subscription plans
   * @param {Object} options
   * @param {boolean} options.includeInactive - Include inactive plans
   * @returns {Promise<Array>} Array of plan objects
   */
  async function getPlans({ includeInactive = false } = {}) {
    const now = Date.now();

    // Return cached if valid and not requesting inactive
    if (!includeInactive && plansCache && now < plansCacheExpiry) {
      return plansCache;
    }

    const whereClause = includeInactive ? "" : "WHERE is_active = 1";

    const result = await db.query(
      `SELECT
        id, name, tier, songs_per_month, previews_per_day,
        price_monthly_cents, price_annual_cents,
        description, features_json, is_active, sort_order,
        created_at, updated_at
      FROM subscription_plans
      ${whereClause}
      ORDER BY sort_order ASC, id ASC`
    );

    const plans = result.rows.map((row) => ({
      ...row,
      features: row.features_json ? JSON.parse(row.features_json) : [],
      is_active: Boolean(row.is_active),
    }));

    // Only cache active plans query
    if (!includeInactive) {
      plansCache = plans;
      plansCacheExpiry = now + cacheTTL;
    }

    return plans;
  }

  /**
   * Get a single plan by ID
   * @param {string} planId - Plan ID
   * @returns {Promise<Object|null>} Plan object or null
   */
  async function getPlanById(planId) {
    const plans = await getPlans({ includeInactive: true });
    return plans.find((p) => p.id === planId) || null;
  }

  /**
   * Get plan by tier
   * @param {string} tier - Tier name (free, plus, pro)
   * @returns {Promise<Object|null>} Plan object or null
   */
  async function getPlanByTier(tier) {
    const plans = await getPlans();
    return plans.find((p) => p.tier === tier) || null;
  }

  /**
   * Get product ID mappings
   * @returns {Promise<Map>} Map of "platform:productId" -> plan
   */
  async function getProductMappings() {
    const now = Date.now();

    if (productMappingCache && now < productMappingCacheExpiry) {
      return productMappingCache;
    }

    const result = await db.query(
      `SELECT
        pp.id, pp.plan_id, pp.platform, pp.product_id, pp.billing_period,
        sp.tier, sp.name as plan_name, sp.songs_per_month, sp.previews_per_day
      FROM plan_products pp
      JOIN subscription_plans sp ON sp.id = pp.plan_id
      WHERE sp.is_active = 1`
    );

    const mapping = new Map();
    for (const row of result.rows) {
      const key = `${row.platform}:${row.product_id}`;
      mapping.set(key, {
        plan_id: row.plan_id,
        platform: row.platform,
        product_id: row.product_id,
        billing_period: row.billing_period,
        tier: row.tier,
        plan_name: row.plan_name,
        songs_per_month: row.songs_per_month,
        previews_per_day: row.previews_per_day,
      });
    }

    productMappingCache = mapping;
    productMappingCacheExpiry = now + cacheTTL;

    return mapping;
  }

  /**
   * Get plan by product ID (App Store / Play Store)
   * @param {string} productId - Store product ID
   * @param {string} platform - Platform ('apple' or 'google')
   * @returns {Promise<Object|null>} Plan info or null
   */
  async function getPlanByProductId(productId, platform) {
    const mappings = await getProductMappings();
    const key = `${platform}:${productId}`;
    return mappings.get(key) || null;
  }

  /**
   * Get song allowance for a tier
   * @param {string} tier - Tier name
   * @returns {Promise<number>} Songs per month (0 for free tier)
   */
  async function getSongAllowance(tier) {
    const plan = await getPlanByTier(tier);
    return plan ? plan.songs_per_month : 0;
  }

  /**
   * Get preview limit for a tier
   * @param {string} tier - Tier name
   * @returns {Promise<number>} Previews per day (-1 for unlimited)
   */
  async function getPreviewLimit(tier) {
    const plan = await getPlanByTier(tier);
    return plan ? plan.previews_per_day : 5; // Default to free tier limit
  }

  /**
   * Get trial configuration
   * @returns {Promise<Object>} Trial config
   */
  async function getTrialConfig() {
    const now = Date.now();

    if (trialCache && now < trialCacheExpiry) {
      return trialCache;
    }

    const result = await db.query(
      "SELECT songs_allowed, duration_days, is_active, updated_at FROM trial_config WHERE id = 1"
    );

    if (result.rows.length === 0) {
      // Return defaults if not configured
      trialCache = {
        songs_allowed: 2,
        duration_days: 7,
        is_active: true,
      };
    } else {
      trialCache = {
        songs_allowed: result.rows[0].songs_allowed,
        duration_days: result.rows[0].duration_days,
        is_active: Boolean(result.rows[0].is_active),
        updated_at: result.rows[0].updated_at,
      };
    }

    trialCacheExpiry = now + cacheTTL;
    return trialCache;
  }

  /**
   * Update a subscription plan (admin)
   * @param {string} planId - Plan ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated plan
   */
  async function updatePlan(planId, updates) {
    const allowedFields = [
      "name",
      "songs_per_month",
      "previews_per_day",
      "price_monthly_cents",
      "price_annual_cents",
      "description",
      "features_json",
      "is_active",
      "sort_order",
    ];

    const setClause = [];
    const values = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === "features_json" && Array.isArray(updates[field])) {
          setClause.push(`${field} = ?`);
          values.push(JSON.stringify(updates[field]));
        } else if (field === "is_active") {
          setClause.push(`${field} = ?`);
          values.push(updates[field] ? 1 : 0);
        } else {
          setClause.push(`${field} = ?`);
          values.push(updates[field]);
        }
      }
    }

    if (setClause.length === 0) {
      throw new Error("No valid fields to update");
    }

    setClause.push("updated_at = datetime('now')");
    values.push(planId);

    await db.query(
      `UPDATE subscription_plans SET ${setClause.join(", ")} WHERE id = ?`,
      values
    );

    invalidateCache();
    return getPlanById(planId);
  }

  /**
   * Update trial configuration (admin)
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated trial config
   */
  async function updateTrialConfig(updates) {
    const { songs_allowed, duration_days, is_active } = updates;

    // Get current config to merge with updates
    const current = await getTrialConfig();
    invalidateCache(); // Clear cache before update

    const newSongsAllowed = songs_allowed !== undefined ? songs_allowed : current.songs_allowed;
    const newDurationDays = duration_days !== undefined ? duration_days : current.duration_days;
    const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : (current.is_active ? 1 : 0);

    // Check if record exists
    const existsResult = await db.query("SELECT id FROM trial_config WHERE id = 1");

    if (existsResult.rows.length === 0) {
      // Insert new record
      await db.query(
        `INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
         VALUES (1, ?, ?, ?, datetime('now'))`,
        [newSongsAllowed, newDurationDays, newIsActive]
      );
    } else {
      // Update existing record
      await db.query(
        `UPDATE trial_config SET
           songs_allowed = ?,
           duration_days = ?,
           is_active = ?,
           updated_at = datetime('now')
         WHERE id = 1`,
        [newSongsAllowed, newDurationDays, newIsActive]
      );
    }

    return getTrialConfig();
  }

  /**
   * Add a product mapping (admin)
   * @param {Object} mapping - Product mapping
   * @returns {Promise<Object>} Created mapping
   */
  async function addProductMapping({ plan_id, platform, product_id, billing_period }) {
    // Check if mapping already exists
    const existing = await db.query(
      "SELECT id FROM plan_products WHERE platform = ? AND product_id = ?",
      [platform, product_id]
    );

    let id;
    if (existing.rows.length > 0) {
      // Update existing mapping
      id = existing.rows[0].id;
      await db.query(
        `UPDATE plan_products SET plan_id = ?, billing_period = ? WHERE id = ?`,
        [plan_id, billing_period, id]
      );
    } else {
      // Insert new mapping
      id = `${platform}_${plan_id}_${billing_period}_${Date.now()}`;
      await db.query(
        `INSERT INTO plan_products (id, plan_id, platform, product_id, billing_period, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [id, plan_id, platform, product_id, billing_period]
      );
    }

    invalidateCache();
    return { id, plan_id, platform, product_id, billing_period };
  }

  /**
   * Remove a product mapping (admin)
   * @param {string} platform - Platform
   * @param {string} productId - Product ID
   */
  async function removeProductMapping(platform, productId) {
    await db.query(
      "DELETE FROM plan_products WHERE platform = ? AND product_id = ?",
      [platform, productId]
    );
    invalidateCache();
  }

  /**
   * Get all product mappings for a plan
   * @param {string} planId - Plan ID
   * @returns {Promise<Array>} Product mappings
   */
  async function getProductsForPlan(planId) {
    const result = await db.query(
      `SELECT id, platform, product_id, billing_period, created_at
       FROM plan_products
       WHERE plan_id = ?`,
      [planId]
    );
    return result.rows;
  }

  /**
   * Create a new plan (admin)
   * @param {Object} plan - Plan data
   * @returns {Promise<Object>} Created plan
   */
  async function createPlan(plan) {
    const id = plan.id || `plan_${crypto.randomBytes(8).toString("hex")}`;

    await db.query(
      `INSERT INTO subscription_plans (
        id, name, tier, songs_per_month, previews_per_day,
        price_monthly_cents, price_annual_cents, description,
        features_json, is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        id,
        plan.name,
        plan.tier,
        plan.songs_per_month,
        plan.previews_per_day ?? -1,
        plan.price_monthly_cents ?? null,
        plan.price_annual_cents ?? null,
        plan.description ?? null,
        plan.features_json ? JSON.stringify(plan.features_json) : null,
        plan.is_active !== false ? 1 : 0,
        plan.sort_order ?? 0,
      ]
    );

    invalidateCache();
    return getPlanById(id);
  }

  return {
    // Read operations
    getPlans,
    getPlanById,
    getPlanByTier,
    getPlanByProductId,
    getSongAllowance,
    getPreviewLimit,
    getTrialConfig,
    getProductMappings,
    getProductsForPlan,

    // Admin operations
    createPlan,
    updatePlan,
    updateTrialConfig,
    addProductMapping,
    removeProductMapping,

    // Cache management
    invalidateCache,
  };
}

module.exports = {
  createPlanConfigService,
  DEFAULT_CACHE_TTL,
};
