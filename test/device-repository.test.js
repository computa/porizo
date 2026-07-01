process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createDeviceRepository } = require("../src/database/device-repository");

let db;
let repository;

async function insertUser(userId) {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run(userId, "2026-06-27T00:00:00.000Z");
}

async function insertDevice({
  id,
  userId,
  deviceId,
  pushToken,
}) {
  await db
    .prepare(
      `INSERT INTO devices (
         id, user_id, device_id, platform, push_token, created_at, updated_at
       ) VALUES (?, ?, ?, 'ios', ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      deviceId,
      pushToken,
      "2026-06-27T00:00:00.000Z",
      "2026-06-27T00:00:00.000Z",
    );
}

describe("DeviceRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createDeviceRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listPushTokensForUser returns only non-null tokens for the target user", async () => {
    await insertUser("user_runner_push");
    await insertUser("user_other");
    await insertDevice({
      id: "device_token_a",
      userId: "user_runner_push",
      deviceId: "device-a",
      pushToken: "push-token-a",
    });
    await insertDevice({
      id: "device_null_token",
      userId: "user_runner_push",
      deviceId: "device-null",
      pushToken: null,
    });
    await insertDevice({
      id: "device_token_b",
      userId: "user_runner_push",
      deviceId: "device-b",
      pushToken: "push-token-b",
    });
    await insertDevice({
      id: "device_other_user",
      userId: "user_other",
      deviceId: "device-other",
      pushToken: "push-token-other",
    });

    const rows = await repository.listPushTokensForUser("user_runner_push");

    assert.deepEqual(
      rows
        .map((row) => {
          assert.deepEqual(Object.keys(row), ["push_token"]);
          return row.push_token;
        })
        .sort(),
      ["push-token-a", "push-token-b"],
    );
  });

  test("listPushTokensForUser returns an empty array when no configured devices exist", async () => {
    await insertUser("user_without_push");
    await insertDevice({
      id: "device_no_push",
      userId: "user_without_push",
      deviceId: "device-no-push",
      pushToken: null,
    });

    const rows = await repository.listPushTokensForUser("user_without_push");

    assert.deepEqual(rows, []);
  });

  test("registerDevice inserts a new user device with push-token timestamps", async () => {
    await insertUser("user_register_device");

    const result = await repository.registerDevice({
      id: "device_register_row",
      userId: "user_register_device",
      deviceId: "idfv-register",
      platform: "ios",
      appVersion: "1.2.3",
      pushToken: "push-register",
      now: "2026-06-27T01:00:00.000Z",
    });

    assert.equal(result.changes, 1);
    assert.deepEqual(
      await db
        .prepare(
          `SELECT id, user_id, device_id, platform, app_version, last_seen_at,
                  push_token, push_token_updated_at, created_at, updated_at
             FROM devices
            WHERE id = ?`,
        )
        .get("device_register_row"),
      {
        id: "device_register_row",
        user_id: "user_register_device",
        device_id: "idfv-register",
        platform: "ios",
        app_version: "1.2.3",
        last_seen_at: "2026-06-27T01:00:00.000Z",
        push_token: "push-register",
        push_token_updated_at: "2026-06-27T01:00:00.000Z",
        created_at: "2026-06-27T01:00:00.000Z",
        updated_at: "2026-06-27T01:00:00.000Z",
      },
    );
  });

  test("registerDevice updates an existing device and preserves push token when omitted", async () => {
    await insertUser("user_existing_device");
    await insertDevice({
      id: "device_existing_row",
      userId: "user_existing_device",
      deviceId: "idfv-existing",
      pushToken: "push-existing",
    });
    await db
      .prepare(
        "UPDATE devices SET push_token_updated_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        "2026-06-27T00:30:00.000Z",
        "2026-06-27T00:30:00.000Z",
        "2026-06-27T00:30:00.000Z",
        "device_existing_row",
      );

    await repository.registerDevice({
      id: "unused_new_id",
      userId: "user_existing_device",
      deviceId: "idfv-existing",
      platform: "ios",
      appVersion: "2.0.0",
      pushToken: null,
      now: "2026-06-27T02:00:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT platform, app_version, last_seen_at, push_token,
                  push_token_updated_at, updated_at
             FROM devices
            WHERE id = ?`,
        )
        .get("device_existing_row"),
      {
        platform: "ios",
        app_version: "2.0.0",
        last_seen_at: "2026-06-27T02:00:00.000Z",
        push_token: "push-existing",
        push_token_updated_at: "2026-06-27T00:30:00.000Z",
        updated_at: "2026-06-27T02:00:00.000Z",
      },
    );
    assert.equal(
      await db.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
      1,
    );
  });

  test("registerDevice refreshes push token and timestamp for an existing device", async () => {
    await insertUser("user_refresh_device");
    await insertDevice({
      id: "device_refresh_row",
      userId: "user_refresh_device",
      deviceId: "idfv-refresh",
      pushToken: "push-old",
    });

    await repository.registerDevice({
      id: "unused_refresh_id",
      userId: "user_refresh_device",
      deviceId: "idfv-refresh",
      platform: "ios",
      appVersion: null,
      pushToken: "push-new",
      now: "2026-06-27T03:00:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare(
          `SELECT app_version, last_seen_at, push_token, push_token_updated_at,
                  updated_at
             FROM devices
            WHERE id = ?`,
        )
        .get("device_refresh_row"),
      {
        app_version: null,
        last_seen_at: "2026-06-27T03:00:00.000Z",
        push_token: "push-new",
        push_token_updated_at: "2026-06-27T03:00:00.000Z",
        updated_at: "2026-06-27T03:00:00.000Z",
      },
    );
  });
});
