process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createGdprDataExportRepository,
} = require("../src/database/gdpr-data-export-repository");

let db;
let repository;

describe("GdprDataExportRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createGdprDataExportRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findActiveUser ignores soft-deleted users", async () => {
    await db
      .prepare(
        `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
         VALUES (?, ?, 1, 'Export User', 'low', ?)`,
      )
      .run(
        "gdpr_export_user",
        "gdpr-export@example.com",
        "2026-06-28T00:00:00.000Z",
      );
    await db
      .prepare(
        `INSERT INTO users (id, email, email_verified, display_name, risk_level, deleted_at, created_at)
         VALUES (?, ?, 1, 'Deleted Export User', 'low', ?, ?)`,
      )
      .run(
        "gdpr_deleted_user",
        "gdpr-deleted@example.com",
        "2026-06-28T01:00:00.000Z",
        "2026-06-28T00:00:00.000Z",
      );

    assert.equal(
      (await repository.findActiveUser("gdpr_export_user")).id,
      "gdpr_export_user",
    );
    assert.equal(await repository.findActiveUser("gdpr_deleted_user"), undefined);
  });

  test("listUserExportSections returns user-scoped top-level export rows", async () => {
    await db
      .prepare(
        `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
         VALUES (?, ?, 1, 'Export User', 'low', ?)`,
      )
      .run(
        "gdpr_export_user",
        "gdpr-export@example.com",
        "2026-06-28T00:00:00.000Z",
      );
    await db
      .prepare(
        `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay, created_at)
         VALUES (?, ?, 'email', ?, ?, ?, 'profile', 1, 0, ?)`,
      )
      .run(
        "contact_gdpr_export",
        "gdpr_export_user",
        "gdpr-export@example.com",
        "gdpr-export@example.com",
        "2026-06-28T00:00:00.000Z",
        "2026-06-28T00:00:00.000Z",
      );
    await db
      .prepare(
        `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
         VALUES (?, ?, 1, 'Other Export User', 'low', ?)`,
      )
      .run(
        "other_export_user",
        "other-export@example.com",
        "2026-06-28T00:00:00.000Z",
      );
    await db
      .prepare(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, buyer_email_encrypted,
           buyer_email_lookup_hash, is_paid, is_canceled, state,
           owner_user_id, created_at, updated_at)
         VALUES ('etsy_export_order', 'shop', '525252', 'encrypted-secret',
                 'lookup-secret', 1, 0, 'claimed', 'gdpr_export_user',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO etsy_order_units
          (id, etsy_order_id, transaction_id, listing_id, ordinal, state,
           owner_user_id, created_at, updated_at)
         VALUES ('etsy_export_unit', 'etsy_export_order', 'tx', 'listing', 1,
                 'claimed', 'gdpr_export_user', CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP)`,
      )
      .run();

    const sections =
      await repository.listUserExportSections("gdpr_export_user");

    assert.equal(sections.profile.length, 1);
    assert.equal(sections.profile[0].id, "gdpr_export_user");
    assert.equal(sections.contacts.length, 1);
    assert.equal(sections.contacts[0].id, "contact_gdpr_export");
    assert.equal(
      sections.profile.some((row) => row.id === "other_export_user"),
      false,
    );
    assert.equal(sections.etsy_orders[0].id, "etsy_export_order");
    assert.equal(sections.etsy_order_units[0].id, "etsy_export_unit");
    assert.equal("buyer_email_encrypted" in sections.etsy_orders[0], false);
    assert.equal("buyer_email_lookup_hash" in sections.etsy_orders[0], false);
  });

  test("listUserExportSections preserves per-section unavailable fallback", async () => {
    const fakeRepository = createGdprDataExportRepository({
      prepare(sql) {
        if (sql.includes("user_contacts")) {
          throw new Error("simulated missing table");
        }
        return {
          async all() {
            return [];
          },
          async get() {
            return { id: "gdpr_export_user" };
          },
        };
      },
    });

    const sections =
      await fakeRepository.listUserExportSections("gdpr_export_user");

    assert.deepEqual(sections.profile, []);
    assert.match(sections.contacts.error, /simulated missing table/);
  });
});
