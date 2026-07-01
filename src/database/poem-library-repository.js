"use strict";

function createPoemLibraryRepository(db) {
  async function createPoem({
    id,
    userId,
    title,
    recipientName,
    occasion,
    tone,
    versesJson,
    message,
    status,
    createdAt,
    updatedAt,
  }) {
    return db
      .prepare(
        `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        title,
        recipientName,
        occasion,
        tone,
        versesJson,
        message,
        status,
        createdAt,
        updatedAt,
      );
  }

  async function getPoemById(poemId) {
    return db.prepare("SELECT * FROM poems WHERE id = ?").get(poemId);
  }

  async function getLivePoemById(poemId) {
    return db
      .prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL")
      .get(poemId);
  }

  async function getOwnedGiftTokenPoemForLibrary({ userId, poemId }) {
    return db
      .prepare(
        `SELECT p.*,
              NULL AS library_origin,
              NULL AS library_added_at,
              NULL AS library_share_token_id,
              1 AS can_edit,
              1 AS can_share,
              1 AS can_delete
       FROM poems p
       WHERE p.id = ?
         AND p.user_id = ?
         AND p.deleted_at IS NULL
         AND COALESCE(p.funding_source, 'standard') IN ('gift_wallet', 'gift_token')`,
      )
      .get(poemId, userId);
  }

  async function updatePoem({
    poemId,
    title,
    recipientName,
    occasion,
    tone,
    message,
    versesJson,
    status,
    updatedAt,
  }) {
    return db
      .prepare(
        `UPDATE poems
         SET title = ?,
             recipient_name = ?,
             occasion = ?,
             tone = ?,
             message = ?,
             verses = ?,
             status = ?,
             updated_at = ?
       WHERE id = ?`,
      )
      .run(
        title,
        recipientName,
        occasion,
        tone,
        message,
        versesJson,
        status,
        updatedAt,
        poemId,
      );
  }

  async function getPoemCreditBalance(userId) {
    return db
      .prepare("SELECT poems_remaining FROM entitlements WHERE user_id = ?")
      .get(userId);
  }

  async function markPoemGenerated({ poemId, versesJson, updatedAt }) {
    return db
      .prepare(
        "UPDATE poems SET verses = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(versesJson, "generated", updatedAt, poemId);
  }

  async function markPoemGenerationFailed(poemId) {
    return db
      .prepare("UPDATE poems SET status = 'generation_failed' WHERE id = ?")
      .run(poemId);
  }

  async function updatePoemOgVariant({ poemId, variant, updatedAt }) {
    return db
      .prepare("UPDATE poems SET og_variant = ?, updated_at = ? WHERE id = ?")
      .run(variant, updatedAt, poemId);
  }

  async function getGiftOrderContentSnapshot(giftOrderId) {
    return db
      .prepare("SELECT content_snapshot_json FROM gift_orders WHERE id = ?")
      .get(giftOrderId);
  }

  async function getUserPresence(userId) {
    return db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  }

  async function markPoemAudioGenerated({ poemId, generatedAt }) {
    try {
      return await db
        .prepare(
          "UPDATE poems SET audio_generated_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(generatedAt, generatedAt, poemId);
    } catch (err) {
      if (
        String(err?.message || "").includes(
          "no such column: audio_generated_at",
        )
      ) {
        return db
          .prepare("UPDATE poems SET updated_at = ? WHERE id = ?")
          .run(generatedAt, poemId);
      }
      throw err;
    }
  }

  async function upsertPoemLibraryEntry({
    userId,
    poemId,
    origin,
    shareTokenId = null,
    addedAt = new Date().toISOString(),
  }) {
    const now = new Date().toISOString();
    const updateResult = await db
      .prepare(
        `UPDATE poem_library_entries
       SET origin = CASE WHEN origin = 'created' THEN origin ELSE ? END,
           share_token_id = COALESCE(?, share_token_id),
           added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END,
           removed_at = NULL, updated_at = ?
       WHERE user_id = ? AND poem_id = ?`,
      )
      .run(origin, shareTokenId, addedAt, now, userId, poemId);

    if (updateResult.changes > 0) {
      return;
    }

    await db
      .prepare(
        `INSERT INTO poem_library_entries
       (user_id, poem_id, origin, share_token_id, added_at, removed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(userId, poemId, origin, shareTokenId, addedAt, now);
  }

  async function listPoemsForUser(userId) {
    return db
      .prepare(
        `SELECT p.*,
                ple.origin AS library_origin,
                ple.added_at AS library_added_at,
                ple.share_token_id AS library_share_token_id,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_edit,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_share,
                1 AS can_delete
         FROM poems p
         JOIN poem_library_entries ple
           ON ple.poem_id = p.id
          AND ple.user_id = ?
          AND ple.removed_at IS NULL
         WHERE p.deleted_at IS NULL
           AND NOT (COALESCE(p.funding_source, 'standard') IN ('gift_wallet', 'gift_token') AND ple.origin = 'created')
         ORDER BY ple.added_at DESC`,
      )
      .all(userId, userId, userId);
  }

  async function removePoemFromLibrary({
    userId,
    poemId,
    removedAt,
  }) {
    await db
      .prepare(
        "UPDATE poem_library_entries SET removed_at = ?, updated_at = ? WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL",
      )
      .run(removedAt, removedAt, userId, poemId);
  }

  async function getActivePoemLibraryEntry({ userId, poemId }) {
    return db
      .prepare(
        "SELECT 1 FROM poem_library_entries WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL",
      )
      .get(userId, poemId);
  }

  async function getPoemForLibrary({ userId, poemId }) {
    return db
      .prepare(
        `SELECT p.*,
              ple.origin AS library_origin,
              ple.added_at AS library_added_at,
              ple.share_token_id AS library_share_token_id,
              CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_edit,
              CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_share,
              1 AS can_delete
       FROM poems p
       JOIN poem_library_entries ple
         ON ple.poem_id = p.id
        AND ple.user_id = ?
        AND ple.removed_at IS NULL
       WHERE p.id = ?
         AND p.deleted_at IS NULL
         AND NOT (COALESCE(p.funding_source, 'standard') IN ('gift_wallet', 'gift_token') AND ple.origin = 'created')`,
      )
      .get(userId, userId, userId, poemId);
  }

  return {
    createPoem,
    getPoemById,
    getLivePoemById,
    getOwnedGiftTokenPoemForLibrary,
    updatePoem,
    getPoemCreditBalance,
    markPoemGenerated,
    markPoemGenerationFailed,
    updatePoemOgVariant,
    getGiftOrderContentSnapshot,
    getUserPresence,
    markPoemAudioGenerated,
    upsertPoemLibraryEntry,
    listPoemsForUser,
    removePoemFromLibrary,
    getActivePoemLibraryEntry,
    getPoemForLibrary,
  };
}

module.exports = { createPoemLibraryRepository };
