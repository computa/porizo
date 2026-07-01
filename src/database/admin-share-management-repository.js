"use strict";

function createAdminShareManagementRepository(db) {
  async function listShares({ status, trackId, userId, limit, offset }) {
    let sql = `
      SELECT
        st.id,
        st.track_id,
        st.status,
        st.access_count,
        st.bound_device_id,
        st.stream_key,
        st.created_at,
        st.expires_at,
        t.title as track_title
      FROM share_tokens st
      JOIN tracks t ON st.track_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += " AND st.status = ?";
      params.push(status);
    }
    if (trackId) {
      sql += " AND st.track_id = ?";
      params.push(trackId);
    }
    if (userId) {
      sql += " AND t.user_id = ?";
      params.push(userId);
    }

    sql += " ORDER BY st.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function getShareById(shareId) {
    return db.prepare("SELECT * FROM share_tokens WHERE id = ?").get(shareId);
  }

  async function rebindShareDevice({ shareId, newDeviceId }) {
    return db
      .prepare("UPDATE share_tokens SET bound_device_id = ? WHERE id = ?")
      .run(newDeviceId, shareId);
  }

  async function listPoemShares({ status, poemId, userId, limit, offset }) {
    let sql = `
      SELECT
        pst.id,
        pst.poem_id,
        pst.creator_id,
        pst.status,
        pst.claim_pin,
        pst.claim_attempts,
        pst.access_count,
        pst.bound_user_id,
        pst.allow_save,
        pst.claim_policy,
        pst.created_at,
        pst.expires_at,
        p.title as poem_title,
        p.recipient_name
      FROM poem_share_tokens pst
      JOIN poems p ON pst.poem_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += " AND pst.status = ?";
      params.push(status);
    }
    if (poemId) {
      sql += " AND pst.poem_id = ?";
      params.push(poemId);
    }
    if (userId) {
      sql += " AND pst.creator_id = ?";
      params.push(userId);
    }

    sql += " ORDER BY pst.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function getPoemShareById(shareId) {
    return db.prepare("SELECT * FROM poem_share_tokens WHERE id = ?").get(shareId);
  }

  async function resetPoemShareAttempts(shareId) {
    return db
      .prepare("UPDATE poem_share_tokens SET claim_attempts = 0 WHERE id = ?")
      .run(shareId);
  }

  async function revokePoemShare(shareId) {
    return db
      .prepare("UPDATE poem_share_tokens SET status = ? WHERE id = ?")
      .run("revoked", shareId);
  }

  return {
    listShares,
    getShareById,
    rebindShareDevice,
    listPoemShares,
    getPoemShareById,
    resetPoemShareAttempts,
    revokePoemShare,
  };
}

module.exports = {
  createAdminShareManagementRepository,
};
