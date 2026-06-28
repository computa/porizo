require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminBillingRepository,
} = require("../src/database/admin-billing-repository");

async function seedAudit(db, fields) {
  await db
    .prepare(
      `INSERT INTO audit_logs (
        id, user_id, action, resource_type, resource_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.userId ?? "admin_webhook_repo",
      fields.action,
      fields.resourceType ?? "webhook",
      fields.resourceId ?? fields.id,
      fields.metadataJson ?? "{}",
      fields.createdAt,
    );
}

describe("admin webhook health repository", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminBillingRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("summarizes webhook audit health without counting non-webhook rows", async () => {
    const since = "2026-06-26T10:00:00.000Z";
    await seedAudit(db, {
      id: "webhook_repo_apple_1",
      action: "webhook_apple_processed",
      createdAt: "2026-06-27T08:00:00.000Z",
    });
    await seedAudit(db, {
      id: "webhook_repo_apple_2",
      action: "webhook_apple_processed",
      createdAt: "2026-06-27T09:00:00.000Z",
    });
    await seedAudit(db, {
      id: "webhook_repo_google_error",
      action: "webhook_google_failed",
      metadataJson: JSON.stringify({ error: "signature" }),
      createdAt: "2026-06-27T09:30:00.000Z",
    });
    await seedAudit(db, {
      id: "webhook_repo_non_webhook_error",
      action: "admin_update_risk",
      metadataJson: JSON.stringify({ error: "ignored" }),
      createdAt: "2026-06-27T09:45:00.000Z",
    });
    await seedAudit(db, {
      id: "webhook_repo_old",
      action: "webhook_apple_processed",
      metadataJson: JSON.stringify({ error: "old ignored" }),
      createdAt: "2026-06-25T09:00:00.000Z",
    });

    const result = await repository.getWebhookHealth({ since });

    assert.equal(result.lastWebhookReceived, "2026-06-27T09:30:00.000Z");
    assert.deepEqual(
      Object.fromEntries(
        result.webhooksByType.map((row) => [row.webhook_type, row.count]),
      ),
      {
        webhook_apple_processed: 2,
        webhook_google_failed: 1,
      },
    );
    assert.equal(result.failedWebhooks, 1);
  });
});
