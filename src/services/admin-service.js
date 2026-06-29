/**
 * Admin Dashboard Service
 * Provides queries and actions for the admin dashboard.
 */

const crypto = require("crypto");
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
  createAdminProviderConfigService,
} = require("./admin/provider-config-service");
const {
  createAdminControlPlaneService,
} = require("./admin/control-plane-service");
const {
  createAdminModerationService,
} = require("./admin/moderation-service");
const {
  createAdminStorySessionService,
} = require("./admin/story-session-service");
const { createAdminJobOpsService } = require("./admin/job-ops-service");
const {
  createAdminShareManagementService,
} = require("./admin/share-management-service");
const {
  createAdminFeatureFlagService,
} = require("./admin/feature-flag-service");
const {
  createAdminOnboardingSampleService,
} = require("./admin/onboarding-sample-service");
const {
  createAdminUserSessionControlService,
} = require("./admin/user-session-control-service");
const {
  createAdminSecurityConfigService,
} = require("./admin/security-config-service");
const {
  createAdminSecurityObservabilityService,
  escapeLikePattern,
} = require("./admin/security-observability-service");
const {
  createAdminMusicDiagnosticsService,
} = require("./admin/music-diagnostics-service");
const { safeBounds } = require("./admin/pagination");
const { createClientConfigService } = require("./client-config-service");

/**
 * Generate a secure audit log ID
 */
function generateAuditId() {
  return `audit_${crypto.randomBytes(12).toString("hex")}`;
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
    this.adminProviderConfigService =
      options.adminProviderConfigService ||
      createAdminProviderConfigService({
        appConfigRepository: this.appConfigRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminFeatureFlagService =
      options.adminFeatureFlagService ||
      createAdminFeatureFlagService({
        db: this.db,
        audit: (...args) => this._audit(...args),
      });
    this.adminSecurityConfigService =
      options.adminSecurityConfigService ||
      createAdminSecurityConfigService({
        appConfigRepository: this.appConfigRepository,
        appStoreConnectService: this.appStoreConnectService,
        audit: (...args) => this._audit(...args),
      });
    this.clientConfigService =
      options.clientConfigService ||
      createClientConfigService({
        appConfigRepository: this.appConfigRepository,
        db: this.db,
        getMusicProviderConfig: () => this.getMusicProviderConfig(),
        getSTTConfig: () => this.getSTTConfig(),
        resolveIOSAppUpdatePolicy: () =>
          this.adminSecurityConfigService.resolveIOSAppUpdatePolicy(),
      });
    this.adminControlRepository =
      options.adminControlRepository || createAdminControlRepository(db);
    this.adminControlPlaneService =
      options.adminControlPlaneService ||
      createAdminControlPlaneService({
        adminControlRepository: this.adminControlRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminOnboardingSampleRepository =
      options.adminOnboardingSampleRepository ||
      createAdminOnboardingSampleRepository(db);
    this.adminOnboardingSampleService =
      options.adminOnboardingSampleService ||
      createAdminOnboardingSampleService({
        onboardingSampleRepository: this.adminOnboardingSampleRepository,
        appConfigRepository: this.appConfigRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminJobOpsRepository =
      options.adminJobOpsRepository || createAdminJobOpsRepository(db);
    this.adminJobOpsService =
      options.adminJobOpsService ||
      createAdminJobOpsService({
        adminJobOpsRepository: this.adminJobOpsRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminStorySessionRepository =
      options.adminStorySessionRepository ||
      createAdminStorySessionRepository(db);
    this.adminStorySessionService =
      options.adminStorySessionService ||
      createAdminStorySessionService({
        adminStorySessionRepository: this.adminStorySessionRepository,
      });
    this.adminModerationRepository =
      options.adminModerationRepository || createAdminModerationRepository(db);
    this.adminModerationService =
      options.adminModerationService ||
      createAdminModerationService({
        adminModerationRepository: this.adminModerationRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminBillingRepository =
      options.adminBillingRepository || createAdminBillingRepository(db);
    this.adminShareManagementRepository =
      options.adminShareManagementRepository ||
      createAdminShareManagementRepository(db);
    this.adminShareManagementService =
      options.adminShareManagementService ||
      createAdminShareManagementService({
        adminShareManagementRepository: this.adminShareManagementRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminUserReadRepository =
      options.adminUserReadRepository || createAdminUserReadRepository(db);
    this.adminUserMutationRepository =
      options.adminUserMutationRepository ||
      createAdminUserMutationRepository(db);
    this.adminUserSessionControlRepository =
      options.adminUserSessionControlRepository ||
      createAdminUserSessionControlRepository(db);
    this.adminUserSessionControlService =
      options.adminUserSessionControlService ||
      createAdminUserSessionControlService({
        adminUserSessionControlRepository:
          this.adminUserSessionControlRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminMetricsRepository =
      options.adminMetricsRepository || createAdminMetricsRepository(db);
    this.adminEntitlementsRepository =
      options.adminEntitlementsRepository ||
      createAdminEntitlementsRepository(db);
    this.adminSecurityObservabilityRepository =
      options.adminSecurityObservabilityRepository ||
      createAdminSecurityObservabilityRepository(db);
    this.adminSecurityObservabilityService =
      options.adminSecurityObservabilityService ||
      createAdminSecurityObservabilityService({
        adminSecurityObservabilityRepository:
          this.adminSecurityObservabilityRepository,
        audit: (...args) => this._audit(...args),
      });
    this.adminMusicDiagnosticsRepository =
      options.adminMusicDiagnosticsRepository ||
      createAdminMusicDiagnosticsRepository(db);
    this.adminMusicDiagnosticsService =
      options.adminMusicDiagnosticsService ||
      createAdminMusicDiagnosticsService({
        adminMusicDiagnosticsRepository: this.adminMusicDiagnosticsRepository,
      });
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
    return this.adminStorySessionService.listStorySessions({
      status,
      engineVersion,
      limit,
      offset,
    });
  }

  /**
   * Get full story session details with turns
   */
  async getStorySessionDetail(sessionId) {
    return this.adminStorySessionService.getStorySessionDetail(sessionId);
  }

  /**
   * Get job health metrics
   */
  async getJobMetrics() {
    return await this.adminJobOpsService.getJobMetrics();
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
    return await this.adminJobOpsService.listJobs({
      status,
      workflowType,
      limit,
      offset,
    });
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId, adminId) {
    return await this.adminJobOpsService.retryJob(jobId, adminId);
  }

  /**
   * List dead letter queue entries
   * Note: DLQ not implemented in current schema, returns empty array
   */
  async listDLQ({ limit = 50, offset = 0 }) {
    return await this.adminJobOpsService.listDLQ({ limit, offset });
  }

  /**
   * Reprocess a DLQ entry by re-queuing the original job
   */
  async reprocessDLQ(dlqId, adminId, reason) {
    return await this.adminJobOpsService.reprocessDLQ(
      dlqId,
      adminId,
      reason,
    );
  }

  /**
   * Get job step history for admin inspection
   */
  async getJobStepHistory(jobId) {
    return await this.adminJobOpsService.getJobStepHistory(jobId);
  }

  // ============ MODERATION ============

  /**
   * Get moderation queue (blocked content)
   */
  async getModerationQueue({ limit = 50, offset = 0 }) {
    return await this.adminModerationService.getModerationQueue({
      limit,
      offset,
    });
  }

  /**
   * Override moderation decision (approve blocked content)
   */
  async overrideModeration(versionId, adminId, reason) {
    return await this.adminModerationService.overrideModeration(
      versionId,
      adminId,
      reason,
    );
  }

  // ============ SHARE MANAGEMENT ============

  /**
   * List share tokens with optional filters
   */
  async listShares({ status, trackId, userId, limit = 50, offset = 0 }) {
    return await this.adminShareManagementService.listShares({
      status,
      trackId,
      userId,
      limit,
      offset,
    });
  }

  /**
   * Rebind a share token to a new device
   */
  async rebindShare(shareId, newDeviceId, adminId, reason) {
    return await this.adminShareManagementService.rebindShare(
      shareId,
      newDeviceId,
      adminId,
      reason,
    );
  }

  // ============ POEM SHARE MANAGEMENT ============

  /**
   * List poem share tokens with optional filters
   */
  async listPoemShares({ status, poemId, userId, limit = 50, offset = 0 }) {
    return await this.adminShareManagementService.listPoemShares({
      status,
      poemId,
      userId,
      limit,
      offset,
    });
  }

  /**
   * Reset claim attempts on a poem share token (unlocks a locked-out recipient)
   */
  async resetPoemShareAttempts(shareId, adminId, reason) {
    return await this.adminShareManagementService.resetPoemShareAttempts(
      shareId,
      adminId,
      reason,
    );
  }

  /**
   * Revoke a poem share token
   */
  async revokePoemShare(shareId, adminId, reason) {
    return await this.adminShareManagementService.revokePoemShare(
      shareId,
      adminId,
      reason,
    );
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
    return await this.adminSecurityObservabilityService.searchAuthEvents({
      eventType,
      userId,
      startDate,
      endDate,
      limit,
      offset,
    });
  }

  /**
   * Get auth event statistics (last 24h)
   */
  async getAuthEventStats() {
    return await this.adminSecurityObservabilityService.getAuthEventStats();
  }

  /**
   * Get Apple refresh-token audit stats (validation + failures)
   */
  async getAppleRefreshTokenStats(days = 7) {
    return await this.adminSecurityObservabilityService.getAppleRefreshTokenStats(
      days,
    );
  }

  /**
   * Search admin action audit logs
   */
  async searchAuditLogs({ action, resourceType, startDate, endDate, limit = 50, offset = 0 }) {
    return await this.adminSecurityObservabilityService.searchAuditLogs({
      action,
      resourceType,
      startDate,
      endDate,
      limit,
      offset,
    });
  }

  /**
   * Get rate limits with optional filters
   */
  async getRateLimits({ userId, actionType, nearLimit = false, limit = 50, offset = 0 }) {
    return await this.adminSecurityObservabilityService.getRateLimits({
      userId,
      actionType,
      nearLimit,
      limit,
      offset,
    });
  }

  /**
   * Reset a user's rate limit for specific action
   */
  async resetUserRateLimit(userId, actionType, adminId, reason) {
    return await this.adminSecurityObservabilityService.resetUserRateLimit(
      userId,
      actionType,
      adminId,
      reason,
    );
  }

  /**
   * Get voice profile consent logs
   */
  async getConsentLogs({ consentVersion, startDate, endDate, limit = 50, offset = 0 }) {
    return await this.adminSecurityObservabilityService.getConsentLogs({
      consentVersion,
      startDate,
      endDate,
      limit,
      offset,
    });
  }

  /**
   * Get security configuration
   */
  async getSecurityConfig() {
    return await this.adminSecurityConfigService.getSecurityConfig();
  }

  /**
   * Update security configuration
   */
  async updateSecurityConfig(config, adminId) {
    return await this.adminSecurityConfigService.updateSecurityConfig(
      config,
      adminId,
    );
  }

  async syncIOSVersionFromAppStore(adminId, { force = true } = {}) {
    return await this.adminSecurityConfigService.syncIOSVersionFromAppStore(
      adminId,
      { force },
    );
  }

  async resolveIOSAppUpdatePolicy({
    allowLiveAppStoreSync = false,
    exposeSyncError = false,
  } = {}) {
    return await this.adminSecurityConfigService.resolveIOSAppUpdatePolicy({
      allowLiveAppStoreSync,
      exposeSyncError,
    });
  }

  // ============ VOICE PROFILE MANAGEMENT ============

  /**
   * Force a user's voice profile to require re-verification
   */
  async forceVoiceReverify(userId, adminId, reason) {
    return await this.adminUserSessionControlService.forceVoiceReverify(
      userId,
      adminId,
      reason,
    );
  }

  // ============ USER SESSION MANAGEMENT ============

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId, limit = 20) {
    return await this.adminUserSessionControlService.getUserSessions(
      userId,
      limit,
    );
  }

  /**
   * Revoke a specific user session
   */
  async revokeUserSession(userId, sessionId, adminId, reason) {
    return await this.adminUserSessionControlService.revokeUserSession(
      userId,
      sessionId,
      adminId,
      reason,
    );
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId, adminId, reason) {
    return await this.adminUserSessionControlService.revokeAllUserSessions(
      userId,
      adminId,
      reason,
    );
  }

  // ============ PROVIDER CONTROL PLANE ============

  /**
   * Get status of all external providers
   */
  async getProviderStatus() {
    return await this.adminControlPlaneService.getProviderStatus();
  }

  /**
   * Set provider status (active, paused, disabled)
   */
  async setProviderStatus(providerName, status, adminId, reason) {
    return await this.adminControlPlaneService.setProviderStatus(
      providerName,
      status,
      adminId,
      reason,
    );
  }

  // ============ QUEUE CONTROL PLANE ============

  /**
   * Get status of all job queues
   */
  async getQueueStatus() {
    return await this.adminControlPlaneService.getQueueStatus();
  }

  /**
   * Set queue status (active, paused, draining)
   */
  async setQueueStatus(queueName, status, adminId, reason) {
    return await this.adminControlPlaneService.setQueueStatus(
      queueName,
      status,
      adminId,
      reason,
    );
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
    return this.adminProviderConfigService.getSTTConfig();
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
    return this.adminProviderConfigService.setSTTConfig(config, adminId);
  }

  /**
   * Get music provider routing configuration
   * Controls runtime default provider and auto style routing behavior.
   */
  async getMusicProviderConfig() {
    return this.adminProviderConfigService.getMusicProviderConfig();
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
    return this.adminProviderConfigService.setMusicProviderConfig(
      config,
      adminId,
    );
  }

  /**
   * Diagnostics feed for recent music generations (success + failure).
   * Includes provider routing, style intent summary, and quality gate results.
   */
  async getRecentMusicDiagnostics({ limit = 30, provider = null, status = null }) {
    return await this.adminMusicDiagnosticsService.getRecentMusicDiagnostics({
      limit,
      provider,
      status,
    });
  }

  // ============ ONBOARDING SAMPLES ============

  /**
   * List all onboarding audio samples
   */
  async getOnboardingSamples() {
    return await this.adminOnboardingSampleService.getOnboardingSamples();
  }

  /**
   * Get the currently active onboarding sample (for app config)
   * Returns null if none active
   */
  async getActiveOnboardingSample() {
    return await this.adminOnboardingSampleService.getActiveOnboardingSample();
  }

  /**
   * Create a new onboarding audio sample
   */
  async createOnboardingSample({ label, audio_url }, adminId) {
    return await this.adminOnboardingSampleService.createOnboardingSample(
      { label, audio_url },
      adminId,
    );
  }

  /**
   * Update an onboarding sample (allowlisted fields only)
   */
  async updateOnboardingSample(id, fields, adminId) {
    return await this.adminOnboardingSampleService.updateOnboardingSample(
      id,
      fields,
      adminId,
    );
  }

  /**
   * Delete an onboarding sample
   */
  async deleteOnboardingSample(id, adminId) {
    return await this.adminOnboardingSampleService.deleteOnboardingSample(
      id,
      adminId,
    );
  }

  /**
   * Activate a single onboarding sample (transactional: deactivate all, then activate one)
   */
  async activateOnboardingSample(id, adminId) {
    return await this.adminOnboardingSampleService.activateOnboardingSample(
      id,
      adminId,
    );
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
    return this.adminFeatureFlagService.getAllFeatureFlags();
  }

  /**
   * Update feature flags
   * @param {Object} updates - Object with flag IDs as keys and new values
   * @param {string} adminId - Admin user ID for audit
   */
  async updateFeatureFlags(updates, adminId) {
    return this.adminFeatureFlagService.updateFeatureFlags(updates, adminId);
  }
}

module.exports = { AdminService, escapeLikePattern };
