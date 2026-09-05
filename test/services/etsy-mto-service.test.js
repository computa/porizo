"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { createEtsyMtoService } = require("../../src/services/etsy-mto-service");

const identity = {
  shopId: "shop-1", receiptId: "receipt-1", transactionId: "transaction-1",
  ordinal: 0, listingId: "listing-1",
};
const brief = {
  recipient_name: "Maya", occasion: "birthday", specific_memory: "Summer on the jetty",
  relationship: "daughter", style: "acoustic",
};

function fixture() {
  const items = new Map();
  const events = new Map();
  const calls = [];
  const repository = {
    assertClaim: async () => {},
    async createOrderAndItem({ order, item }) {
      const key = `${order.shopId}:${order.receiptId}:${item.transactionId}:${item.ordinal}`;
      if (!items.has(key)) items.set(key, { id: item.id, etsy_mto_order_id: order.id, ...item, receipt_id: order.receiptId, state: "received" });
      return { order, item: items.get(key) };
    },
    async findItemById({ itemId }) { return [...items.values()].find((item) => item.id === itemId); },
    async findEventByIdempotencyKey({ itemId, idempotencyKey }) { return events.get(`${itemId}:${idempotencyKey}`); },
    async recordIdempotencyEvent(event) {
      const key = `${event.itemId}:${event.idempotencyKey}`;
      if (events.has(key)) return { event: events.get(key), created: false };
      const stored = { ...event, request_hash: event.requestHash };
      events.set(key, stored);
      return { event: stored, created: true };
    },
    async linkTrack({ itemId, trackId, trackVersionId }) {
      const item = await this.findItemById({ itemId });
      Object.assign(item, { track_id: trackId, track_version_id: trackVersionId });
    },
    async transitionItem({ itemId, fromStates, state }) {
      const item = await this.findItemById({ itemId });
      if (!item || !fromStates.includes(item.state)) return { changes: 0 };
      item.state = state;
      return { changes: 1 };
    },
  };
  const service = createEtsyMtoService({
    repository,
    createTrack: async ({ item }) => { calls.push("track"); return { id: `track-${item.id}` }; },
    createTrackVersion: async ({ track }) => { calls.push("version"); return { id: `version-${track.id}` }; },
    createLyrics: async () => { calls.push("lyrics"); return { status: "moderated" }; },
    verifyPaidUnit: async () => true,
    fundRender: async () => { calls.push("fund"); },
    createRenderJob: async () => { calls.push("job"); return { id: "job-1" }; },
    findArtifact: async ({ item }) => item.artifact || null,
    now: () => "2026-09-05T00:00:00.000Z",
    idFactory: (prefix) => `${prefix}-${items.size + events.size + 1}`,
  });
  return { service, items, calls };
}

describe("Etsy MTO service", () => {
  test("validates the exact five-field brief before creating a unit", async () => {
    const { service, items } = fixture();
    await assert.rejects(
      service.intake({ identity, brief: { ...brief, pronunciation: "May-ah" }, evidenceReference: "restricted://receipt", idempotencyKey: "key-1" }),
      { code: "INVALID_ETSY_BRIEF" },
    );
    await assert.rejects(
      service.intake({ identity, brief: { ...brief, style: "anything-goes" }, evidenceReference: "restricted://receipt", idempotencyKey: "key-1" }),
      { code: "INVALID_ETSY_STYLE" },
    );
    assert.equal(items.size, 0);
  });

  test("creates one lyrics-review unit and replays matching unit identity without new content", async () => {
    const { service, calls } = fixture();
    const first = await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-1" });
    const replay = await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-2" });

    assert.equal(first.item.state, "lyrics_review");
    assert.equal(replay.item.id, first.item.id);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(calls, ["track", "version", "lyrics"]);
  });

  test("rejects a changed brief for an existing Etsy identity without mutation", async () => {
    const { service, calls } = fixture();
    await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-1" });
    await assert.rejects(
      service.intake({ identity, brief: { ...brief, specific_memory: "A changed memory" }, evidenceReference: "restricted://receipt", idempotencyKey: "intake-2" }),
      { code: "ETSY_UNIT_CONFLICT" },
    );
    assert.deepEqual(calls, ["track", "version", "lyrics"]);
  });

  test("only funds and enqueues exactly one render after lyrics approval", async () => {
    const { service, calls } = fixture();
    const intake = await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-1" });
    const approved = await service.approveLyrics({ itemId: intake.item.id, idempotencyKey: "approve-1" });
    const replay = await service.approveLyrics({ itemId: intake.item.id, idempotencyKey: "approve-1" });

    assert.equal(approved.item.state, "rendering");
    assert.equal(approved.job.id, "job-1");
    assert.equal(replay.idempotent, true);
    assert.deepEqual(calls, ["track", "version", "lyrics", "fund", "job"]);
  });

  test("promotes only a verified active MP3 artifact and attests its completion", async () => {
    const { service, items } = fixture();
    const intake = await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-1" });
    await service.approveLyrics({ itemId: intake.item.id, idempotencyKey: "approve-1" });
    const item = [...items.values()][0];
    item.artifact = {
      id: "artifact-1", track_version_id: item.track_version_id, status: "ready",
      storage_key: "tracks/full.mp3", sha256: "a".repeat(64), byte_length: 4096,
      kind: "full_mp3",
    };
    const ready = await service.reconcileArtifact({ itemId: item.id });
    const complete = await service.attestCompletion({
      itemId: item.id, receiptId: identity.receiptId, acknowledged: true,
      evidenceReference: "restricted://etsy/receipt-1", idempotencyKey: "complete-1",
    });
    const replay = await service.attestCompletion({
      itemId: item.id, receiptId: identity.receiptId, acknowledged: true,
      evidenceReference: "restricted://etsy/receipt-1", idempotencyKey: "complete-1",
    });

    assert.equal(ready.promoted, true);
    assert.equal(ready.item.state, "ready_for_etsy_upload");
    assert.equal(complete.item.state, "etsy_completion_attested");
    assert.equal(complete.artifact.id, "artifact-1");
    assert.equal(replay.idempotent, true);
  });

  test("does not promote invalid artifacts or attest a mismatched receipt", async () => {
    const { service, items } = fixture();
    const intake = await service.intake({ identity, brief, evidenceReference: "restricted://receipt", idempotencyKey: "intake-1" });
    await service.approveLyrics({ itemId: intake.item.id, idempotencyKey: "approve-1" });
    const item = [...items.values()][0];
    item.artifact = { track_version_id: item.track_version_id, status: "ready", storage_key: "x", sha256: "a".repeat(64), byte_length: 1023, kind: "full_mp3" };
    const reconciled = await service.reconcileArtifact({ itemId: item.id });
    assert.equal(reconciled.promoted, false);
    await assert.rejects(
      service.attestCompletion({ itemId: item.id, receiptId: "wrong", acknowledged: true, evidenceReference: "restricted://x", idempotencyKey: "complete-1" }),
      { code: "ETSY_COMPLETION_NOT_READY" },
    );
  });
});
