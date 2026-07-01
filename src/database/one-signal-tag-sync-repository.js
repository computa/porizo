"use strict";

const { dbAll } = require("../utils/db-adapter");

function createOneSignalTagSyncRepository(db) {
  async function listUserTagSummaries() {
    const rows = await dbAll(
      db,
      `SELECT u.id,
              COUNT(t.id) as song_count,
              MAX(t.created_at) as last_song_at
         FROM users u
         LEFT JOIN tracks t ON t.user_id = u.id
        GROUP BY u.id`,
    );
    return rows.map((row) => ({
      ...row,
      song_count: Number(row.song_count || 0),
    }));
  }

  return {
    listUserTagSummaries,
  };
}

module.exports = { createOneSignalTagSyncRepository };
