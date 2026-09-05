"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const { initDb } = require("../../src/db");
const {
  createEtsyArtifactService,
} = require("../../src/services/etsy-artifact-service");

describe("Etsy MP3 artifact repair", () => {
  let db;
  let storageDir;

  beforeEach(async () => {
    db = await initDb();
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-etsy-artifact-"));
    await db
      .prepare(
        "INSERT INTO users (id, created_at, risk_level, account_status) VALUES ('artifact_user', CURRENT_TIMESTAMP, 'low', 'active')",
      )
      .run();
    await db
      .prepare(
        `INSERT INTO tracks
          (id, user_id, status, title, occasion, recipient_name, style,
           created_at, updated_at)
         VALUES ('artifact_track', 'artifact_user', 'complete', 'Song',
                 'custom', 'Person', 'acoustic', CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO track_versions
          (id, track_id, version_num, status, render_type, params_hash,
           lyrics_status, created_at)
         VALUES ('artifact_version', 'artifact_track', 1, 'full_ready', 'full',
                 'artifact-hash', 'approved', CURRENT_TIMESTAMP)`,
      )
      .run();
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it("records a retryable failure, then backfills a verified artifact", async () => {
    let attempts = 0;
    const service = createEtsyArtifactService({
      db,
      storageDir,
      storageProvider: {
        downloadToFile: async () => {},
      },
      etsyOrderService: {
        findUnitForWebOrder: async () => ({
          track_id: "artifact_track",
          track_version_id: "artifact_version",
        }),
      },
      uploadMp3: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary upload failure");
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT INTO track_artifacts
              (id, track_version_id, kind, status, storage_key, sha256,
               byte_length, attempt_count, created_at, updated_at)
             VALUES ('artifact_artifact_version_full_mp3', 'artifact_version',
                     'full_mp3', 'ready', 'tracks/master.mp3', ?, 4096, 2, ?, ?)
             ON CONFLICT(track_version_id, kind) DO UPDATE SET
               status = 'ready', storage_key = excluded.storage_key,
               sha256 = excluded.sha256, byte_length = excluded.byte_length,
               attempt_count = 2, updated_at = excluded.updated_at`,
          )
          .run("a".repeat(64), now, now);
      },
      logger: { error: () => {} },
    });

    const failed = await service.repairForOrder({ id: "worder_artifact" });
    assert.equal(failed.ready, false);
    assert.ok(failed.artifact.next_attempt_at);

    const repaired = await service.retryForOrder({ id: "worder_artifact" });
    assert.equal(repaired.ready, true);
    assert.equal(repaired.artifact.byte_length, 4096);
    assert.equal(attempts, 2);
  });

  it("repairs an Etsy unit created by the native flow without a web order", async () => {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, is_paid, is_canceled, state,
           created_at, updated_at)
         VALUES ('native_order', 'shop_123', '9001', 1, 0, 'claimed', ?, ?)`,
      )
      .run(now, now);
    await db
      .prepare(
        `INSERT INTO etsy_order_units
          (id, etsy_order_id, transaction_id, listing_id, ordinal, state,
           owner_user_id, track_id, track_version_id, created_at, updated_at)
         VALUES ('native_unit', 'native_order', 'native_tx', 'listing_1', 1,
                 'rendering', 'artifact_user', 'artifact_track',
                 'artifact_version', ?, ?)`,
      )
      .run(now, now);
    const service = createEtsyArtifactService({
      db,
      storageDir,
      storageProvider: { downloadToFile: async () => {} },
      etsyOrderService: { findUnitForWebOrder: async () => null },
      uploadMp3: async ({ trackVersion }) => {
        await db
          .prepare(
            `UPDATE track_artifacts
                SET status = 'ready', storage_key = 'tracks/native.mp3',
                    sha256 = ?, byte_length = 4096, attempt_count = 1,
                    processing_started_at = NULL, updated_at = ?
              WHERE track_version_id = ? AND kind = 'full_mp3'`,
          )
          .run("b".repeat(64), now, trackVersion.id);
      },
    });

    const results = await service.processDueArtifacts();
    assert.equal(results.length, 1);
    assert.equal(results[0].etsyUnitId, "native_unit");
    assert.equal(results[0].ready, true);
  });

  it("repairs a JSON-imported MTO item without a legacy Etsy unit", async () => {
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO etsy_mto_orders (id,shop_id,receipt_id,created_at,updated_at) VALUES ('mto-order','99','123',?,?)").run(now, now);
    await db.prepare("INSERT INTO etsy_mto_items (id,etsy_mto_order_id,transaction_id,ordinal,listing_id,brief_json,raw_personalization_hash,state,track_id,track_version_id,created_at,updated_at) VALUES ('mto-item','mto-order','456',0,'789','{}','hash','rendering','artifact_track','artifact_version',?,?)").run(now, now);
    const service = createEtsyArtifactService({
      db, storageDir, storageProvider: { downloadToFile: async () => {} },
      etsyOrderService: { findUnitForWebOrder: async () => { throw new Error("Must not resolve a web order"); } },
      uploadMp3: async ({ trackVersion }) => {
        await db.prepare("UPDATE track_artifacts SET status='ready',storage_key='mto.mp3',sha256=?,byte_length=4096 WHERE track_version_id=?").run("c".repeat(64), trackVersion.id);
      },
    });
    const result = await service.repairForOrder({ mtoItemId: "mto-item" });
    assert.equal(result.ready, true);
    assert.equal(result.artifact.storage_key, "mto.mp3");
  });
});
