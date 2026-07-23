"use strict";

process.env.NODE_ENV = "test";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  createEtsyKeyRotationService,
} = require("../../src/services/etsy-key-rotation-service");
const {
  decryptValue,
  encryptValue,
  lookupHash,
} = require("../../src/services/etsy-secrets");

describe("Etsy data-key backfill", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
    process.env.ETSY_DATA_ENCRYPTION_KEY_ID = "etsy-old";
    process.env.ETSY_DATA_ENCRYPTION_KEY =
      "old-etsy-key-material-that-is-at-least-32-bytes";
    delete process.env.ETSY_DATA_ENCRYPTION_KEYRING;
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO etsy_connections
          (shop_id, access_token_encrypted, refresh_token_encrypted, status,
           created_at, updated_at)
         VALUES ('shop', ?, ?, 'connected', ?, ?)`,
      )
      .run(encryptValue("access"), encryptValue("refresh"), now, now);
    await db
      .prepare(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, buyer_email_encrypted,
           buyer_email_lookup_hash, is_paid, is_canceled, state,
           created_at, updated_at)
         VALUES ('order', 'shop', '123', ?, ?, 1, 0, 'paid', ?, ?)`,
      )
      .run(
        encryptValue("buyer@example.com"),
        lookupHash("buyer@example.com"),
        now,
        now,
      );

    process.env.ETSY_DATA_ENCRYPTION_KEY_ID = "etsy-new";
    process.env.ETSY_DATA_ENCRYPTION_KEY =
      "new-etsy-key-material-that-is-at-least-32-bytes";
    process.env.ETSY_DATA_ENCRYPTION_KEYRING = JSON.stringify({
      "etsy-old": "old-etsy-key-material-that-is-at-least-32-bytes",
    });
  });

  afterEach(async () => {
    await db.close();
    delete process.env.ETSY_DATA_ENCRYPTION_KEY_ID;
    delete process.env.ETSY_DATA_ENCRYPTION_KEY;
    delete process.env.ETSY_DATA_ENCRYPTION_KEYRING;
  });

  it("rewrites every old envelope and lookup hash before old-key retirement", async () => {
    const service = createEtsyKeyRotationService(db);
    assert.equal((await service.scan()).old_envelope_count, 3);

    const result = await service.rotate();
    assert.equal(result.old_envelope_count, 0);
    assert.equal(result.envelope_counts["etsy-new"], 3);
    const order = await db
      .prepare(
        "SELECT buyer_email_encrypted, buyer_email_lookup_hash FROM etsy_orders WHERE id = 'order'",
      )
      .get();
    assert.equal(decryptValue(order.buyer_email_encrypted), "buyer@example.com");
    assert.equal(order.buyer_email_lookup_hash, lookupHash("buyer@example.com"));
  });
});
