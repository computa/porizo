"use strict";

function createFeatureFlagsRepository(db) {
  async function findValueById(flagId) {
    return db
      .prepare("SELECT value FROM feature_flags WHERE id = ?")
      .get(flagId);
  }

  async function findValuesByIds(flagIds) {
    if (!Array.isArray(flagIds) || flagIds.length === 0) {
      return [];
    }

    const placeholders = flagIds.map(() => "?").join(",");
    const statement = db.prepare(
      `SELECT id, value FROM feature_flags WHERE id IN (${placeholders})`,
    );

    if (typeof statement.all !== "function") {
      return null;
    }

    return statement.all(...flagIds);
  }

  async function upsertValue({ flagId, value, updatedAt, updatedBy }) {
    return db
      .prepare(
        `INSERT INTO feature_flags (id, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      )
      .run(flagId, value, updatedAt, updatedBy);
  }

  return {
    findValueById,
    findValuesByIds,
    upsertValue,
  };
}

module.exports = {
  createFeatureFlagsRepository,
};
