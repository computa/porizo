"use strict";

function createAdminUserMutationRepository(db) {
  const attributionColumns = `
    acquisition_source, acquisition_medium, acquisition_campaign,
    acquisition_content, acquisition_term, acquisition_country,
    acquisition_referrer, acquisition_at
  `;

  return {
    updateRiskLevel(userId, riskLevel) {
      return db
        .prepare("UPDATE users SET risk_level = ? WHERE id = ?")
        .run(riskLevel, userId);
    },

    updateLockedUntil(userId, lockedUntil) {
      return db
        .prepare("UPDATE users SET locked_until = ? WHERE id = ?")
        .run(lockedUntil, userId);
    },

    findDeletionSnapshot(userId) {
      return db
        .prepare("SELECT id, email, display_name FROM users WHERE id = ?")
        .get(userId);
    },

    deleteUser(userId) {
      return db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    },

    getAttributionSnapshot(userId) {
      return db
        .prepare(
          `SELECT ${attributionColumns}
           FROM users
           WHERE id = ?`,
        )
        .get(userId);
    },

    updateUserFields(userId, updates) {
      const setClauses = [];
      const params = [];
      for (const [key, value] of Object.entries(updates)) {
        if (!/^[a-z_]+$/.test(key)) {
          throw new Error(`Unsafe column name: ${key}`);
        }
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
      params.push(userId);

      return db
        .prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`)
        .run(...params);
    },
  };
}

module.exports = {
  createAdminUserMutationRepository,
};
