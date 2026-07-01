process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createGdprAuditRepository } = require("../src/database/gdpr-audit-repository");

let db;
let gdprAuditService;
let previousIpHashSalt;

function freshGdprAuditService() {
  const servicePath = require.resolve("../src/services/gdpr-audit-service");
  delete require.cache[servicePath];
  return require(servicePath);
}

function expectedIpHash(ip) {
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT || ""))
    .digest("hex")
    .slice(0, 16);
}

async function findAuditLog(eventId) {
  return db.prepare(`
    SELECT id, user_id, action, resource_type, resource_id, metadata_json, created_at
    FROM audit_logs
    WHERE id = ?
  `).get(eventId);
}

describe("GdprAuditRepository", () => {
  beforeEach(async () => {
    previousIpHashSalt = process.env.IP_HASH_SALT;
    process.env.IP_HASH_SALT = "gdpr-audit-test-salt";
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    gdprAuditService = freshGdprAuditService();
  });

  afterEach(async () => {
    if (previousIpHashSalt === undefined) {
      delete process.env.IP_HASH_SALT;
    } else {
      process.env.IP_HASH_SALT = previousIpHashSalt;
    }

    if (db) {
      await db.close();
      db = null;
    }

    gdprAuditService = null;
  });

  test("repository inserts a raw audit log row without changing fields", async () => {
    const repository = createGdprAuditRepository(db);

    await repository.insertAuditLog({
      id: "gdpr_repo_contract",
      userId: "repo_user",
      action: "DATA_EXPORT_REQUESTED",
      resourceType: "user",
      resourceId: "repo_user",
      metadataJson: '{"gdpr_request":true}',
      createdAt: "2026-06-26T01:02:03.000Z",
    });

    assert.deepEqual(await findAuditLog("gdpr_repo_contract"), {
      id: "gdpr_repo_contract",
      user_id: "repo_user",
      action: "DATA_EXPORT_REQUESTED",
      resource_type: "user",
      resource_id: "repo_user",
      metadata_json: '{"gdpr_request":true}',
      created_at: "2026-06-26T01:02:03.000Z",
    });
  });

  test("service throws the existing uninitialized error before initialize", async () => {
    await assert.rejects(
      () => gdprAuditService.logAccountDeletion("missing_init_user", "203.0.113.10"),
      /GDPR audit service not initialized — call init\(\) first/,
    );
  });

  test("account deletion writes exact GDPR retention metadata and hashed IP", async () => {
    gdprAuditService.initialize(db);

    const eventId = await gdprAuditService.logAccountDeletion(
      "delete_user",
      "203.0.113.10",
    );

    assert.match(eventId, /^gdpr_\d+_[0-9a-f]{12}$/);

    const row = await findAuditLog(eventId);
    assert.equal(row.user_id, "delete_user");
    assert.equal(row.action, "ACCOUNT_DELETION");
    assert.equal(row.resource_type, "user");
    assert.equal(row.resource_id, "delete_user");
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(row.metadata_json.includes("203.0.113.10"), false);

    const metadata = JSON.parse(row.metadata_json);
    assert.deepEqual(metadata, {
      gdpr_request: true,
      ip_address: expectedIpHash("203.0.113.10"),
      deletion_type: "full_cascade",
      retention_policy: {
        audit_logs: "7_years",
        embeddings: "24_hours",
        raw_recordings: "7_days",
      },
    });
    assert.match(metadata.ip_address, /^[0-9a-f]{16}$/);
  });

  test("data export uses json by default and preserves explicit export format", async () => {
    gdprAuditService.initialize(db);

    const defaultEventId = await gdprAuditService.logDataExportRequest(
      "export_user_default",
      null,
    );
    const csvEventId = await gdprAuditService.logDataExportRequest(
      "export_user_csv",
      "198.51.100.44",
      "csv",
    );

    const defaultRow = await findAuditLog(defaultEventId);
    assert.equal(defaultRow.action, "DATA_EXPORT_REQUESTED");
    assert.equal(defaultRow.resource_type, "user");
    assert.equal(defaultRow.resource_id, "export_user_default");
    assert.deepEqual(JSON.parse(defaultRow.metadata_json), {
      gdpr_request: true,
      ip_address: null,
      export_format: "json",
    });

    const csvMetadata = JSON.parse((await findAuditLog(csvEventId)).metadata_json);
    assert.deepEqual(csvMetadata, {
      gdpr_request: true,
      ip_address: expectedIpHash("198.51.100.44"),
      export_format: "csv",
    });
  });

  test("consent changes select granted/revoked actions and consent resource id", async () => {
    gdprAuditService.initialize(db);

    const grantedEventId = await gdprAuditService.logConsentChange(
      "consent_user",
      "voice_enrollment",
      true,
      "192.0.2.12",
    );
    const revokedEventId = await gdprAuditService.logConsentChange(
      "consent_user",
      "marketing",
      false,
      null,
    );

    const grantedRow = await findAuditLog(grantedEventId);
    assert.equal(grantedRow.action, "CONSENT_GRANTED");
    assert.equal(grantedRow.resource_type, "consent");
    assert.equal(grantedRow.resource_id, "voice_enrollment");
    assert.deepEqual(JSON.parse(grantedRow.metadata_json), {
      gdpr_request: true,
      ip_address: expectedIpHash("192.0.2.12"),
      consent_type: "voice_enrollment",
      granted: true,
    });

    const revokedRow = await findAuditLog(revokedEventId);
    assert.equal(revokedRow.action, "CONSENT_REVOKED");
    assert.equal(revokedRow.resource_type, "consent");
    assert.equal(revokedRow.resource_id, "marketing");
    assert.deepEqual(JSON.parse(revokedRow.metadata_json), {
      gdpr_request: true,
      ip_address: null,
      consent_type: "marketing",
      granted: false,
    });
  });

  test("service propagates insert failures instead of hiding compliance loss", async () => {
    gdprAuditService.initialize({}, {
      auditRepository: {
        insertAuditLog: async () => {
          throw new Error("insert failed");
        },
      },
    });

    await assert.rejects(
      () => gdprAuditService.logDataExportRequest("failure_user", "203.0.113.55"),
      /insert failed/,
    );
  });
});
