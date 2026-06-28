"use strict";

function createPoemLibraryRepository(db) {
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
           AND NOT (COALESCE(p.funding_source, 'standard') = 'gift_token' AND ple.origin = 'created')
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
         AND NOT (COALESCE(p.funding_source, 'standard') = 'gift_token' AND ple.origin = 'created')`,
      )
      .get(userId, userId, userId, poemId);
  }

  return {
    upsertPoemLibraryEntry,
    listPoemsForUser,
    removePoemFromLibrary,
    getActivePoemLibraryEntry,
    getPoemForLibrary,
  };
}

module.exports = { createPoemLibraryRepository };
