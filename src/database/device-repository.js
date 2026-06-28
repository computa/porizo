"use strict";

function createDeviceRepository(db) {
  async function registerDevice({
    id,
    userId,
    deviceId,
    platform,
    appVersion = null,
    pushToken = null,
    now,
  }) {
    const existing = await db
      .prepare("SELECT id FROM devices WHERE user_id = ? AND device_id = ?")
      .get(userId, deviceId);

    if (existing) {
      if (pushToken) {
        return db
          .prepare(
            "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, push_token = ?, push_token_updated_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(platform, appVersion || null, now, pushToken, now, now, existing.id);
      }

      return db
        .prepare(
          "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(platform, appVersion || null, now, now, existing.id);
    }

    return db
      .prepare(
        "INSERT INTO devices (id, user_id, device_id, platform, app_version, last_seen_at, push_token, push_token_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        userId,
        deviceId,
        platform,
        appVersion || null,
        now,
        pushToken || null,
        pushToken ? now : null,
        now,
        now,
      );
  }

  async function listPushTokensForUser(userId) {
    return db
      .prepare(
        "SELECT push_token FROM devices WHERE user_id = ? AND push_token IS NOT NULL",
      )
      .all(userId);
  }

  return {
    registerDevice,
    listPushTokensForUser,
  };
}

module.exports = { createDeviceRepository };
