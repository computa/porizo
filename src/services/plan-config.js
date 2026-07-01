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
const {
  createPlanConfigRepository,
} = require("../database/plan-config-repository");

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
  const repository =
    options.repository || createPlanConfigRepository(db);

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

    const rows = await repository.listPlans({ includeInactive });
    const plans = rows.map((row) => ({
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

    const rows = await repository.listActiveProductMappings();

    const mapping = new Map();
    for (const row of rows) {
      const key = `${row.platform}:${row.product_id}`;
      mapping.set(key, {
        plan_id: row.plan_id,
        platform: row.platform,
        product_id: row.product_id,
        billing_period: row.billing_period,
        tier: row.tier,
        plan_name: row.plan_name,
        songs_per_month: row.songs_per_month,
        poems_per_month: row.poems_per_month,
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
   * Get poem allowance for a tier
   * @param {string} tier - Tier name
   * @returns {Promise<number>} Poems per month (0 for free tier)
   */
  async function getPoemAllowance(tier) {
    const plan = await getPlanByTier(tier);
    return plan ? plan.poems_per_month : 0;
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

    const row = await repository.getTrialConfig();

    if (!row) {
      // Fail closed: free users get the one-time signup grant, not trial songs.
      trialCache = {
        songs_allowed: 0,
        duration_days: 7,
        is_active: false,
      };
    } else {
      trialCache = {
        songs_allowed: row.songs_allowed,
        duration_days: row.duration_days,
        is_active: Boolean(row.is_active),
        updated_at: row.updated_at,
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
    await repository.updatePlan(planId, updates);
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
    if (!(await repository.trialConfigExists())) {
      // Insert new record
      await repository.insertTrialConfig({
        songsAllowed: newSongsAllowed,
        durationDays: newDurationDays,
        isActive: newIsActive,
      });
    } else {
      // Update existing record
      await repository.updateTrialConfig({
        songsAllowed: newSongsAllowed,
        durationDays: newDurationDays,
        isActive: newIsActive,
      });
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
    const existing = await repository.findProductMapping(platform, product_id);

    let id;
    if (existing) {
      // Update existing mapping
      id = existing.id;
      await repository.updateProductMapping({
        id,
        planId: plan_id,
        billingPeriod: billing_period,
      });
    } else {
      // Insert new mapping
      id = `${platform}_${plan_id}_${billing_period}_${Date.now()}`;
      await repository.insertProductMapping({
        id,
        planId: plan_id,
        platform,
        productId: product_id,
        billingPeriod: billing_period,
      });
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
    await repository.removeProductMapping(platform, productId);
    invalidateCache();
  }

  /**
   * Get all product mappings for a plan
   * @param {string} planId - Plan ID
   * @returns {Promise<Array>} Product mappings
   */
  async function getProductsForPlan(planId) {
    return repository.listProductsForPlan(planId);
  }

  /**
   * Create a new plan (admin)
   * @param {Object} plan - Plan data
   * @returns {Promise<Object>} Created plan
   */
  async function createPlan(plan) {
    const id = plan.id || `plan_${crypto.randomBytes(8).toString("hex")}`;

    await repository.createPlan({
      id,
      name: plan.name,
      tier: plan.tier,
      songsPerMonth: plan.songs_per_month,
      poemsPerMonth: plan.poems_per_month ?? 0,
      previewsPerDay: plan.previews_per_day ?? -1,
      priceMonthlyCents: plan.price_monthly_cents ?? null,
      priceAnnualCents: plan.price_annual_cents ?? null,
      description: plan.description ?? null,
      featuresJson: plan.features_json ? JSON.stringify(plan.features_json) : null,
      isActive: plan.is_active !== false ? 1 : 0,
      sortOrder: plan.sort_order ?? 0,
    });

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
    getPoemAllowance,
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
