"use strict";

const { safeBounds } = require("./pagination");

function createAdminUserReadService({
  adminUserReadRepository,
  attributionService,
}) {
  if (!adminUserReadRepository) {
    throw new Error("adminUserReadRepository is required");
  }
  if (!attributionService) {
    throw new Error("attributionService is required");
  }

  async function searchUsers({
    email,
    userId,
    riskLevel,
    tier,
    trackId,
    shareId,
    recipientName,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    const { users, total } = await adminUserReadRepository.searchUsers({
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
      users: await attributionService.attachAttributionToUsers(users),
      total,
      limit: bounds.limit,
      offset: bounds.offset,
    };
  }

  async function getUserStats() {
    const stats = await adminUserReadRepository.getUserStats();
    return {
      ...stats,
      conversionRate:
        stats.totalUsers > 0
          ? ((stats.paidUsers / stats.totalUsers) * 100).toFixed(1)
          : "0.0",
    };
  }

  async function getUserDetail(userId) {
    const user = await adminUserReadRepository.getUserById(userId);

    if (!user) return null;

    const [
      voiceProfile,
      entitlements,
      subscription,
      tracks,
      shares,
      attribution,
      appleAdsAttribution,
      canonicalAttribution,
    ] = await Promise.all([
      adminUserReadRepository.getUserVoiceProfile(userId),
      adminUserReadRepository.getUserEntitlements(userId),
      adminUserReadRepository.getLatestUserSubscription(userId),
      adminUserReadRepository.listUserTracks(userId),
      adminUserReadRepository.listUserShares(userId),
      adminUserReadRepository.getLatestUserDownloadAttribution(userId),
      adminUserReadRepository.getLatestResolvedAppleAdsAttribution(userId),
      attributionService.getUserAttribution(user),
    ]);

    Object.assign(user, canonicalAttribution);

    return {
      user,
      voiceProfile,
      entitlements,
      subscription,
      tracks,
      shares,
      attribution,
      appleAdsAttribution,
    };
  }

  return {
    searchUsers,
    getUserStats,
    getUserDetail,
  };
}

module.exports = {
  createAdminUserReadService,
};
