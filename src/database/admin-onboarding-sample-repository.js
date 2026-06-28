"use strict";

const ALLOWED_UPDATE_COLUMNS = new Set(["label", "audio_url"]);

function createAdminOnboardingSampleRepository(db) {
  async function listAll() {
    return db
      .prepare("SELECT * FROM onboarding_samples ORDER BY created_at ASC")
      .all();
  }

  async function findById(id) {
    return db.prepare("SELECT * FROM onboarding_samples WHERE id = ?").get(id);
  }

  async function createSample({ id, label, audioUrl, now, updatedBy }) {
    return db
      .prepare(
        `INSERT INTO onboarding_samples (
          id,
          label,
          audio_url,
          is_active,
          created_at,
          updated_at,
          updated_by
        )
        VALUES (?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, label, audioUrl, now, now, updatedBy);
  }

  async function updateSample({ id, fields, now, updatedBy }) {
    const entries = Object.entries(fields || {});
    if (entries.length === 0) {
      throw new Error("No valid fields to update");
    }

    const setClauses = [];
    const params = [];
    for (const [key, value] of entries) {
      if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
        throw new Error(`Unsafe column name: ${key}`);
      }
      setClauses.push(`${key} = ?`);
      params.push(value);
    }

    setClauses.push("updated_at = ?");
    params.push(now);
    setClauses.push("updated_by = ?");
    params.push(updatedBy);
    params.push(id);

    return db
      .prepare(
        `UPDATE onboarding_samples SET ${setClauses.join(", ")} WHERE id = ?`,
      )
      .run(...params);
  }

  async function deleteSample(id) {
    return db.prepare("DELETE FROM onboarding_samples WHERE id = ?").run(id);
  }

  async function activateSample({ id, now, updatedBy }) {
    return db.transaction(async (query) => {
      const existingResult = await query(
        "SELECT id FROM onboarding_samples WHERE id = ?",
        [id],
      );
      const existingRows = existingResult.rows || existingResult;
      if (!existingRows[0]) {
        throw new Error("Onboarding sample not found");
      }

      await query(
        "UPDATE onboarding_samples SET is_active = 0, updated_at = ?, updated_by = ?",
        [now, updatedBy],
      );
      await query(
        "UPDATE onboarding_samples SET is_active = 1, updated_at = ?, updated_by = ? WHERE id = ?",
        [now, updatedBy, id],
      );
    });
  }

  return {
    listAll,
    findById,
    createSample,
    updateSample,
    deleteSample,
    activateSample,
  };
}

module.exports = {
  createAdminOnboardingSampleRepository,
};
