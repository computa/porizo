"use strict";

function createAdminEntitlementsRepository(db) {
  return {
    async upsertTier(userId, tier, nowIso) {
      const current = await db
        .prepare("SELECT tier FROM entitlements WHERE user_id = ?")
        .get(userId);

      if (current) {
        await db
          .prepare("UPDATE entitlements SET tier = ? WHERE user_id = ?")
          .run(tier, userId);
      } else {
        await db
          .prepare(
            "INSERT INTO entitlements (user_id, tier, updated_at) VALUES (?, ?, ?)",
          )
          .run(userId, tier, nowIso);
      }

      return current || null;
    },
  };
}

module.exports = {
  createAdminEntitlementsRepository,
};
