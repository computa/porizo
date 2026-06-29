/**
 * Admin Dashboard Service
 * Provides queries and actions for the admin dashboard.
 */

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
  createAdminGrowthService,
} = require("./admin/growth-service");
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
  createAdminUserReadService,
} = require("./admin/user-read-service");
const {
  createAdminUserMutationService,
} = require("./admin/user-mutation-service");
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
const {
  createAdminWebhookHealthService,
} = require("./admin/webhook-health-service");
const {
  createAdminBillingService,
} = require("./admin/billing-service");
const {
  createAdminSystemHealthService,
} = require("./admin/system-health-service");
const {
  createAdminMetricsService,
} = require("./admin/metrics-service");
const {
  createAdminEntitlementsService,
} = require("./admin/entitlements-service");
const {
  createAdminAnalyticsService,
} = require("./admin/analytics-service");
const { createAdminAuditService } = require("./admin/audit-service");
const { createClientConfigService } = require("./client-config-service");

class AdminService {
  constructor(db, options = {}) {
    this.db = db;
    this.eventsRepository =
      options.eventsRepository || createEventsRepository(db);
    this.adminAuditService =
      options.adminAuditService ||
      createAdminAuditService({
        eventsRepository: this.eventsRepository,
      });
    this.appStoreConnectService =
      options.appStoreConnectService || createAppStoreConnectService();
    this.attributionService = options.attributionService || new AttributionService(db);
    this.attributionRepository =
      options.attributionRepository || createAttributionRepository(db);
    this.adminGrowthService =
      options.adminGrowthService ||
      createAdminGrowthService({
        attributionService: this.attributionService,
        attributionRepository: this.attributionRepository,
        audit: (...args) => this._audit(...args),
      });
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
    this.adminSystemHealthService =
      options.adminSystemHealthService ||
      createAdminSystemHealthService({
        adminJobOpsRepository: this.adminJobOpsRepository,
      });
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
    this.adminBillingService =
      options.adminBillingService ||
      createAdminBillingService({
        adminBillingRepository: this.adminBillingRepository,
      });
    this.adminWebhookHealthService =
      options.adminWebhookHealthService ||
      createAdminWebhookHealthService({
        adminBillingRepository: this.adminBillingRepository,
      });
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
    this.adminUserReadService =
      options.adminUserReadService ||
      createAdminUserReadService({
        adminUserReadRepository: this.adminUserReadRepository,
        attributionService: this.attributionService,
      });
    this.adminUserMutationRepository =
      options.adminUserMutationRepository ||
      createAdminUserMutationRepository(db);
    this.adminUserMutationService =
      options.adminUserMutationService ||
      createAdminUserMutationService({
        adminUserMutationRepository: this.adminUserMutationRepository,
        audit: (...args) => this._audit(...args),
      });
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
    this.adminMetricsService =
      options.adminMetricsService ||
      createAdminMetricsService({
        adminMetricsRepository: this.adminMetricsRepository,
      });
    this.adminEntitlementsRepository =
      options.adminEntitlementsRepository ||
      createAdminEntitlementsRepository(db);
    this.adminEntitlementsService =
      options.adminEntitlementsService ||
      createAdminEntitlementsService({
        adminEntitlementsRepository: this.adminEntitlementsRepository,
        audit: (...args) => this._audit(...args),
      });
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
    this.adminAnalyticsService =
      options.adminAnalyticsService ||
      createAdminAnalyticsService({
        eventsRepository: this.eventsRepository,
      });
  }

  /**
   * Insert an audit log entry (reduces repetitive audit logging code)
   */
  async _audit(adminId, action, resourceType, resourceId, metadata = {}) {
    return this.adminAuditService.audit(
      adminId,
      action,
      resourceType,
      resourceId,
      metadata,
    );
  }

  // ============ USER MANAGEMENT ============

  /**
   * Search users with optional filters
   * Returns user data with adoption metrics (tier, track_count, voice_status, last_active)
   */
  async searchUsers({ email, userId, riskLevel, tier, trackId, shareId, recipientName, limit = 50, offset = 0 }) {
    return this.adminUserReadService.searchUsers({
      email,
      userId,
      riskLevel,
      tier,
      trackId,
      shareId,
      recipientName,
      limit,
      offset,
    });
  }

  /**
   * Get aggregate user statistics for summary banner
   * Returns counts by tier and conversion rate
   */
  async getUserStats() {
    return this.adminUserReadService.getUserStats();
  }

  /**
   * Get detailed user information with related data
   */
  async getUserDetail(userId) {
    return this.adminUserReadService.getUserDetail(userId);
  }

  async getAttributionHealth() {
    return this.adminGrowthService.getAttributionHealth();
  }

  /**
   * Update user risk level
   */
  async updateUserRisk(userId, riskLevel, adminId, reason) {
    return this.adminUserMutationService.updateUserRisk(
      userId,
      riskLevel,
      adminId,
      reason,
    );
  }

  /**
   * Lock or unlock a user account
   */
  async lockUser(userId, locked, adminId, reason) {
    return this.adminUserMutationService.lockUser(
      userId,
      locked,
      adminId,
      reason,
    );
  }

  /**
   * Permanently delete a user and all associated data.
   * All child tables use ON DELETE CASCADE, so a single DELETE suffices.
   */
  async deleteUser(userId, adminId, reason) {
    return this.adminUserMutationService.deleteUser(userId, adminId, reason);
  }

  /**
   * Bulk action on multiple users (delete, lock, unlock)
   */
  async bulkUserAction(userIds, action, adminId, reason) {
    return this.adminUserMutationService.bulkUserAction(
      userIds,
      action,
      adminId,
      reason,
    );
  }

  /**
   * Update user profile and attribution override fields.
   */
  async updateUserProfile(userId, fields, adminId) {
    return this.adminUserMutationService.updateUserProfile(
      userId,
      fields,
      adminId,
    );
  }

  /**
   * Update user entitlements (tier)
   */
  async updateUserEntitlements(userId, fields, adminId) {
    return this.adminEntitlementsService.updateUserEntitlements(
      userId,
      fields,
      adminId,
    );
  }

  // ============ METRICS ============

  /**
   * Get overview dashboard metrics
   */
  async getOverviewMetrics() {
    return this.adminMetricsService.getOverviewMetrics();
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
    return this.adminMetricsService.getCostMetrics(days);
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
    return this.adminSystemHealthService.getSystemHealth();
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
    return this.adminBillingService.getRevenueMetrics(days);
  }

  /**
   * Get receipt-backed Apple sales and current subscriber visibility.
   */
  async getBillingSales({ days = 30, limit = 50, offset = 0 } = {}) {
    return this.adminBillingService.getBillingSales({ days, limit, offset });
  }

  /**
   * Get subscription health metrics
   */
  async getSubscriptionHealth() {
    return this.adminBillingService.getSubscriptionHealth();
  }

  /**
   * Get recent billing transactions
   */
  async getBillingTransactions({ limit = 50, offset = 0 } = {}) {
    return this.adminBillingService.getBillingTransactions({ limit, offset });
  }

  /**
   * Get webhook health metrics
   */
  async getWebhookHealth() {
    return this.adminWebhookHealthService.getWebhookHealth();
  }

  // ============ GROWTH & ATTRIBUTION ============

  /**
   * Get UTM attribution breakdown
   * @param {number} days - Number of days to look back
   */
  async getAttribution(days = 30) {
    return this.adminGrowthService.getAttribution(days);
  }

  async getAppleAdsKeywordMap({ limit = 500, offset = 0 } = {}) {
    return this.adminGrowthService.getAppleAdsKeywordMap({ limit, offset });
  }

  async upsertAppleAdsKeywordMap(rows, adminId = "system") {
    return this.adminGrowthService.upsertAppleAdsKeywordMap(rows, adminId);
  }

  /**
   * Get teaser funnel metrics (views → clicks → conversions)
   * @param {number} days - Number of days to look back
   */
  async getTeaserMetrics(days = 7) {
    return this.adminMetricsService.getTeaserMetrics(days);
  }

  /**
   * Get share performance metrics
   * @param {number} days - Number of days to look back
   */
  async getShareMetrics(days = 30) {
    return this.adminMetricsService.getShareMetrics(days);
  }

  // ============ FUNNEL ANALYTICS ============

  /**
   * Event counts grouped by name for the selected window.
   * Cached 60s per days value.
   */
  async getAnalyticsOverview(days) {
    return this.adminAnalyticsService.getAnalyticsOverview(days);
  }

  /**
   * Daily series for a single event name. Cached 60s per (eventName, days).
   */
  async getAnalyticsDaily(eventName, days) {
    return this.adminAnalyticsService.getAnalyticsDaily(eventName, days);
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
    return this.adminAnalyticsService.getFunnelCohort(days);
  }

  /**
   * Per-user event timeline for support investigations.
   * Writes an audit_logs row on every successful call — admin reads of user
   * behavioral data must be traceable.
   */
  async getUserAnalytics(adminId, adminEmail, userId, limit) {
    return this.adminAnalyticsService.getUserAnalytics(
      adminId,
      adminEmail,
      userId,
      limit,
    );
  }

  // ============ ENROLLMENT METRICS ============

  /**
   * Get voice enrollment metrics
   */
  async getEnrollmentMetrics() {
    return this.adminMetricsService.getEnrollmentMetrics();
  }

  // ============ RENDER PIPELINE METRICS ============

  /**
   * Get render pipeline success metrics
   */
  async getRenderSuccessMetrics() {
    return this.adminMetricsService.getRenderSuccessMetrics();
  }

  // ============ RISK METRICS ============

  /**
   * Get user risk distribution metrics
   */
  async getRiskMetrics() {
    return this.adminMetricsService.getRiskMetrics();
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

  /**
   * Get app config for public consumption (mobile apps)
   * Returns a curated subset of configuration safe for clients
   */
  async getAppConfig() {
    return this.clientConfigService.getClientConfig();
  }

}

module.exports = { AdminService, escapeLikePattern };
