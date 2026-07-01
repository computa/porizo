process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAuthProviderLinkingRepository,
} = require("../src/database/auth-provider-linking-repository");

let db;
let repository;

async function seedUser({
  userId = "user_auth_provider_linking",
  deletedAt = null,
} = {}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, risk_level, deleted_at, created_at)
       VALUES (?, ?, 1, 'Auth Provider Linking User', 'low', ?, ?)`,
    )
    .run(
      userId,
      `${userId}@example.com`,
      deletedAt,
      "2026-06-28T00:00:00.000Z",
    );
}

async function seedProvider({
  id = "ap_auth_provider_linking",
  userId = "user_auth_provider_linking",
  provider = "apple",
  providerUserId = "apple-provider-subject",
  providerData = { existing: true },
  status = "active",
} = {}) {
  await db
    .prepare(
      `INSERT INTO user_auth_providers
         (id, user_id, provider, provider_user_id, provider_data, verified_at, linked_at, last_used_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      provider,
      providerUserId,
      JSON.stringify(providerData),
      "2026-06-28T00:00:00.000Z",
      "2026-06-28T00:00:00.000Z",
      "2026-06-28T00:00:00.000Z",
      status,
    );
}

describe("AuthProviderLinkingRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAuthProviderLinkingRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findAnyProviderLink preserves route guard semantics across statuses", async () => {
    await seedUser();
    await seedProvider({
      provider: "phone",
      providerUserId: "+15551234567",
      status: "revoked",
    });

    const link = await repository.findAnyProviderLink(
      "phone",
      "+15551234567",
    );

    assert.equal(link.user_id, "user_auth_provider_linking");
    assert.equal(link.status, "revoked");
  });

  test("findProviderForDeletedUser returns only provider rows owned by deleted users", async () => {
    await seedUser({ userId: "active_provider_user" });
    await seedProvider({
      id: "ap_active_provider_user",
      userId: "active_provider_user",
      providerUserId: "same-subject",
    });
    await seedUser({ userId: "deleted_provider_user" });
    await seedProvider({
      id: "ap_deleted_provider_user",
      userId: "deleted_provider_user",
      providerUserId: "deleted-subject",
    });
    await db
      .prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run("2026-06-28T01:00:00.000Z", "deleted_provider_user");

    const active = await repository.findProviderForDeletedUser(
      "apple",
      "same-subject",
    );
    const deleted = await repository.findProviderForDeletedUser(
      "apple",
      "deleted-subject",
    );

    assert.equal(active, undefined);
    assert.equal(deleted.id, "ap_deleted_provider_user");
  });

  test("revokeProvider marks a provider row revoked", async () => {
    await seedUser();
    await seedProvider();

    await repository.revokeProvider("ap_auth_provider_linking");

    const row = await db
      .prepare("SELECT status FROM user_auth_providers WHERE id = ?")
      .get("ap_auth_provider_linking");
    assert.equal(row.status, "revoked");
  });

  test("updateProviderData persists serialized provider metadata", async () => {
    await seedUser();
    await seedProvider();

    await repository.updateProviderData("ap_auth_provider_linking", {
      email: "private@example.com",
      apple_refresh_token: "refresh-token",
    });

    const row = await db
      .prepare("SELECT provider_data FROM user_auth_providers WHERE id = ?")
      .get("ap_auth_provider_linking");
    assert.deepEqual(JSON.parse(row.provider_data), {
      email: "private@example.com",
      apple_refresh_token: "refresh-token",
    });
  });
});
