"use strict";

const SQL_CHECK_ARTWORK_READY = `
  SELECT artwork_ready FROM track_versions WHERE id = ?
`;

const SQL_NOTIFY_ARTWORK_READY = "SELECT pg_notify('artwork_ready', ?) AS notified";

function rowIsTrue(value) {
  // PG returns boolean true; SQLite returns integer 1; some shims return strings.
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function createArtworkBarrierRepository(db) {
  async function isArtworkReady(trackVersionId) {
    const row = await db.prepare(SQL_CHECK_ARTWORK_READY).get(trackVersionId);
    return !!(row && rowIsTrue(row.artwork_ready));
  }

  async function notifyArtworkReady(trackVersionId) {
    return db
      .prepare(SQL_NOTIFY_ARTWORK_READY)
      .get(String(trackVersionId));
  }

  return {
    isArtworkReady,
    notifyArtworkReady,
  };
}

module.exports = {
  createArtworkBarrierRepository,
  SQL_CHECK_ARTWORK_READY,
  SQL_NOTIFY_ARTWORK_READY,
  rowIsTrue,
};
