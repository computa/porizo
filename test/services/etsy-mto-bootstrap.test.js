"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const Fastify = require("fastify");
const { initDb } = require("../../src/database/sqlite");
const { createTrackVersionRepository } = require("../../src/database/track-version-repository");
const { registerEtsyMtoPipeline } = require("../../src/services/etsy-mto-bootstrap");
const { registerAdminEtsyMtoRoutes } = require("../../src/routes/admin/etsy-mto");
const { moderationCheck, validateGeneratedLyrics } = require("../../src/providers/moderation");
const { setFeatureFlag } = require("../../src/services/feature-flags");

async function fixture(t, lyrics = "Maya, remember the jetty") {
  const previous = { ETSY_SHOP_ID: process.env.ETSY_SHOP_ID, ETSY_LISTING_IDS: process.env.ETSY_LISTING_IDS };
  process.env.ETSY_SHOP_ID = "99";
  process.env.ETSY_LISTING_IDS = "789";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(__dirname, "../../migrations") });
  db.prepare("INSERT INTO users (id, created_at, account_status) VALUES ('etsy-owner', ?, 'active')").run(new Date().toISOString());
  const answers = { "Recipient's name": "Maya", "Your relationship to them": "daughter", Occasion: "Birthday", "Song style": "Acoustic", "A specific memory or message": "The jetty" };
  const receipt = { receipt_id: 123, status: "paid", is_paid: true, refunds: [], transactions: [{ transaction_id: 456, listing_id: 789, quantity: 1, variations: Object.entries(answers).map(([formatted_name, formatted_value]) => ({ property_id: 54, formatted_name, formatted_value })) }] };
  const payment = { receipt_id: 123, shop_id: 99, status: "settled", payment_adjustments: [] };
  const app = Fastify();
  const { etsyMtoRepository: repository, etsyMtoService: service } = registerEtsyMtoPipeline({
    app, db, appConfig: { ETSY_MTO_OWNER_ID: "etsy-owner" },
    etsyClient: { configured: true, getReceipt: async () => receipt, getPaymentByReceiptId: async () => payment },
    etsyArtifactService: { repairForOrder: async () => ({ ready: true }) },
    trackVersionRepository: createTrackVersionRepository(db),
    newUuid: crypto.randomUUID, nowIso: () => new Date().toISOString(), toJson: JSON.stringify,
    computeParamsHash: () => "params", publicBaseUrl: "http://localhost",
    generateLyrics: async () => ({ lyrics }), extractLyricsText: (value) => value,
    moderationCheck, validateGeneratedLyrics,
  });
  let bytes = Buffer.alloc(2048, 1);
  registerAdminEtsyMtoRoutes(app, {
    repository, service, pipeline: app.etsyMtoPipeline, orderFiles: app.etsyOrderFiles,
    storageProvider: { downloadToFile: async ({ filePath }) => fs.writeFile(filePath, bytes) },
    requireAdminRole: async () => ({ adminId: "test-admin" }), auditService: { auditOnce: async () => {} },
    sendError: (reply, status, error, message) => reply.code(status).send({ error, message }),
  });
  await app.ready();
  t.after(async () => { await app.close(); await db.close(); });
  return { app, db, repository, receipt, payment, corrupt: () => { bytes = Buffer.alloc(2048, 2); } };
}

test("integrated JSON import creates one render job, exposes verified MP3 and records Etsy attestation", async (t) => {
  const f = await fixture(t);
  const exported = await f.app.inject({ method: "GET", url: "/admin/dashboard/etsy/mto/export/123" });
  assert.equal(exported.statusCode, 200);
  const imported = await f.app.inject({ method: "POST", url: "/admin/dashboard/etsy/mto/import", headers: { "idempotency-key": "integration-1" }, payload: { file: exported.body, acknowledged: true } });
  assert.equal(imported.statusCode, 202);
  await f.app.etsyMtoPipeline.processDue();
  let item = (await f.repository.listItems())[0];
  assert.equal(item.state, "rendering", item.last_error);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 1);
  assert.equal(f.db.prepare("SELECT etsy_mto_item_id FROM tracks").get().etsy_mto_item_id, item.id);
  f.db.prepare("UPDATE track_versions SET lyrics_json = ? WHERE id = ?").run(JSON.stringify({ title: "The jetty", sections: [{ lines: ["Maya, remember", "The sea"] }] }), item.track_version_id);
  assert.equal(await f.repository.readLyrics(item.id), "The jetty\n\nMaya, remember\nThe sea");
  f.db.prepare("UPDATE track_versions SET status = 'full_ready' WHERE id = ?").run(item.track_version_id);
  const digest = crypto.createHash("sha256").update(Buffer.alloc(2048, 1)).digest("hex");
  f.db.prepare("INSERT INTO track_artifacts (id,track_version_id,kind,status,storage_key,byte_length,sha256,created_at,updated_at) VALUES ('artifact',?,'full_mp3','ready','test.mp3',2048,?,?,?)").run(item.track_version_id, digest, new Date().toISOString(), new Date().toISOString());
  await f.app.etsyMtoPipeline.processDue();
  item = (await f.repository.listItems())[0];
  assert.equal(item.state, "ready_for_etsy_upload");
  const url = `/admin/dashboard/etsy/mto/${item.id}`;
  assert.equal((await f.app.inject({ method: "GET", url: `${url}/mp3` })).statusCode, 200);
  f.corrupt();
  assert.equal((await f.app.inject({ method: "GET", url: `${url}/mp3` })).json().error, "ETSY_MTO_ARTIFACT_MISMATCH");
  const payload = { receipt_id: "123", acknowledged: true, evidence_reference: "restricted://etsy-confirmation" };
  const headers = { "idempotency-key": "attest-integration" };
  f.payment.payment_adjustments.push({ total_adjustment_amount: 1 });
  assert.equal((await f.app.inject({ method: "GET", url: `${url}/mp3` })).json().error, "ETSY_ORDER_REFUNDED");
  assert.equal((await f.app.inject({ method: "POST", url: `${url}/attest-completion`, headers, payload })).json().error, "ETSY_ORDER_REFUNDED");
  f.payment.payment_adjustments = [];
  const completed = await f.app.inject({ method: "POST", url: `${url}/attest-completion`, headers, payload });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().item.state, "etsy_completion_attested");
});

test("missing recipient anchor blocks automatic rendering and preserves linked production resources", async (t) => {
  const f = await fixture(t, "Remember the jetty");
  const file = JSON.stringify(await f.app.etsyOrderFiles.exportOrder("123"));
  await f.app.etsyMtoPipeline.importOrder(file, true, "missing-anchor");
  await f.app.etsyMtoPipeline.processDue();
  const item = (await f.repository.listItems())[0];
  assert.equal(item.state, "needs_attention");
  assert.equal(item.last_error, "GENERATION_BLOCKED");
  assert.ok(item.track_id);
  assert.ok(item.track_version_id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 0);
});

test("retired redemption mode cannot run alongside JSON fulfilment", async (t) => {
  const f = await fixture(t);
  await setFeatureFlag(f.db, "etsy_fulfilment_mode", "api");
  try {
    await assert.rejects(f.app.etsyMtoPipeline.preview("{}"), { code: "ETSY_MTO_UNCONFIGURED" });
    assert.equal((await f.repository.listItems()).length, 0);
  } finally {
    await setFeatureFlag(f.db, "etsy_fulfilment_mode", "off");
  }
});

test("failed render job moves the unit to attention without another provider submission", async (t) => {
  const f = await fixture(t);
  await f.app.etsyMtoPipeline.importOrder(JSON.stringify(await f.app.etsyOrderFiles.exportOrder("123")), true, "job-failure");
  await f.app.etsyMtoPipeline.processDue();
  f.db.prepare("UPDATE jobs SET status='failed'").run();
  await f.app.etsyMtoPipeline.processDue();
  const item = (await f.repository.listItems())[0];
  assert.equal(item.state, "needs_attention");
  assert.equal(item.last_error, "ETSY_RENDER_FAILED");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 1);
});

test("retrying a failed render resumes its linked job without creating a new song", async (t) => {
  const f = await fixture(t);
  await f.app.etsyMtoPipeline.importOrder(JSON.stringify(await f.app.etsyOrderFiles.exportOrder("123")), true, "retry-render-import");
  await f.app.etsyMtoPipeline.processDue();
  const before = (await f.repository.listItems())[0];
  const job = f.db.prepare("SELECT * FROM jobs WHERE track_version_id = ?").get(before.track_version_id);
  f.db.prepare("UPDATE jobs SET status = 'failed', step = 'generate_audio', step_index = 4, attempts = 3, error_code = 'SUNO_AUDIO_FETCH_FAILED', error_message = 'provider failed', completed_at = ?, next_attempt_at = ?, locked_by = 'worker', locked_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), job.id);
  f.db.prepare("UPDATE track_versions SET status = 'failed' WHERE id = ?").run(before.track_version_id);
  await f.app.etsyMtoPipeline.processDue();

  const response = await f.app.inject({ method: "POST", url: `/admin/dashboard/etsy/mto/${before.id}/retry-render`, headers: { "idempotency-key": "retry-render-operation" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().item.state, "rendering");
  assert.equal(response.json().job.id, job.id);
  const after = await f.repository.findItemById({ itemId: before.id });
  const retriedJob = f.db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id);
  assert.equal(after.state, "rendering");
  assert.equal(after.last_error, null);
  assert.equal(f.db.prepare("SELECT status FROM track_versions WHERE id = ?").get(before.track_version_id).status, "processing");
  assert.equal(f.db.prepare("SELECT status FROM tracks WHERE id = ?").get(before.track_id).status, "rendering");
  assert.equal(retriedJob.status, "queued");
  assert.equal(retriedJob.step, "queued");
  assert.equal(retriedJob.step_index, 0);
  assert.equal(retriedJob.attempts, 0);
  assert.equal(retriedJob.error_code, null);
  assert.equal(retriedJob.error_message, null);
  assert.equal(retriedJob.next_attempt_at, null);
  assert.equal(retriedJob.locked_by, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE track_version_id = ?").get(before.track_version_id).n, 1);

  const replay = await f.app.inject({ method: "POST", url: `/admin/dashboard/etsy/mto/${before.id}/retry-render`, headers: { "idempotency-key": "retry-render-operation" } });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().job.id, job.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM etsy_mto_events WHERE etsy_mto_item_id = ? AND event_type = 'render_retry'").get(before.id).n, 1);
});
