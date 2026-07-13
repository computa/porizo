process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createIdentityRepository } = require("../src/database/identity-repository");

let db;
let repository;

async function seedUser({
  userId = "user_identity_repo",
  email = null,
  emailVerified = 0,
  phoneNumber = null,
  deletedAt = null,
} = {}) {
  await db.prepare(
    `INSERT INTO users (id, email, email_verified, phone_number, display_name, risk_level, deleted_at, created_at)
     VALUES (?, ?, ?, ?, 'Identity Repo User', 'low', ?, ?)`,
  ).run(
    userId,
    email,
    emailVerified,
    phoneNumber,
    deletedAt,
    "2026-06-25T10:00:00.000Z",
  );
  return userId;
}

async function seedIdentity({
  id = "ap_identity_repo",
  userId = "user_identity_repo",
  provider = "email",
  providerUserId = "identity@example.com",
  status = "active",
  linkedAt = "2026-06-25T10:00:00.000Z",
} = {}) {
  await db.prepare(
    `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_data, verified_at, linked_at, last_used_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    provider,
    providerUserId,
    JSON.stringify({ test: true }),
    linkedAt,
    linkedAt,
    linkedAt,
    status,
  );
  return id;
}

async function seedContact({
  id = "uc_identity_repo",
  userId = "user_identity_repo",
  type = "email",
  valueNormalized = "identity@example.com",
  valueDisplay = "identity@example.com",
  verifiedAt = null,
  source = "test",
  sourceIdentityId = null,
  isPrimary = true,
  isRelay = false,
} = {}) {
  await db.prepare(
    `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, source_identity_id, is_primary, is_relay, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    type,
    valueNormalized,
    valueDisplay,
    verifiedAt,
    source,
    sourceIdentityId,
    isPrimary ? 1 : 0,
    isRelay ? 1 : 0,
    "2026-06-25T10:00:00.000Z",
  );
  return id;
}

describe("IdentityRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createIdentityRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findActiveIdentity only resolves active identities for non-deleted users", async () => {
    await seedUser();
    await seedIdentity({ provider: "email", providerUserId: "active@example.com" });
    await seedUser({ userId: "user_deleted" });
    await seedIdentity({
      id: "ap_deleted",
      userId: "user_deleted",
      provider: "email",
      providerUserId: "deleted@example.com",
    });
    await db
      .prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run("2026-06-26T00:00:00.000Z", "user_deleted");
    await seedUser({ userId: "user_inactive" });
    await seedIdentity({
      id: "ap_inactive",
      userId: "user_inactive",
      provider: "email",
      providerUserId: "inactive@example.com",
      status: "revoked",
    });

    const active = await repository.findActiveIdentity("email", "active@example.com");
    const deleted = await repository.findActiveIdentity("email", "deleted@example.com");
    const inactive = await repository.findActiveIdentity("email", "inactive@example.com");

    assert.equal(active.user_id, "user_identity_repo");
    assert.equal(active.provider, "email");
    assert.equal(deleted, undefined);
    assert.equal(inactive, undefined);
  });

  test("findUserDisplayProfile returns display name and email", async () => {
    await seedUser({ email: "sender@example.com" });

    const profile = await repository.findUserDisplayProfile(
      "user_identity_repo",
    );

    assert.deepEqual(profile, {
      display_name: "Identity Repo User",
      email: "sender@example.com",
    });
  });

  test("account lookup helpers preserve verified-contact and provider matching semantics", async () => {
    await seedUser({ email: "identity@example.com", phoneNumber: "+15551234567" });
    await seedIdentity({
      provider: "phone",
      providerUserId: "+15551234567",
    });
    await seedIdentity({
      id: "ap_social",
      provider: "apple",
      providerUserId: "apple-subject",
      status: "revoked",
    });
    await seedContact({
      valueNormalized: "identity@example.com",
      verifiedAt: "2026-06-25T10:00:00.000Z",
    });
    await seedUser({ userId: "user_unverified" });
    await seedContact({
      id: "uc_unverified",
      userId: "user_unverified",
      valueNormalized: "unverified@example.com",
      verifiedAt: null,
    });
    await seedUser({ userId: "user_deleted" });
    await seedContact({
      id: "uc_deleted",
      userId: "user_deleted",
      valueNormalized: "deleted@example.com",
      verifiedAt: "2026-06-25T10:00:00.000Z",
    });
    await db
      .prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run("2026-06-26T00:00:00.000Z", "user_deleted");

    assert.deepEqual(
      await repository.findActiveUserByVerifiedContact("email", "identity@example.com"),
      { id: "user_identity_repo" },
    );
    assert.equal(
      await repository.findActiveUserByVerifiedContact("email", "unverified@example.com"),
      undefined,
    );
    assert.equal(
      await repository.findActiveUserByVerifiedContact("email", "deleted@example.com"),
      undefined,
    );
    assert.deepEqual(
      await repository.findActiveUserByProvider("phone", "+15551234567", {
        status: "active",
      }),
      { id: "user_identity_repo" },
    );
    assert.deepEqual(
      await repository.findActiveUserByProvider("apple", "apple-subject"),
      { id: "user_identity_repo" },
    );
    assert.equal(
      await repository.findActiveUserByProvider("apple", "apple-subject", {
        status: "active",
      }),
      undefined,
    );
    assert.deepEqual(
      (await repository.listAuthProvidersForUser("user_identity_repo")).map(
        (row) => row.provider,
      ).sort(),
      ["apple", "phone"],
    );
    assert.deepEqual(
      (await repository.listActiveAuthProvidersForUser("user_identity_repo")).map(
        (row) => row.provider,
      ),
      ["phone"],
    );
    assert.deepEqual(
      await repository.findUserContactMirrors("user_identity_repo"),
      {
        email: "identity@example.com",
        phone_number: "+15551234567",
      },
    );
  });

  test("contact methods create, update, verify, and promote primary contacts", async () => {
    await seedUser();
    await seedIdentity();
    const created = await repository.insertContact({
      id: "uc_email",
      userId: "user_identity_repo",
      type: "email",
      valueNormalized: "identity@example.com",
      valueDisplay: "Identity@Example.com",
      source: "user_entered",
      isPrimary: true,
      isRelay: false,
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    assert.equal(created.changes, 1);

    const existing = await repository.findContactByValue(
      "user_identity_repo",
      "email",
      "identity@example.com",
    );
    assert.equal(existing.id, "uc_email");
    assert.equal(existing.verified_at, null);

    await repository.updateContactVerificationSource({
      id: "uc_email",
      source: "email_token",
      sourceIdentityId: "ap_identity_repo",
      verifiedAt: "2026-06-25T11:00:00.000Z",
    });
    await repository.updateContactSource({
      id: "uc_email",
      source: "provider_sync",
      sourceIdentityId: null,
    });
    await repository.insertContact({
      id: "uc_email_second",
      userId: "user_identity_repo",
      type: "email",
      valueNormalized: "second@example.com",
      valueDisplay: "second@example.com",
      source: "user_entered",
      isPrimary: false,
      isRelay: false,
      createdAt: "2026-06-25T12:00:00.000Z",
    });
    const type = await repository.getContactTypeForUser("uc_email_second", "user_identity_repo");
    assert.deepEqual(type, { type: "email" });

    await repository.clearPrimaryContactForType("user_identity_repo", "email");
    await repository.setPrimaryContact("uc_email_second");

    const rows = await db.prepare(
      "SELECT id, source, source_identity_id, verified_at, is_primary FROM user_contacts WHERE user_id = ? ORDER BY id",
    ).all("user_identity_repo");
    assert.deepEqual(
      rows.map((row) => [row.id, row.source, row.source_identity_id, row.is_primary]),
      [
        ["uc_email", "provider_sync", null, 0],
        ["uc_email_second", "user_entered", null, 1],
      ],
    );
    assert.equal(rows[0].verified_at, "2026-06-25T11:00:00.000Z");
  });

  test("profile and mirror helpers preserve identity-service policy probes", async () => {
    await seedUser();
    await seedContact({
      id: "uc_relay",
      valueNormalized: "relay@privaterelay.appleid.com",
      valueDisplay: "relay@privaterelay.appleid.com",
      verifiedAt: "2026-06-25T10:00:00.000Z",
      isPrimary: true,
      isRelay: true,
    });
    await seedContact({
      id: "uc_real",
      valueNormalized: "identity@example.com",
      valueDisplay: "identity@example.com",
      verifiedAt: "2026-06-25T11:00:00.000Z",
      isPrimary: true,
      isRelay: false,
    });
    await seedContact({
      id: "uc_phone",
      type: "phone",
      valueNormalized: "+15551234567",
      valueDisplay: "+15551234567",
      verifiedAt: "2026-06-25T12:00:00.000Z",
      isPrimary: true,
    });

    assert.equal((await repository.findVerifiedNonRelayEmail("user_identity_repo")).id, "uc_real");
    assert.equal((await repository.findNonRelayEmail("user_identity_repo")).id, "uc_real");
    assert.equal((await repository.findVerifiedPhone("user_identity_repo")).id, "uc_phone");
    assert.equal((await repository.findPhone("user_identity_repo")).id, "uc_phone");
    assert.equal((await repository.findPrimaryVerifiedEmail("user_identity_repo")).value_normalized, "relay@privaterelay.appleid.com");
    assert.equal((await repository.findPrimaryVerifiedPhone("user_identity_repo")).value_normalized, "+15551234567");

    await repository.updateUserContactMirrors({
      userId: "user_identity_repo",
      email: "relay@privaterelay.appleid.com",
      emailVerified: 1,
      phoneNumber: "+15551234567",
    });
    const user = await db.prepare(
      "SELECT email, email_verified, phone_number FROM users WHERE id = ?",
    ).get("user_identity_repo");
    assert.deepEqual(user, {
      email: "relay@privaterelay.appleid.com",
      email_verified: 1,
      phone_number: "+15551234567",
    });
  });

  test("conflict and usage helpers preserve raw row/update semantics", async () => {
    await seedUser();
    await seedIdentity({ provider: "email", providerUserId: "identity@example.com" });
    await seedContact({
      valueNormalized: "identity@example.com",
      verifiedAt: "2026-06-25T10:00:00.000Z",
    });

    assert.equal(
      (await repository.findIdentityConflict("email", "identity@example.com", "other_user")).user_id,
      "user_identity_repo",
    );
    assert.equal(
      await repository.findIdentityConflict("email", "identity@example.com", "user_identity_repo"),
      undefined,
    );
    assert.equal(
      (await repository.findVerifiedContactConflict("email", "identity@example.com", "other_user")).user_id,
      "user_identity_repo",
    );

    const updated = await repository.updateIdentityLastUsed(
      "ap_identity_repo",
      "2026-06-25T12:00:00.000Z",
    );
    assert.equal(updated.changes, 1);
    const missing = await repository.updateIdentityLastUsed(
      "ap_missing",
      "2026-06-25T12:00:00.000Z",
    );
    assert.equal(missing.changes, 0);
  });

  test("deleteUserIdentityBootstrapRows removes route-created identity bootstrap rows", async () => {
    await seedUser();
    await seedIdentity({ provider: "email", providerUserId: "identity@example.com" });
    await seedContact({
      valueNormalized: "identity@example.com",
      verifiedAt: null,
    });
    await db.prepare(
      "INSERT INTO user_credentials (user_id, password_hash, created_at) VALUES (?, ?, ?)",
    ).run(
      "user_identity_repo",
      "hashed-password",
      "2026-06-25T10:00:00.000Z",
    );

    const result = await repository.deleteUserIdentityBootstrapRows("user_identity_repo");
    assert.equal(result.changes, 1);

    const counts = {
      users: await db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?").get("user_identity_repo"),
      providers: await db.prepare("SELECT COUNT(*) AS count FROM user_auth_providers WHERE user_id = ?").get("user_identity_repo"),
      contacts: await db.prepare("SELECT COUNT(*) AS count FROM user_contacts WHERE user_id = ?").get("user_identity_repo"),
      credentials: await db.prepare("SELECT COUNT(*) AS count FROM user_credentials WHERE user_id = ?").get("user_identity_repo"),
    };
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(counts).map(([table, row]) => [table, Number(row.count)]),
      ),
      {
        users: 0,
        providers: 0,
        contacts: 0,
        credentials: 0,
      },
    );
  });

  test("transaction uses transaction-scoped repository and rolls back on failure", async () => {
    await assert.rejects(
      () => repository.transaction(async (txRepository) => {
        await txRepository.insertUser({
          id: "user_tx_rollback",
          displayName: "Rollback",
          createdAt: "2026-06-25T10:00:00.000Z",
        });
        throw new Error("rollback");
      }),
      /rollback/,
    );

    const row = await db.prepare("SELECT id FROM users WHERE id = ?").get("user_tx_rollback");
    assert.equal(row, undefined);
  });
});
