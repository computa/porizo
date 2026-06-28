/**
 * Admin Dashboard Service
 * Provides queries and actions for the admin dashboard.
 */

const crypto = require("crypto");
const config = require("../config");
const {
  createAppConfigRepository,
} = require("../database/app-config-repository");
const {
  createAdminControlRepository,
} = require("../database/admin-control-repository");
const {
  createAdminOnboardingSampleRepository,
} = require("../database/admin-onboarding-sample-repository");
const {
  createAdminJobOpsRepository,
} = require("../database/admin-job-ops-repository");
const {
  createAdminStorySessionRepository,
} = require("../database/admin-story-session-repository");
const {
  createAdminModerationRepository,
} = require("../database/admin-moderation-repository");
const {
  createAdminBillingRepository,
} = require("../database/admin-billing-repository");
const {
  createAdminShareManagementRepository,
} = require("../database/admin-share-management-repository");
const {
  createAdminUserReadRepository,
} = require("../database/admin-user-read-repository");
const {
  createAdminUserMutationRepository,
} = require("../database/admin-user-mutation-repository");
const {
  createAdminUserSessionControlRepository,
} = require("../database/admin-user-session-control-repository");
const {
  createAdminMetricsRepository,
} = require("../database/admin-metrics-repository");
const {
  createAdminEntitlementsRepository,
} = require("../database/admin-entitlements-repository");
const {
  createAdminSecurityObservabilityRepository,
} = require("../database/admin-security-observability-repository");
const {
  createAdminMusicDiagnosticsRepository,
} = require("../database/admin-music-diagnostics-repository");
const {
  createAttributionRepository,
} = require("../database/attribution-repository");
const { createEventsRepository } = require("../database/events-repository");
const { createAppStoreConnectService } = require("./app-store-connect-service");
const { AttributionService } = require("./attribution-service");
const {
  applyMusicProviderConfigPatch,
  MUSIC_PROVIDER_CONFIG_KEY,
  normalizeMusicProviderConfig,
  parseMusicProviderConfigJson,
} = require("../providers/provider-config");
const { createClientConfigService } = require("./client-config-service");

/**
 * Escape SQL LIKE wildcards to prevent pattern injection
 */
function escapeLikePattern(str) {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Generate a secure audit log ID
 */
function generateAuditId() {
  return `audit_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Apply bounds to limit/offset to prevent DoS
 */
function safeBounds(limit, offset, maxLimit = 100) {
  return {
    limit: Math.min(Math.max(parseInt(limit) || 50, 1), maxLimit),
    offset: Math.max(parseInt(offset) || 0, 0),
  };
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return null;
}

function normalizeCurrency(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toUpperCase();
}

function extractReceiptMoney(row, productCatalog) {
  const payload = parseMaybeJson(row.verification_response) || {};
  const rawTransaction =
    payload.transactionInfo ||
    payload.transaction_info ||
    payload.apple_transaction ||
    payload.raw?.transactionInfo ||
    payload._raw?.transactionInfo ||
    {};
  const currency = normalizeCurrency(
    payload.currency ||
      payload.currency_code ||
      rawTransaction.currency ||
      row.currency,
  );
  const priceMillis = firstFiniteNumber(
    payload.price_millis,
    payload.apple_price_millis,
    rawTransaction.price,
  );

  if (currency && priceMillis !== null) {
    return {
      amount: priceMillis / 1000,
      currency,
      amount_source: "apple_receipt",
    };
  }

  const directAmount = firstFiniteNumber(payload.amount, payload.amount_paid);
  if (currency && directAmount !== null) {
    return {
      amount: directAmount,
      currency,
      amount_source: "receipt_amount",
    };
  }

  const catalogEntry = productCatalog.get(row.product_id);
  if (catalogEntry?.amount != null) {
    return {
      amount: catalogEntry.amount,
      currency: catalogEntry.currency,
      amount_source: "product_catalog",
    };
  }

  return {
    amount: null,
    currency: null,
    amount_source: "unknown",
  };
}

function isCurrentSubscriberStatus(status) {
  return ["active", "grace_period", "billing_retry"].includes(status);
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentSubscription({ status, expiresAt, gracePeriodExpiresAt }) {
  if (!isCurrentSubscriberStatus(status)) return false;

  const gracePeriodMs = parseTimestampMs(gracePeriodExpiresAt);
  if (gracePeriodMs !== null && gracePeriodMs > Date.now()) {
    return true;
  }

  const expiresMs = parseTimestampMs(expiresAt);
  if (expiresMs === null) {
    return true;
  }

  return expiresMs > Date.now();
}

function normalizeSaleType(row) {
  if (
    row.gift_wallet_transaction_id ||
    String(row.product_id || "").includes("gift")
  ) {
    return "gift";
  }
  if (
    row.subscription_id ||
    String(row.product_id || "").includes("monthly") ||
    String(row.product_id || "").includes("annual")
  ) {
    return "subscription";
  }
  return "purchase";
}

function isCountedPaidSale(sale) {
  if (sale.is_trial) return false;
  if (sale.amount === 0) return false;
  return true;
}

function isPositivePaidSale(sale) {
  return !sale.is_trial && sale.amount != null && sale.amount > 0;
}

function addRevenueBucket(buckets, sale) {
  if (sale.amount == null || !sale.currency) return false;
  const existing = buckets.get(sale.currency) || {
    currency: sale.currency,
    amount: 0,
    count: 0,
  };
  existing.amount += sale.amount;
  existing.count += 1;
  buckets.set(sale.currency, existing);
  return true;
}

function serializeRevenueBuckets(buckets) {
  return Array.from(buckets.values()).sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}

function singleCurrencyAmount(buckets) {
  if (buckets.length === 0) {
    return 0;
  }
  if (buckets.length !== 1) {
    return null;
  }
  return buckets[0].amount;
}

function createSalesSummaryAccumulator() {
  return {
    totalSalesCount: 0,
    subscriptionSalesCount: 0,
    giftSalesCount: 0,
    giftTokensGranted: 0,
    payingUserIds: new Set(),
    revenueBuckets: new Map(),
    subscriptionRevenueBuckets: new Map(),
    giftRevenueBuckets: new Map(),
    unknownAmountCount: 0,
  };
}

function addSaleToSummary(summary, sale) {
  if (!isCountedPaidSale(sale)) return;

  summary.totalSalesCount += 1;
  if (sale.sale_type === "subscription") {
    summary.subscriptionSalesCount += 1;
  }
  if (sale.sale_type === "gift") {
    summary.giftSalesCount += 1;
    summary.giftTokensGranted += sale.gift_tokens_granted || 0;
  }
  if (isPositivePaidSale(sale)) {
    summary.payingUserIds.add(sale.user_id);
  }

  const hasKnownRevenue = addRevenueBucket(summary.revenueBuckets, sale);
  if (!hasKnownRevenue) {
    summary.unknownAmountCount += 1;
  } else if (sale.sale_type === "subscription") {
    addRevenueBucket(summary.subscriptionRevenueBuckets, sale);
  } else if (sale.sale_type === "gift") {
    addRevenueBucket(summary.giftRevenueBuckets, sale);
  }
}

function finalizeSalesSummary(summary, activeSubscriberCount) {
  return {
    totalSalesCount: summary.totalSalesCount,
    subscriptionSalesCount: summary.subscriptionSalesCount,
    giftSalesCount: summary.giftSalesCount,
    giftTokensGranted: summary.giftTokensGranted,
    payingUsers: summary.payingUserIds.size,
    activeSubscriberCount,
    revenueByCurrency: serializeRevenueBuckets(summary.revenueBuckets),
    subscriptionRevenueByCurrency: serializeRevenueBuckets(
      summary.subscriptionRevenueBuckets,
    ),
    giftRevenueByCurrency: serializeRevenueBuckets(summary.giftRevenueBuckets),
    unknownAmountCount: summary.unknownAmountCount,
  };
}

class AdminService {
  constructor(db, options = {}) {
    this.db = db;
    this.appStoreConnectService =
      options.appStoreConnectService || createAppStoreConnectService();
    this.attributionService = options.attributionService || new AttributionService(db);
    this.attributionRepository =
      options.attributionRepository || createAttributionRepository(db);
    this.appConfigRepository =
      options.appConfigRepository || createAppConfigRepository(db);
    this.clientConfigService =
      options.clientConfigService ||
      createClientConfigService({
        appConfigRepository: this.appConfigRepository,
        db: this.db,
        getMusicProviderConfig: () => this.getMusicProviderConfig(),
        getSTTConfig: () => this.getSTTConfig(),
        resolveIOSAppUpdatePolicy: () => this.resolveIOSAppUpdatePolicy(),
      });
    this.adminControlRepository =
      options.adminControlRepository || createAdminControlRepository(db);
    this.adminOnboardingSampleRepository =
      options.adminOnboardingSampleRepository ||
      createAdminOnboardingSampleRepository(db);
    this.adminJobOpsRepository =
      options.adminJobOpsRepository || createAdminJobOpsRepository(db);
    this.adminStorySessionRepository =
      options.adminStorySessionRepository ||
      createAdminStorySessionRepository(db);
    this.adminModerationRepository =
      options.adminModerationRepository || createAdminModerationRepository(db);
    this.adminBillingRepository =
      options.adminBillingRepository || createAdminBillingRepository(db);
    this.adminShareManagementRepository =
      options.adminShareManagementRepository ||
      createAdminShareManagementRepository(db);
    this.adminUserReadRepository =
      options.adminUserReadRepository || createAdminUserReadRepository(db);
    this.adminUserMutationRepository =
      options.adminUserMutationRepository ||
      createAdminUserMutationRepository(db);
    this.adminUserSessionControlRepository =
      options.adminUserSessionControlRepository ||
      createAdminUserSessionControlRepository(db);
    this.adminMetricsRepository =
      options.adminMetricsRepository || createAdminMetricsRepository(db);
    this.adminEntitlementsRepository =
      options.adminEntitlementsRepository ||
      createAdminEntitlementsRepository(db);
    this.adminSecurityObservabilityRepository =
      options.adminSecurityObservabilityRepository ||
      createAdminSecurityObservabilityRepository(db);
    this.adminMusicDiagnosticsRepository =
      options.adminMusicDiagnosticsRepository ||
      createAdminMusicDiagnosticsRepository(db);
    this.eventsRepository =
      options.eventsRepository || createEventsRepository(db);
    // In-memory response cache for analytics aggregates. 60s TTL keeps
    // dashboards responsive without hammering events table on every days-selector flick.
    // Cleared on process restart; acceptable for admin-only endpoints.
    this._analyticsCache = new Map();
    this._analyticsCacheTTLMs = 60 * 1000;
  }

  _analyticsCacheGet(key) {
    const entry = this._analyticsCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this._analyticsCache.delete(key);
      return null;
    }
    return entry.payload;
  }

  _analyticsCacheSet(key, payload) {
    this._analyticsCache.set(key, { payload, expiresAt: Date.now() + this._analyticsCacheTTLMs });
  }

  _clampDays(days) {
    const n = Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : 30;
    return Math.max(1, Math.min(365, n));
  }

  _clampLimit(limit, max = 200) {
    const n = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50;
    return Math.max(1, Math.min(max, n));
  }

  _parseSalesPeriod(days) {
    if (String(days || "").toLowerCase() === "all") {
      return {
        days: "all",
        label: "all_time",
        since: null,
      };
    }

    const clampedDays = this._clampDays(days);
    return {
      days: clampedDays,
      label: `${clampedDays}_days`,
      since: new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async _getProductCatalog() {
    const catalog = new Map();

    const giftBundles =
      await this.adminBillingRepository.listGiftBundleProducts();
    for (const bundle of giftBundles) {
      catalog.set(bundle.product_id, {
        display_name: bundle.display_name,
        amount: bundle.price_cents == null ? null : Number(bundle.price_cents) / 100,
        currency: "USD",
        source: "gift_bundles",
      });
    }

    const planProducts = await this.adminBillingRepository.listPlanProducts();
    for (const product of planProducts) {
      const priceCents =
        product.billing_period === "annual"
          ? product.price_annual_cents
          : product.price_monthly_cents;
      catalog.set(product.product_id, {
        display_name: [product.name, product.billing_period]
          .filter(Boolean)
          .join(" "),
        tier: product.tier,
        amount: priceCents == null ? null : Number(priceCents) / 100,
        currency: "USD",
        source: "subscription_plans",
      });
    }

    return catalog;
  }

  async _getReceiptSaleRows(period, { limit = 50, offset = 0 } = {}) {
    return this.adminBillingRepository.listReceiptSaleRows({
      since: period.since,
      limit,
      offset,
    });
  }

  async _getReceiptSalesPage(period, productCatalog, { limit, offset }) {
    const sales = [];
    const scanLimit = Math.max(limit, 100);
    let scanOffset = 0;
    let countedOffset = 0;

    while (sales.length < limit) {
      const rows = await this._getReceiptSaleRows(period, {
        limit: scanLimit,
        offset: scanOffset,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const sale = this._normalizeReceiptSale(row, productCatalog);
        if (!isCountedPaidSale(sale)) continue;
        if (countedOffset < offset) {
          countedOffset += 1;
          continue;
        }
        sales.push(sale);
        if (sales.length >= limit) break;
      }

      scanOffset += rows.length;
      if (rows.length < scanLimit) break;
    }

    return sales;
  }

  async _buildBillingSalesSummary(period, productCatalog) {
    const summary = createSalesSummaryAccumulator();
    const scanLimit = 1000;
    let scanOffset = 0;

    while (true) {
      const rows = await this._getReceiptSaleRows(period, {
        limit: scanLimit,
        offset: scanOffset,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        addSaleToSummary(
          summary,
          this._normalizeReceiptSale(row, productCatalog),
        );
      }

      scanOffset += rows.length;
      if (rows.length < scanLimit) break;
    }

    const activeSubscriberCount = await this._countCurrentSubscribers();
    return finalizeSalesSummary(summary, activeSubscriberCount);
  }

  async _countCurrentSubscribers() {
    const now = new Date().toISOString();
    return this.adminBillingRepository.countCurrentSubscribers({ now });
  }

  async _getCurrentSubscribers(limit = 50) {
    const now = new Date().toISOString();
    return this.adminBillingRepository.listCurrentSubscribers({ now, limit });
  }

  _normalizeReceiptSale(row, productCatalog) {
    const catalogEntry = productCatalog.get(row.product_id);
    const money = extractReceiptMoney(row, productCatalog);
    const saleType = normalizeSaleType(row);
    const userEmail = row.primary_email || row.user_email || null;
    const subscriptionExpiresAt = row.subscription_expires_at || row.expires_date || null;

    return {
      id: row.id,
      user_id: row.user_id,
      user_email: userEmail,
      user_display_name: row.user_display_name || null,
      sale_type: saleType,
      product_id: row.product_id,
      product_name: catalogEntry?.display_name || row.product_id,
      platform: row.platform,
      transaction_id: row.transaction_id,
      original_transaction_id: row.original_transaction_id,
      purchase_date: row.purchase_date,
      created_at: row.created_at,
      amount: money.amount,
      currency: money.currency,
      amount_source: money.amount_source,
      gift_tokens_granted:
        row.gift_tokens_granted == null ? null : Number(row.gift_tokens_granted),
      is_trial: Boolean(row.is_trial),
      subscription_id: row.subscription_id || null,
      subscription_status: row.subscription_status || null,
      subscription_tier: row.subscription_tier || catalogEntry?.tier || null,
      subscription_expires_at: subscriptionExpiresAt,
      auto_renew_enabled: Boolean(row.auto_renew_enabled),
      is_current_subscriber: isCurrentSubscription({
        status: row.subscription_status,
        expiresAt: subscriptionExpiresAt,
        gracePeriodExpiresAt: row.subscription_grace_period_expires_at,
      }),
    };
  }

  _normalizeCurrentSubscriber(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      user_email: row.primary_email || row.user_email || null,
      user_display_name: row.user_display_name || null,
      product_id: row.product_id,
      tier: row.tier,
      status: row.status,
      platform: row.platform,
      original_transaction_id: row.original_transaction_id,
      latest_transaction_id: row.latest_transaction_id,
      original_purchase_date: row.original_purchase_date,
      expires_at: row.expires_at,
      auto_renew_enabled: Boolean(row.auto_renew_enabled),
      grace_period_expires_at: row.grace_period_expires_at,
      cancelled_at: row.cancelled_at,
      updated_at: row.updated_at,
    };
  }

  async _persistSecurityConfig(config, actorId, { audit = true } = {}) {
    const now = new Date().toISOString();
    await this.appConfigRepository.upsertSecurityConfig({
      sessionDurationHours: config.sessionDurationHours,
      maxFailedLoginAttempts: config.maxFailedLoginAttempts,
      lockoutDurationMinutes: config.lockoutDurationMinutes,
      rateLimitDefaultsJson: JSON.stringify(config.rateLimitDefaults),
      iosMinSupportedVersion: config.iosMinSupportedVersion || null,
      iosRecommendedVersion: config.iosRecommendedVersion || null,
      iosUpdateMessage: config.iosUpdateMessage || null,
      iosAutoRecommendedVersion: config.iosAutoRecommendedVersion ? 1 : 0,
      iosLastAppStoreVersion: config.iosLastAppStoreVersion || null,
      iosLastAppStoreSyncAt: config.iosLastAppStoreSyncAt || null,
      iosAppStoreSyncError: config.iosAppStoreSyncError || null,
      updatedAt: now,
      updatedBy: actorId,
    });

    if (audit) {
      await this._audit(actorId, 'admin_update_security_config', 'config', 'security', config);
    }

    return { success: true };
  }

  /**
   * Insert an audit log entry (reduces repetitive audit logging code)
   */
  async _audit(adminId, action, resourceType, resourceId, metadata = {}) {
    const enriched = {
      actor: "admin",
      admin_id: adminId,
      ...metadata,
    };
    await this.eventsRepository.insertAuditLog({
      id: generateAuditId(),
      userId: adminId,
      action,
      resourceType,
      resourceId,
      metadataJson: JSON.stringify(enriched),
      createdAt: new Date().toISOString(),
    });
  }

  // ============ USER MANAGEMENT ============

  /**
   * Search users with optional filters
   * Returns user data with adoption metrics (tier, track_count, voice_status, last_active)
   */
  async searchUsers({ email, userId, riskLevel, tier, trackId, shareId, recipientName, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    const { users, total } = await this.adminUserReadRepository.searchUsers({
      email,
      userId,
      riskLevel,
      tier,
      trackId,
      shareId,
      recipientName,
      limit: bounds.limit,
      offset: bounds.offset,
    });
    return {
      users: await this.attributionService.attachAttributionToUsers(users),
      total,
      limit: bounds.limit,
      offset: bounds.offset,
    };
  }

  /**
   * Get aggregate user statistics for summary banner
   * Returns counts by tier and conversion rate
   */
  async getUserStats() {
    const stats = await this.adminUserReadRepository.getUserStats();
    return {
      ...stats,
      conversionRate: stats.totalUsers > 0
        ? ((stats.paidUsers / stats.totalUsers) * 100).toFixed(1)
        : '0.0',
    };
  }

  /**
   * Get detailed user information with related data
   */
  async getUserDetail(userId) {
    const user = await this.adminUserReadRepository.getUserById(userId);

    if (!user) return null;

    const [voiceProfile, entitlements, subscription, tracks, shares, attribution, appleAdsAttribution, canonicalAttribution] = await Promise.all([
      this.adminUserReadRepository.getUserVoiceProfile(userId),
      this.adminUserReadRepository.getUserEntitlements(userId),
      this.adminUserReadRepository.getLatestUserSubscription(userId),
      this.adminUserReadRepository.listUserTracks(userId),
      this.adminUserReadRepository.listUserShares(userId),
      this.adminUserReadRepository.getLatestUserDownloadAttribution(userId),
      this.adminUserReadRepository.getLatestResolvedAppleAdsAttribution(userId),
      this.attributionService.getUserAttribution(user),
    ]);

    Object.assign(user, canonicalAttribution);

    return { user, voiceProfile, entitlements, subscription, tracks, shares, attribution, appleAdsAttribution };
  }

  async getAttributionHealth() {
    return await this.attributionService.getAttributionHealth();
  }

  /**
   * Update user risk level
   */
  async updateUserRisk(userId, riskLevel, adminId, reason) {
    await this.adminUserMutationRepository.updateRiskLevel(userId, riskLevel);
    await this._audit(adminId, 'admin_update_risk', 'user', userId, { riskLevel, reason });
    return { success: true };
  }

  /**
   * Lock or unlock a user account
   */
  async lockUser(userId, locked, adminId, reason) {
    const lockedUntil = locked ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;
    await this.adminUserMutationRepository.updateLockedUntil(userId, lockedUntil);
    await this._audit(adminId, locked ? 'admin_lock_user' : 'admin_unlock_user', 'user', userId, { reason });
    return { success: true, lockedUntil };
  }

  /**
   * Permanently delete a user and all associated data.
   * All child tables use ON DELETE CASCADE, so a single DELETE suffices.
   */
  async deleteUser(userId, adminId, reason) {
    const user = await this.adminUserMutationRepository.findDeletionSnapshot(userId);
    if (!user) return { success: false, error: 'User not found' };

    // Audit BEFORE delete (so the log references the user while they still exist)
    await this._audit(adminId, 'admin_delete_user', 'user', userId, {
      reason,
      deleted_email: user.email,
      deleted_display_name: user.display_name,
    });

    await this.adminUserMutationRepository.deleteUser(userId);

    return { success: true, deleted: { id: user.id, email: user.email, displayName: user.display_name } };
  }

  /**
   * Bulk action on multiple users (delete, lock, unlock)
   */
  async bulkUserAction(userIds, action, adminId, reason) {
    const validActions = ['delete', 'lock', 'unlock'];
    if (!validActions.includes(action)) {
      return { succeeded: [], failed: [{ userId: null, error: `Invalid action: ${action}` }] };
    }
    if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 50) {
      return { succeeded: [], failed: [{ userId: null, error: 'userIds must be an array of 1-50 IDs' }] };
    }

    const succeeded = [];
    const failed = [];

    for (const userId of userIds) {
      try {
        if (action === 'delete') {
          const result = await this.deleteUser(userId, adminId, reason || 'Bulk deletion');
          if (result.success) succeeded.push(userId);
          else failed.push({ userId, error: result.error });
        } else {
          const locked = action === 'lock';
          await this.lockUser(userId, locked, adminId, reason || `Bulk ${action}`);
          succeeded.push(userId);
        }
      } catch (err) {
        failed.push({ userId, error: err.message });
      }
    }

    await this._audit(adminId, `admin_bulk_${action}`, 'user', 'bulk', {
      action,
      requestedCount: userIds.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      reason,
    });

    return { succeeded, failed };
  }

  /**
   * Update user profile and attribution override fields.
   */
  async updateUserProfile(userId, fields, adminId) {
    const allowedFields = [
      'display_name',
      'email',
      'phone_number',
      'acquisition_source',
      'acquisition_medium',
      'acquisition_campaign',
      'acquisition_content',
      'acquisition_term',
      'acquisition_country',
      'acquisition_referrer',
    ];
    const updates = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        updates[key] = fields[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No valid fields provided' };
    }

    const attributionFields = [
      'acquisition_source',
      'acquisition_medium',
      'acquisition_campaign',
      'acquisition_content',
      'acquisition_term',
      'acquisition_country',
      'acquisition_referrer',
    ];
    const attributionUpdates = {};
    for (const key of attributionFields) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        attributionUpdates[key] = updates[key];
      }
    }

    const previousAttribution = Object.keys(attributionUpdates).length > 0
      ? await this.adminUserMutationRepository.getAttributionSnapshot(userId)
      : null;

    await this.adminUserMutationRepository.updateUserFields(userId, updates);
    await this._audit(adminId, 'admin_update_user_profile', 'user', userId, { changedFields: updates });
    if (Object.keys(attributionUpdates).length > 0) {
      const nextAttribution = await this.adminUserMutationRepository.getAttributionSnapshot(userId);
      await this._audit(adminId, 'admin_update_user_attribution', 'user', userId, {
        contract: 'attribution-source-precedence-v1',
        previous: previousAttribution || {
          acquisition_source: null,
          acquisition_medium: null,
          acquisition_campaign: null,
          acquisition_content: null,
          acquisition_term: null,
          acquisition_country: null,
          acquisition_referrer: null,
          acquisition_at: null,
        },
        next: nextAttribution || {
          acquisition_source: null,
          acquisition_medium: null,
          acquisition_campaign: null,
          acquisition_content: null,
          acquisition_term: null,
          acquisition_country: null,
          acquisition_referrer: null,
          acquisition_at: null,
        },
        changedFields: attributionUpdates,
      });
    }

    return { success: true, updated: updates };
  }

  /**
   * Update user entitlements (tier)
   */
  async updateUserEntitlements(userId, fields, adminId) {
    const validTiers = ['free', 'trial', 'pro', 'plus'];

    if (fields.tier && !validTiers.includes(fields.tier)) {
      return { success: false, error: `tier must be one of: ${validTiers.join(', ')}` };
    }

    if (!fields.tier) {
      return { success: false, error: 'No valid fields provided' };
    }

    const current = await this.adminEntitlementsRepository.upsertTier(
      userId,
      fields.tier,
      new Date().toISOString(),
    );

    await this._audit(adminId, 'admin_update_entitlements', 'user', userId, {
      previous: current || { tier: 'free' },
      updated: { tier: fields.tier },
    });

    return { success: true };
  }

  // ============ METRICS ============

  /**
   * Get overview dashboard metrics
   */
  async getOverviewMetrics() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.adminMetricsRepository.getOverviewMetrics({
      dayAgo,
      weekAgo,
    });
  }

  // ============ STORY SESSIONS ============

  /**
   * List story sessions with optional filters
   */
  async listStorySessions({ status, engineVersion, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminStorySessionRepository.listSessions({
      status,
      engineVersion,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Get full story session details with turns
   */
  async getStorySessionDetail(sessionId) {
    return this.adminStorySessionRepository.getSessionDetail(sessionId);
  }

  /**
   * Get job health metrics
   */
  async getJobMetrics() {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return await this.adminJobOpsRepository.getJobMetrics({
      staleBefore: thirtyMinAgo,
      failuresAfter: weekAgo,
    });
  }

  /**
   * Get cost metrics for specified number of days
   */
  async getCostMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.adminMetricsRepository.getCostMetrics({ daysAgo });
  }

  // ============ JOB MANAGEMENT ============

  /**
   * List jobs with optional filters
   */
  async listJobs({ status, workflowType, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return await this.adminJobOpsRepository.listJobs({
      status,
      workflowType,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId, adminId) {
    const job = await this.adminJobOpsRepository.findJobById(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    if (job.status !== 'failed') return { success: false, error: 'Job is not failed' };

    const retryResult = await this.adminJobOpsRepository.retryFailedJob({
      jobId,
      now: new Date().toISOString(),
    });
    if (Number(retryResult?.changes ?? retryResult?.rowCount ?? 0) === 0) {
      return { success: false, error: 'Job is not failed' };
    }
    await this._audit(adminId, 'admin_retry_job', 'job', jobId);

    return { success: true };
  }

  /**
   * List dead letter queue entries
   * Note: DLQ not implemented in current schema, returns empty array
   */
  async listDLQ({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return await this.adminJobOpsRepository.listDLQ({
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Reprocess a DLQ entry by re-queuing the original job
   */
  async reprocessDLQ(dlqId, adminId, reason) {
    const entry = await this.adminJobOpsRepository.findDLQById(dlqId);
    if (!entry) return { success: false, error: 'DLQ entry not found' };
    if (entry.reprocessed_at) return { success: false, error: 'DLQ entry already reprocessed' };

    const job = await this.adminJobOpsRepository.findJobById(entry.job_id);
    if (!job) return { success: false, error: 'Job not found' };

    const now = new Date().toISOString();
    try {
      await this.adminJobOpsRepository.reprocessDLQEntry({
        dlqId,
        jobId: entry.job_id,
        now,
      });
    } catch (error) {
      if (error.message === "Job not found") {
        return { success: false, error: "Job not found" };
      }
      if (error.message === "DLQ entry not found or already reprocessed") {
        return { success: false, error: "DLQ entry already reprocessed" };
      }
      throw error;
    }

    await this._audit(adminId, 'admin_reprocess_dlq', 'job', entry.job_id, { dlqId, reason });
    return { success: true, jobId: entry.job_id, dlqId };
  }

  // ============ MODERATION ============

  /**
   * Get moderation queue (blocked content)
   */
  async getModerationQueue({ limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminModerationRepository.listBlockedVersions(bounds);
  }

  /**
   * Override moderation decision (approve blocked content)
   */
  async overrideModeration(versionId, adminId, reason) {
    const result = await this.adminModerationRepository.approveBlockedVersion({
      versionId,
      reason,
    });
    if (result.status === "not_found") {
      return { success: false, error: "Track version not found" };
    }
    if (result.status === "not_blocked") {
      return {
        success: false,
        error: "Track version is not blocked",
        moderationStatus: result.moderationStatus,
      };
    }

    await this._audit(adminId, 'admin_moderation_override', 'track_version', versionId, { reason });
    return { success: true };
  }

  // ============ SHARE MANAGEMENT ============

  /**
   * List share tokens with optional filters
   */
  async listShares({ status, trackId, userId, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminShareManagementRepository.listShares({
      status,
      trackId,
      userId,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Rebind a share token to a new device
   */
  async rebindShare(shareId, newDeviceId, adminId, reason) {
    const share = await this.adminShareManagementRepository.getShareById(shareId);
    if (!share) return { success: false, error: 'Share not found' };

    const oldDeviceId = share.bound_device_id;
    await this.adminShareManagementRepository.rebindShareDevice({
      shareId,
      newDeviceId,
    });
    await this._audit(adminId, 'share_rebound', 'share_token', shareId, { oldDeviceId, newDeviceId, reason });
    return { success: true, oldDeviceId, newDeviceId };
  }

  // ============ POEM SHARE MANAGEMENT ============

  /**
   * List poem share tokens with optional filters
   */
  async listPoemShares({ status, poemId, userId, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminShareManagementRepository.listPoemShares({
      status,
      poemId,
      userId,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Reset claim attempts on a poem share token (unlocks a locked-out recipient)
   */
  async resetPoemShareAttempts(shareId, adminId, reason) {
    const share =
      await this.adminShareManagementRepository.getPoemShareById(shareId);
    if (!share) return { success: false, error: 'Poem share not found' };

    const oldAttempts = share.claim_attempts;
    await this.adminShareManagementRepository.resetPoemShareAttempts(shareId);
    await this._audit(adminId, 'poem_share_attempts_reset', 'poem_share_token', shareId, { oldAttempts, reason });
    return { success: true, oldAttempts };
  }

  /**
   * Revoke a poem share token
   */
  async revokePoemShare(shareId, adminId, reason) {
    const share =
      await this.adminShareManagementRepository.getPoemShareById(shareId);
    if (!share) return { success: false, error: 'Poem share not found' };
    if (share.status === 'revoked') return { success: false, error: 'Already revoked' };

    const oldStatus = share.status;
    await this.adminShareManagementRepository.revokePoemShare(shareId);
    await this._audit(adminId, 'poem_share_revoked', 'poem_share_token', shareId, { oldStatus, reason });
    return { success: true, oldStatus };
  }

  // ============ SYSTEM HEALTH & SECURITY ============

  /**
   * Get system health metrics (jobs, DLQ, recent errors)
   */
  async getSystemHealth() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { jobs, dlqCount, recentErrors } =
      await this.adminJobOpsRepository.getSystemHealth({ since: dayAgo });

    return {
      jobs: { running: jobs?.running || 0, queued: jobs?.queued || 0, failed: jobs?.failed || 0 },
      dlqCount,
      recentErrors,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Search auth events (login attempts, token events, etc.)
   */
  async searchAuthEvents({ eventType, userId, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminSecurityObservabilityRepository.searchAuthEvents({
      filters: { eventType, userId, startDate, endDate },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Get auth event statistics (last 24h)
   */
  async getAuthEventStats() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const stats =
      await this.adminSecurityObservabilityRepository.getAuthEventStats({
        since: dayAgo,
      });

    const loginSuccess = stats.find(s => s.event_type === 'login_success')?.count || 0;
    const loginFailed = stats.find(s => s.event_type === 'login_failed')?.count || 0;

    return { byType: stats, loginSuccess, loginFailed };
  }

  /**
   * Get Apple refresh-token audit stats (validation + failures)
   */
  async getAppleRefreshTokenStats(days = 7) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows =
      await this.adminSecurityObservabilityRepository.getAppleRefreshTokenStats({
        startDate,
      });

    const validated = rows.find(r => r.action === 'apple_refresh_token_validated')?.count || 0;
    const invalid = rows.find(r => r.action === 'apple_refresh_token_invalid')?.count || 0;
    const lastValidated = rows.find(r => r.action === 'apple_refresh_token_validated')?.last_seen || null;
    const lastInvalid = rows.find(r => r.action === 'apple_refresh_token_invalid')?.last_seen || null;

    return {
      validated,
      invalid,
      lastValidated,
      lastInvalid,
      byAction: rows,
    };
  }

  /**
   * Search admin action audit logs
   */
  async searchAuditLogs({ action, resourceType, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminSecurityObservabilityRepository.searchAuditLogs({
      filters: {
        actionPattern: action ? `%${escapeLikePattern(action)}%` : null,
        resourceType,
        startDate,
        endDate,
      },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Get rate limits with optional filters
   */
  async getRateLimits({ userId, actionType, nearLimit = false, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminSecurityObservabilityRepository.getRateLimits({
      filters: {
        userId,
        actionType,
        nearLimit,
        windowStartAfterMs: Date.now() - 86400000,
      },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Reset a user's rate limit for specific action
   */
  async resetUserRateLimit(userId, actionType, adminId, reason) {
    await this.adminSecurityObservabilityRepository.deleteRateLimitRows(
      userId,
      actionType,
    );
    await this._audit(adminId, 'admin_reset_rate_limit', 'user', userId, { actionType, reason });
    return { success: true };
  }

  /**
   * Get voice profile consent logs
   */
  async getConsentLogs({ consentVersion, startDate, endDate, limit = 50, offset = 0 }) {
    const bounds = safeBounds(limit, offset);
    return this.adminSecurityObservabilityRepository.getConsentLogs({
      filters: { consentVersion, startDate, endDate },
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  /**
   * Get security configuration
   */
  async getSecurityConfig() {
    const securityConfig = await this.appConfigRepository.findSecurityConfig("default");
    if (securityConfig) {
      return {
        sessionDurationHours: securityConfig.session_duration_hours,
        maxFailedLoginAttempts: securityConfig.max_failed_logins,
        lockoutDurationMinutes: securityConfig.lockout_minutes,
        rateLimitDefaults: JSON.parse(securityConfig.rate_limit_defaults_json || '{}'),
        iosMinSupportedVersion: securityConfig.ios_min_supported_version || "",
        iosRecommendedVersion: securityConfig.ios_recommended_version || "",
        iosUpdateMessage: securityConfig.ios_update_message || "",
        iosAutoRecommendedVersion: Boolean(securityConfig.ios_auto_recommended_version),
        iosLastAppStoreVersion: securityConfig.ios_last_app_store_version || "",
        iosLastAppStoreSyncAt: securityConfig.ios_last_app_store_sync_at || "",
        iosAppStoreSyncError: securityConfig.ios_app_store_sync_error || "",
      };
    }
    // Return defaults if no config exists
    return {
      sessionDurationHours: 8,
      maxFailedLoginAttempts: 5,
      lockoutDurationMinutes: 15,
      rateLimitDefaults: {
        enrollment_start: { limit: 3, windowSeconds: 86400 },
        render_preview: { limit: 20, windowSeconds: 86400 },
        track_create: { limit: 20, windowSeconds: 3600 }
      },
      iosMinSupportedVersion: "",
      iosRecommendedVersion: "",
      iosUpdateMessage: "",
      iosAutoRecommendedVersion: false,
      iosLastAppStoreVersion: "",
      iosLastAppStoreSyncAt: "",
      iosAppStoreSyncError: "",
    };
  }

  /**
   * Update security configuration
   */
  async updateSecurityConfig(config, adminId) {
    return this._persistSecurityConfig(config, adminId, { audit: true });
  }

  async syncIOSVersionFromAppStore(adminId, { force = true } = {}) {
    if (!this.appStoreConnectService?.isConfigured()) {
      throw new Error("App Store Connect credentials are not configured");
    }

    const version = await this.appStoreConnectService.getLatestReadyIOSVersion({ force });
    if (!version) {
      throw new Error("No iOS App Store version in Ready for Distribution state was found");
    }

    const current = await this.getSecurityConfig();
    const syncedAt = new Date().toISOString();
    const nextConfig = {
      ...current,
      iosLastAppStoreVersion: version,
      iosLastAppStoreSyncAt: syncedAt,
      iosAppStoreSyncError: "",
      iosRecommendedVersion: current.iosAutoRecommendedVersion ? current.iosRecommendedVersion : version,
    };

    await this._persistSecurityConfig(nextConfig, adminId, { audit: false });
    await this._audit(adminId, "admin_sync_ios_version_from_app_store", "config", "security", {
      version,
      autoRecommendedVersion: current.iosAutoRecommendedVersion,
    });

    return {
      success: true,
      version,
      syncedAt,
    };
  }

  async resolveIOSAppUpdatePolicy({
    allowLiveAppStoreSync = false,
    exposeSyncError = false,
  } = {}) {
    const securityConfig = await this.getSecurityConfig();
    let recommendedVersion = securityConfig.iosRecommendedVersion || null;
    let lastSyncedVersion = securityConfig.iosLastAppStoreVersion || null;
    let lastSyncAt = securityConfig.iosLastAppStoreSyncAt || null;
    let lastSyncError = securityConfig.iosAppStoreSyncError || null;

    if (securityConfig.iosAutoRecommendedVersion && lastSyncedVersion) {
      recommendedVersion = lastSyncedVersion;
    }

    if (
      allowLiveAppStoreSync &&
      securityConfig.iosAutoRecommendedVersion &&
      this.appStoreConnectService?.isConfigured()
    ) {
      try {
        const detectedVersion = await this.appStoreConnectService.getLatestReadyIOSVersion();
        if (detectedVersion) {
          recommendedVersion = detectedVersion;
          lastSyncedVersion = detectedVersion;
          lastSyncError = "";
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "App Store Connect sync failed";
        lastSyncError = message;
      }
    }

    return {
      minimum_supported_version: securityConfig.iosMinSupportedVersion || null,
      minimum_supported_build: config.IOS_MIN_SUPPORTED_BUILD > 0 ? config.IOS_MIN_SUPPORTED_BUILD : null,
      recommended_version: recommendedVersion,
      recommended_build: config.IOS_RECOMMENDED_BUILD > 0 ? config.IOS_RECOMMENDED_BUILD : null,
      message: securityConfig.iosUpdateMessage || null,
      app_store_url: config.APP_STORE_URL || null,
      auto_recommended_version: securityConfig.iosAutoRecommendedVersion,
      last_app_store_version: lastSyncedVersion,
      last_app_store_sync_at: lastSyncAt,
      ...(exposeSyncError ? { last_app_store_sync_error: lastSyncError } : {}),
    };
  }

  // ============ VOICE PROFILE MANAGEMENT ============

  /**
   * Force a user's voice profile to require re-verification
   */
  async forceVoiceReverify(userId, adminId, reason) {
    const profile =
      await this.adminUserSessionControlRepository.findReverifiableVoiceProfile(
        userId,
      );

    if (!profile) {
      return { success: false, error: 'No active voice profile found' };
    }

    const result =
      await this.adminUserSessionControlRepository.markVoiceProfilePendingReverification(
        profile.id,
      );
    if (result.changes === 0) {
      return { success: false, error: 'No active voice profile found' };
    }

    await this._audit(adminId, 'admin_force_reverify', 'voice_profile', profile.id, { targetUserId: userId, previousStatus: profile.status, reason });

    return { success: true, voiceProfileId: profile.id };
  }

  // ============ USER SESSION MANAGEMENT ============

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId, limit = 20) {
    return await this.adminUserSessionControlRepository.listActiveUserSessions(
      userId,
      limit,
    );
  }

  /**
   * Revoke a specific user session
   */
  async revokeUserSession(userId, sessionId, adminId, reason) {
    const result =
      await this.adminUserSessionControlRepository.revokeUserSession({
        userId,
        sessionId,
        revokedAt: new Date().toISOString(),
      });

    if (result.changes === 0) {
      return { success: false, error: 'Session not found or already revoked' };
    }

    await this._audit(adminId, 'admin_revoke_session', 'session', sessionId, { targetUserId: userId, reason });
    return { success: true };
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId, adminId, reason) {
    const result =
      await this.adminUserSessionControlRepository.revokeAllUserSessions({
        userId,
        revokedAt: new Date().toISOString(),
      });

    await this._audit(adminId, 'admin_revoke_all_sessions', 'user', userId, { sessionsRevoked: result.changes, reason });
    return { success: true, sessionsRevoked: result.changes };
  }

  // ============ PROVIDER CONTROL PLANE ============

  /**
   * Get status of all external providers
   */
  async getProviderStatus() {
    return await this.adminControlRepository.listProviderStatus();
  }

  /**
   * Set provider status (active, paused, disabled)
   */
  async setProviderStatus(providerName, status, adminId, reason) {
    const now = new Date().toISOString();
    await this.adminControlRepository.setProviderStatus({
      providerName,
      status,
      adminId,
      reason,
      now,
    });

    await this._audit(adminId, `admin_set_provider_${status}`, 'provider', providerName, { status, reason });
    return { success: true };
  }

  // ============ QUEUE CONTROL PLANE ============

  /**
   * Get status of all job queues
   */
  async getQueueStatus() {
    return await this.adminControlRepository.listQueueStatus();
  }

  /**
   * Set queue status (active, paused, draining)
   */
  async setQueueStatus(queueName, status, adminId, reason) {
    const now = new Date().toISOString();
    await this.adminControlRepository.setQueueStatus({
      queueName,
      status,
      adminId,
      reason,
      now,
    });

    await this._audit(adminId, `admin_set_queue_${status}`, 'queue', queueName, { status, reason });
    return { success: true };
  }

  // ============ BILLING & REVENUE ============

  /**
   * Get revenue metrics for dashboard
   * @param {number} days - Number of days to look back
   */
  async getRevenueMetrics(days = 30) {
    const sales = await this.getBillingSales({ days, limit: 5000, offset: 0 });
    const totalRevenue = singleCurrencyAmount(sales.summary.revenueByCurrency);
    const subscriptionRevenue = singleCurrencyAmount(
      sales.summary.subscriptionRevenueByCurrency,
    );
    const giftRevenue = singleCurrencyAmount(sales.summary.giftRevenueByCurrency);
    const period = this._parseSalesPeriod(days);

    const subscriptionsByTier =
      await this.adminBillingRepository.listSubscriptionsByTierSince({
        since: period.since,
      });

    const trialData =
      await this.adminBillingRepository.getTrialConversionStatsSince({
        since: period.since,
      });

    const cancellations =
      await this.adminBillingRepository.countCancelledSubscriptionsSince({
        since: period.since,
      });

    const activeSubscriptions =
      await this.adminBillingRepository.countActiveSubscriptions();

    const churnRate = activeSubscriptions > 0
      ? ((cancellations / activeSubscriptions) * 100).toFixed(2)
      : '0.00';

    return {
      totalRevenue,
      subscriptionRevenue,
      songPurchases: giftRevenue,
      hasMixedRevenueCurrencies: sales.summary.revenueByCurrency.length > 1,
      payingUsers: sales.summary.payingUsers,
      subscriptionsByTier,
      trialCount: trialData.current_trials || 0,
      trialConversions: trialData.converted_trials || 0,
      cancellations,
      churnRate,
      salesCount: sales.summary.totalSalesCount,
      giftSalesCount: sales.summary.giftSalesCount,
      subscriptionSalesCount: sales.summary.subscriptionSalesCount,
      revenueByCurrency: sales.summary.revenueByCurrency,
      unknownAmountCount: sales.summary.unknownAmountCount,
    };
  }

  /**
   * Get receipt-backed Apple sales and current subscriber visibility.
   */
  async getBillingSales({ days = 30, limit = 50, offset = 0 } = {}) {
    const period = this._parseSalesPeriod(days);
    const bounds = safeBounds(limit, offset, 200);
    const productCatalog = await this._getProductCatalog();

    const summary = await this._buildBillingSalesSummary(period, productCatalog);
    const recentSales = await this._getReceiptSalesPage(
      period,
      productCatalog,
      bounds,
    );
    const currentSubscribers = (await this._getCurrentSubscribers(100)).map(
      (row) => this._normalizeCurrentSubscriber(row),
    );

    return {
      period,
      summary,
      recentSales,
      currentSubscribers,
      pagination: {
        limit: bounds.limit,
        offset: bounds.offset,
        returned: recentSales.length,
      },
    };
  }

  /**
   * Get subscription health metrics
   */
  async getSubscriptionHealth() {
    const now = new Date().toISOString();
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const health = await this.adminBillingRepository.getSubscriptionHealthCounts({
      now,
      weekFromNow,
      weekAgo,
    });

    return {
      activeSubscriptions: health.activeSubscriptions,
      totalActive: health.activeSubscriptions.reduce(
        (sum, t) => sum + t.count,
        0,
      ),
      trialCount: health.trialCount,
      expiringThisWeek: health.expiringThisWeek,
      recentCancellations: health.recentCancellations,
      inGracePeriod: health.inGracePeriod,
    };
  }

  /**
   * Get recent billing transactions
   */
  async getBillingTransactions({ limit = 50, offset = 0 } = {}) {
    const sales = await this.getBillingSales({ days: "all", limit, offset });
    return sales.recentSales.map((sale) => ({
      id: sale.id,
      user_id: sale.user_id,
      user_email: sale.user_email,
      type: sale.sale_type,
      amount: sale.amount ?? 0,
      currency: sale.currency,
      product_id: sale.product_id,
      transaction_id: sale.transaction_id,
      created_at: sale.purchase_date || sale.created_at,
      sale,
    }));
  }

  /**
   * Get webhook health metrics
   */
  async getWebhookHealth() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const health = await this.adminBillingRepository.getWebhookHealth({
      since: dayAgo,
    });

    return {
      ...health,
      pendingRetries: 0, // Would need a webhook retry queue table
    };
  }

  // ============ GROWTH & ATTRIBUTION ============

  /**
   * Get UTM attribution breakdown
   * @param {number} days - Number of days to look back
   */
  async getAttribution(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const buildBreakdown = async (field) => {
      const label = field;
      const [shareRows, downloadRows] = await Promise.all([
        this.attributionRepository.listShareAttributionBreakdown({
          field,
          since: daysAgo,
        }),
        this.attributionRepository.listDownloadAttributionBreakdown({
          field,
          since: daysAgo,
        }),
      ]);

      const merged = new Map();
      const ensure = (value) => {
        const key = value || "";
        if (!merged.has(key)) {
          merged.set(key, {
            [label]: value,
            share_count: 0,
            claim_count: 0,
            download_count: 0,
            registration_count: 0,
          });
        }
        return merged.get(key);
      };

      for (const row of shareRows) {
        const item = ensure(row.value);
        item.share_count = Number(row.share_count || 0);
        item.claim_count = Number(row.claim_count || 0);
      }

      for (const row of downloadRows) {
        const item = ensure(row.value);
        item.download_count = Number(row.download_count || 0);
        item.registration_count = Number(row.registration_count || 0);
      }

      return Array.from(merged.values()).sort((a, b) => (
        b.download_count - a.download_count
        || b.registration_count - a.registration_count
        || b.share_count - a.share_count
      ));
    };

    const [bySource, byMedium, byCampaign, byContent, byTerm] = await Promise.all([
      buildBreakdown("utm_source"),
      buildBreakdown("utm_medium"),
      buildBreakdown("utm_campaign"),
      buildBreakdown("utm_content"),
      buildBreakdown("utm_term"),
    ]);

    const [appleAdsByCampaign, totals] = await Promise.all([
      this.attributionRepository.listAppleAdsCampaignAttribution({
        since: daysAgo,
        limit: 50,
      }),
      this.attributionRepository.getAttributionTotals({ since: daysAgo }),
    ]);
    const {
      withAttribution,
      totalShares,
      downloadsWithAttribution,
      totalDownloads,
      attributedRegistrations,
    } = totals;

    return {
      bySource,
      byMedium,
      byCampaign,
      byContent,
      byTerm,
      appleAdsByCampaign,
      withAttribution,
      totalShares,
      attributionRate: totalShares > 0 ? ((withAttribution / totalShares) * 100).toFixed(2) : '0.00',
      downloadsWithAttribution,
      totalDownloads,
      attributedRegistrations,
      downloadAttributionRate: totalDownloads > 0 ? ((downloadsWithAttribution / totalDownloads) * 100).toFixed(2) : '0.00',
    };
  }

  async getAppleAdsKeywordMap({ limit = 500, offset = 0 } = {}) {
    const bounds = safeBounds(limit, offset, 1000);
    return this.attributionRepository.listAppleAdsKeywordMap(bounds);
  }

  async upsertAppleAdsKeywordMap(rows, adminId = "system") {
    if (!Array.isArray(rows)) {
      throw new Error("keywords must be an array");
    }
    if (rows.length > 5000) {
      throw new Error("keyword map sync is limited to 5000 rows per request");
    }

    const now = new Date().toISOString();
    let upserted = 0;
    for (const row of rows) {
      const keywordId = String(row.keyword_id ?? row.keywordId ?? row.id ?? "").trim();
      const keywordText = String(row.keyword_text ?? row.keyword ?? row.text ?? "").trim();
      if (!keywordId || !keywordText) continue;

      await this.attributionRepository.upsertAppleAdsKeywordMapRow({
        keywordId,
        campaignId: row.campaign_id != null ? String(row.campaign_id) : null,
        campaignName: row.campaign_name || null,
        adGroupId: row.ad_group_id != null ? String(row.ad_group_id) : null,
        adGroupName: row.ad_group_name || null,
        keywordText,
        matchType: row.match_type || row.matchType || null,
        bidAmount:
          row.bid_amount != null
            ? String(row.bid_amount)
            : (row.bidAmount != null ? String(row.bidAmount) : null),
        status: row.status || null,
        source: row.source || "apple_ads_api",
        lastSeenAt: row.last_seen_at || now,
        now,
      });
      upserted += 1;
    }

    await this._audit(adminId, "admin_sync_apple_ads_keyword_map", "apple_ads_keyword_map", "bulk", {
      rowCount: rows.length,
      upserted,
      contract: "apple-ads-keyword-map-v1",
    });

    return { upserted, skipped: rows.length - upserted };
  }

  /**
   * Get teaser funnel metrics (views → clicks → conversions)
   * @param {number} days - Number of days to look back
   */
  async getTeaserMetrics(days = 7) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const metrics = await this.adminMetricsRepository.getTeaserMetrics({
      daysAgo,
    });
    const { teaserViews, shareClaims, shareStreams, dailyViews } = metrics;

    return {
      teaserViews,
      shareClaims,
      shareStreams,
      viewToClaimRate: teaserViews > 0 ? ((shareClaims / teaserViews) * 100).toFixed(2) : '0.00',
      viewToStreamRate: teaserViews > 0 ? ((shareStreams / teaserViews) * 100).toFixed(2) : '0.00',
      dailyViews,
    };
  }

  /**
   * Get share performance metrics
   * @param {number} days - Number of days to look back
   */
  async getShareMetrics(days = 30) {
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const metrics = await this.adminMetricsRepository.getShareMetrics({
      daysAgo,
    });
    const { created, claimed, byStatus, avgAccess, dailyCreated } = metrics;

    return {
      created,
      claimed,
      claimRate: created > 0 ? ((claimed / created) * 100).toFixed(2) : '0.00',
      byStatus,
      avgAccessCount: avgAccess.toFixed(1),
      dailyCreated,
    };
  }

  // ============ FUNNEL ANALYTICS ============

  /**
   * Event counts grouped by name for the selected window.
   * Cached 60s per days value.
   */
  async getAnalyticsOverview(days) {
    const clampedDays = this._clampDays(days);
    const cacheKey = `overview:${clampedDays}`;
    const cached = this._analyticsCacheGet(cacheKey);
    if (cached) return cached;

    const daysAgo = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString();
    const counts = await this.eventsRepository.getAdminEventCountsAfter(daysAgo);

    const payload = { days: clampedDays, counts };
    this._analyticsCacheSet(cacheKey, payload);
    return payload;
  }

  /**
   * Daily series for a single event name. Cached 60s per (eventName, days).
   */
  async getAnalyticsDaily(eventName, days) {
    const clampedDays = this._clampDays(days);
    const cacheKey = `daily:${eventName}:${clampedDays}`;
    const cached = this._analyticsCacheGet(cacheKey);
    if (cached) return cached;

    const daysAgo = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString();
    const byDay = await this.eventsRepository.getAdminDailyEventCountsAfter(
      eventName,
      daysAgo,
    );

    const payload = { event_name: eventName, days: clampedDays, byDay };
    this._analyticsCacheSet(cacheKey, payload);
    return payload;
  }

  /**
   * Per-user cohort funnel conversion across the 4 critical hops:
   *   auth_completed → create_started
   *   create_started → create_completed
   *   create_completed → first_song_completed
   *   first_song_completed → share_create
   *
   * "startUsers" = distinct users who fired startEvent in the window.
   * "convertedUsers" = of those, who also fired endEvent AFTER their startEvent.
   *
   * This is a true per-user cohort ratio — not aggregate-over-window.
   * Cached 60s per days value.
   */
  async getFunnelCohort(days) {
    const clampedDays = this._clampDays(days);
    const cacheKey = `funnel:${clampedDays}`;
    const cached = this._analyticsCacheGet(cacheKey);
    if (cached) return cached;

    const daysAgo = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString();
    const hops = [
      ["auth_completed", "create_started"],
      ["create_started", "create_completed"],
      ["create_completed", "first_song_completed"],
      ["first_song_completed", "share_create"],
    ];

    const steps = [];
    for (const [from, to] of hops) {
      const startRow = await this.eventsRepository.countDistinctUsersForEventAfter(
        from,
        daysAgo,
      );
      const startUsers = startRow?.c ?? 0;

      // Converted users: had startEvent in window, then endEvent at or after their earliest startEvent.
      const convertedRow =
        await this.eventsRepository.countDistinctUsersConvertedAfter(
          from,
          to,
          daysAgo,
        );
      const convertedUsers = convertedRow?.c ?? 0;

      steps.push({
        from,
        to,
        startUsers,
        convertedUsers,
        conversionRate: startUsers > 0 ? ((convertedUsers / startUsers) * 100).toFixed(2) : "0.00",
      });
    }

    const payload = { days: clampedDays, steps };
    this._analyticsCacheSet(cacheKey, payload);
    return payload;
  }

  /**
   * Per-user event timeline for support investigations.
   * Writes an audit_logs row on every successful call — admin reads of user
   * behavioral data must be traceable.
   */
  async getUserAnalytics(adminId, adminEmail, userId, limit) {
    const clampedLimit = this._clampLimit(limit, 200);
    const events = await this.eventsRepository.getAdminUserEvents(
      userId,
      clampedLimit,
    );

    // Audit trail — not conditional on whether events exist.
    const auditId = `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const metadata = JSON.stringify({
      admin_id: adminId,
      admin_email: adminEmail,
      target_user_id: userId,
      event_count: events.length,
    });
    await this.eventsRepository.insertUserAnalyticsReadAudit({
      id: auditId,
      adminId,
      targetUserId: userId,
      metadataJson: metadata,
      createdAt: now,
    });

    return { userId, limit: clampedLimit, events };
  }

  // ============ ENROLLMENT METRICS ============

  /**
   * Get voice enrollment metrics
   */
  async getEnrollmentMetrics() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.adminMetricsRepository.getEnrollmentMetrics({ weekAgo });
  }

  // ============ RENDER PIPELINE METRICS ============

  /**
   * Get render pipeline success metrics
   */
  async getRenderSuccessMetrics() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.adminMetricsRepository.getRenderSuccessMetrics({ weekAgo });
  }

  // ============ RISK METRICS ============

  /**
   * Get user risk distribution metrics
   */
  async getRiskMetrics() {
    const now = new Date().toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const metrics = await this.adminMetricsRepository.getRiskMetrics({
      now,
      weekAgo,
    });

    // Parse escalations to extract from/to risk levels
    const parsedEscalations = metrics.recentEscalations.map(e => {
      try {
        const meta = JSON.parse(e.metadata_json || '{}');
        return {
          user_id: e.user_id,
          to: meta.riskLevel || 'unknown',
          reason: meta.reason || '',
          date: e.date,
        };
      } catch (parseError) {
        console.warn(`[AdminService] Malformed metadata_json in audit_logs for user ${e.user_id}:`, parseError.message);
        return {
          user_id: e.user_id,
          to: 'unknown',
          reason: '[metadata parse error]',
          date: e.date,
        };
      }
    });

    return {
      distribution: metrics.distribution,
      lockedAccounts: metrics.lockedAccounts,
      recentEscalations: parsedEscalations,
    };
  }

  // ============ STT PROVIDER CONFIG ============

  /**
   * Get STT provider configuration
   * Returns the current primary/fallback provider settings and status
   */
  async getSTTConfig() {
    // Get STT config from app_config table
    const configRow = await this.appConfigRepository.findConfigValue("stt_config");

    let config;
    if (configRow) {
      try {
        config = JSON.parse(configRow.value_json);
      } catch {
        // Fallback to defaults if JSON is malformed
        config = {
          primary_provider: 'whisperkit',
          fallback_provider: 'openai',
          whisperkit_model: 'small',
        };
      }
    } else {
      config = {
        primary_provider: 'whisperkit',
        fallback_provider: 'openai',
        whisperkit_model: 'small',
      };
    }

    // Get provider status for all STT providers
    const providerStatus = await this.appConfigRepository.listProviderStatusByNameLike("stt_%");

    const statusMap = {};
    for (const p of providerStatus) {
      statusMap[p.provider_name] = p.status;
    }

    return {
      primary_provider: config.primary_provider,
      fallback_provider: config.fallback_provider,
      whisperkit_model: config.whisperkit_model,
      provider_status: statusMap,
    };
  }

  /**
   * Update STT provider configuration
   * @param {Object} config - New configuration
   * @param {string} config.primary_provider - Primary STT provider (apple, whisperkit, openai)
   * @param {string} config.fallback_provider - Fallback STT provider
   * @param {string} config.whisperkit_model - WhisperKit model size (tiny, small, medium)
   * @param {string} adminId - Admin user ID for audit
   */
  async setSTTConfig(config, adminId) {
    const validProviders = ['apple', 'whisperkit', 'openai'];
    const validModels = ['tiny', 'small', 'medium', 'large'];

    // Validate providers
    if (config.primary_provider && !validProviders.includes(config.primary_provider)) {
      throw new Error(`Invalid primary_provider: ${config.primary_provider}`);
    }
    if (config.fallback_provider && !validProviders.includes(config.fallback_provider)) {
      throw new Error(`Invalid fallback_provider: ${config.fallback_provider}`);
    }
    if (config.whisperkit_model && !validModels.includes(config.whisperkit_model)) {
      throw new Error(`Invalid whisperkit_model: ${config.whisperkit_model}`);
    }

    const now = new Date().toISOString();

    // Get existing config to merge
    const existing = await this.getSTTConfig();
    const newConfig = {
      primary_provider: config.primary_provider || existing.primary_provider,
      fallback_provider: config.fallback_provider || existing.fallback_provider,
      whisperkit_model: config.whisperkit_model || existing.whisperkit_model,
    };

    await this.appConfigRepository.upsertConfigValue({
      key: "stt_config",
      valueJson: JSON.stringify(newConfig),
      updatedAt: now,
      updatedBy: adminId,
    });

    await this._audit(adminId, 'admin_update_stt_config', 'config', 'stt', newConfig);

    return { success: true, config: newConfig };
  }

  /**
   * Get music provider routing configuration
   * Controls runtime default provider and auto style routing behavior.
   */
  async getMusicProviderConfig() {
    const row = await this.appConfigRepository.findConfigValue(
      MUSIC_PROVIDER_CONFIG_KEY,
    );

    if (!row) {
      return normalizeMusicProviderConfig(
        {},
        {
          includeMetadata: true,
        },
      );
    }

    const parsed = parseMusicProviderConfigJson(row.value_json, {
      includeMetadata: true,
      updatedAt: row.updated_at || null,
      updatedBy: row.updated_by || null,
    });
    if (parsed.parseError) {
      console.warn("[AdminService] Invalid music_provider_config JSON, using defaults");
    }
    return parsed.config;
  }

  /**
   * Update music provider routing configuration
   * @param {Object} config - New configuration
   * @param {string} config.default_provider - elevenlabs|suno
   * @param {string} config.suno_model - V4_5|V5|V5_5
   * @param {boolean} config.auto_style_routing - Enable style-based provider auto-routing
   * @param {string} adminId - Admin user ID for audit
   */
  async setMusicProviderConfig(config, adminId) {
    const existing = await this.getMusicProviderConfig();
    const next = applyMusicProviderConfigPatch(existing, config);

    const now = new Date().toISOString();
    const newConfig = next;

    await this.appConfigRepository.upsertConfigValue({
      key: MUSIC_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(newConfig),
      updatedAt: now,
      updatedBy: adminId,
    });

    await this._audit(adminId, "admin_update_music_provider_config", "config", "music_provider", newConfig);

    return { success: true, config: newConfig };
  }

  /**
   * Diagnostics feed for recent music generations (success + failure).
   * Includes provider routing, style intent summary, and quality gate results.
   */
  async getRecentMusicDiagnostics({ limit = 30, provider = null, status = null }) {
    const bounds = safeBounds(limit, 0, 100);
    const rows =
      await this.adminMusicDiagnosticsRepository.listRecentTrackVersions(
        bounds.limit,
      );
    const jobRows =
      await this.adminMusicDiagnosticsRepository.listLatestJobsForTrackVersions(
        rows.map((row) => row.id),
      );
    const latestJobByTrackVersion = new Map();
    for (const job of jobRows) {
      if (!latestJobByTrackVersion.has(job.track_version_id)) {
        latestJobByTrackVersion.set(job.track_version_id, job);
      }
    }

    const diagnostics = [];
    for (const row of rows) {
      if (status && row.status !== status) {
        continue;
      }

      const musicPlan = (() => {
        try {
          return row.music_plan_json ? JSON.parse(row.music_plan_json) : {};
        } catch {
          return {};
        }
      })();
      const provenance = (() => {
        try {
          return row.provenance_json ? JSON.parse(row.provenance_json) : {};
        } catch {
          return {};
        }
      })();

      const resolvedProvider =
        musicPlan.provider_resolved ||
        provenance?.music?.provider ||
        provenance?.render?.provider ||
        null;
      if (provider && resolvedProvider !== provider) {
        continue;
      }

      const latestJob = latestJobByTrackVersion.get(row.id);

      diagnostics.push({
        track_version_id: row.id,
        track_id: row.track_id,
        version_num: row.version_num,
        user_id: row.user_id,
        title: row.title,
        style: row.style,
        voice_mode: row.voice_mode,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
        provider: resolvedProvider,
        provider_support: musicPlan.provider_support || null,
        provider_support_score: musicPlan.provider_support_score ?? null,
        provider_resolution_reason: musicPlan.provider_resolution_reason || null,
        generation_mode: musicPlan.generation_mode || null,
        plan_schema_version: musicPlan.plan_schema_version || null,
        style_prompt_compact: musicPlan.style_prompt_compact || null,
        provider_style_hint: musicPlan.provider_style_hint || null,
        style_negative_constraints: musicPlan.style_negative_constraints || null,
        style_intent: musicPlan.style_intent || null,
        quality_gate: provenance?.quality?.last_evaluation || null,
        reroll_count: provenance?.quality?.reroll_count ?? 0,
        last_error_code: latestJob?.error_code || null,
        last_error_message: latestJob?.error_message || null,
        last_error_at: latestJob?.updated_at || null,
      });
    }

    return { diagnostics };
  }

  // ============ ONBOARDING SAMPLES ============

  /**
   * List all onboarding audio samples
   */
  async getOnboardingSamples() {
    return await this.adminOnboardingSampleRepository.listAll();
  }

  /**
   * Get the currently active onboarding sample (for app config)
   * Returns null if none active
   */
  async getActiveOnboardingSample() {
    try {
      const row = await this.appConfigRepository.findActiveOnboardingSample();
      return row || null;
    } catch {
      // Table may not exist yet if migration hasn't run
      return null;
    }
  }

  /**
   * Create a new onboarding audio sample
   */
  async createOnboardingSample({ label, audio_url }, adminId) {
    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      throw new Error('label is required');
    }
    if (!audio_url || typeof audio_url !== 'string') {
      throw new Error('audio_url is required');
    }
    if (!audio_url.startsWith('/audio/') && !audio_url.startsWith('https://')) {
      throw new Error('audio_url must start with /audio/ or be an HTTPS URL');
    }
    if (label.length > 200) {
      throw new Error('label must be 200 characters or fewer');
    }
    if (audio_url.length > 500) {
      throw new Error('audio_url must be 500 characters or fewer');
    }

    const id = 'os_' + require('crypto').randomBytes(6).toString('hex');
    const now = new Date().toISOString();

    await this.adminOnboardingSampleRepository.createSample({
      id,
      label: label.trim(),
      audioUrl: audio_url.trim(),
      now,
      updatedBy: adminId,
    });

    await this._audit(adminId, 'admin_create_onboarding_sample', 'onboarding_sample', id, { label, audio_url });

    return await this.adminOnboardingSampleRepository.findById(id);
  }

  /**
   * Update an onboarding sample (allowlisted fields only)
   */
  async updateOnboardingSample(id, fields, adminId) {
    const allowedFields = ['label', 'audio_url'];
    const filteredUpdates = {};
    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        filteredUpdates[field] = fields[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    if (filteredUpdates.audio_url) {
      if (!filteredUpdates.audio_url.startsWith('/audio/') && !filteredUpdates.audio_url.startsWith('https://')) {
        throw new Error('audio_url must start with /audio/ or be an HTTPS URL');
      }
    }
    if (filteredUpdates.label && filteredUpdates.label.length > 200) {
      throw new Error('label must be 200 characters or fewer');
    }

    const previous = await this.adminOnboardingSampleRepository.findById(id);
    if (!previous) {
      throw new Error('Onboarding sample not found');
    }

    await this.adminOnboardingSampleRepository.updateSample({
      id,
      fields: filteredUpdates,
      now: new Date().toISOString(),
      updatedBy: adminId,
    });

    await this._audit(adminId, 'admin_update_onboarding_sample', 'onboarding_sample', id, {
      previous: { label: previous.label, audio_url: previous.audio_url },
      updated: filteredUpdates,
    });

    return await this.adminOnboardingSampleRepository.findById(id);
  }

  /**
   * Delete an onboarding sample
   */
  async deleteOnboardingSample(id, adminId) {
    const existing = await this.adminOnboardingSampleRepository.findById(id);
    if (!existing) {
      throw new Error('Onboarding sample not found');
    }

    await this.adminOnboardingSampleRepository.deleteSample(id);
    await this._audit(adminId, 'admin_delete_onboarding_sample', 'onboarding_sample', id, {
      label: existing.label, audio_url: existing.audio_url,
    });

    return { success: true };
  }

  /**
   * Activate a single onboarding sample (transactional: deactivate all, then activate one)
   */
  async activateOnboardingSample(id, adminId) {
    const existing = await this.adminOnboardingSampleRepository.findById(id);
    if (!existing) {
      throw new Error('Onboarding sample not found');
    }

    await this.adminOnboardingSampleRepository.activateSample({
      id,
      now: new Date().toISOString(),
      updatedBy: adminId,
    });

    await this._audit(adminId, 'admin_activate_onboarding_sample', 'onboarding_sample', id, {
      label: existing.label,
    });

    return await this.adminOnboardingSampleRepository.findById(id);
  }

  /**
   * Get app config for public consumption (mobile apps)
   * Returns a curated subset of configuration safe for clients
   */
  async getAppConfig() {
    return this.clientConfigService.getClientConfig();
  }

  // ============ FEATURE FLAGS ============

  /**
   * Get all feature flags with metadata for admin UI
   * Returns flags grouped by category with current values and defaults
   */
  async getAllFeatureFlags() {
    const { DEFAULTS, FLAG_METADATA, getFeatureFlags, clearCache } = require('./feature-flags');

    // Clear cache to ensure admin UI always shows current DB values
    clearCache();

    const flagIds = Object.keys(DEFAULTS);
    // Use throwOnError for admin UI - we want to surface DB errors, not hide them
    const currentValues = await getFeatureFlags(this.db, flagIds, { throwOnError: true });

    // Group flags by category
    const byCategory = {};
    for (const flagId of flagIds) {
      const meta = FLAG_METADATA[flagId] || { category: 'other' };
      const category = meta.category || 'other';

      if (!byCategory[category]) {
        byCategory[category] = [];
      }

      // Transform string options to { value, label } format for admin UI
      const transformedMeta = { ...meta };
      if (meta.options && Array.isArray(meta.options)) {
        transformedMeta.options = meta.options.map(opt => 
          typeof opt === 'string' ? { value: opt, label: opt } : opt
        );
      }

      byCategory[category].push({
        id: flagId,
        value: currentValues[flagId],
        defaultValue: DEFAULTS[flagId],
        ...transformedMeta,
      });
    }

    return { flags: byCategory };
  }

  /**
   * Update feature flags
   * @param {Object} updates - Object with flag IDs as keys and new values
   * @param {string} adminId - Admin user ID for audit
   */
  async updateFeatureFlags(updates, adminId) {
    const { DEFAULTS, FLAG_METADATA, setFeatureFlag, clearCache } = require('./feature-flags');

    const validFlagIds = Object.keys(DEFAULTS);
    const results = [];
    const errors = [];

    for (const [flagId, value] of Object.entries(updates)) {
      // Validate flag exists
      if (!validFlagIds.includes(flagId)) {
        errors.push({ flagId, error: `Unknown flag: ${flagId}` });
        continue;
      }

      // Validate value based on metadata
      const meta = FLAG_METADATA[flagId];
      if (meta) {
        if (meta.type === 'number') {
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors.push({ flagId, error: `Value must be a number` });
            continue;
          }
          if (meta.min !== undefined && numValue < meta.min) {
            errors.push({ flagId, error: `Value must be >= ${meta.min}` });
            continue;
          }
          if (meta.max !== undefined && numValue > meta.max) {
            errors.push({ flagId, error: `Value must be <= ${meta.max}` });
            continue;
          }
        } else if (meta.type === 'boolean') {
          if (typeof value !== 'boolean') {
            errors.push({ flagId, error: `Value must be a boolean` });
            continue;
          }
        }
      }

      // Set the flag
      try {
        await setFeatureFlag(this.db, flagId, value, adminId);
        results.push({ flagId, value, success: true });
      } catch (err) {
        errors.push({ flagId, error: err.message });
      }
    }

    // Clear cache to ensure all workers pick up new values
    clearCache();

    // Audit the bulk update
    await this._audit(adminId, 'admin_update_feature_flags', 'feature_flags', 'bulk', {
      updated: results.map(r => r.flagId),
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      success: errors.length === 0,
      updated: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
  async getJobStepHistory(jobId) {
    return await this.adminJobOpsRepository.listJobStepHistory(jobId);
  }
}

module.exports = { AdminService, escapeLikePattern };
