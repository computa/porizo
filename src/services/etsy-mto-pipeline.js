"use strict";

const crypto = require("node:crypto");

function briefHash(brief) {
  return crypto.createHash("sha256").update(JSON.stringify(brief)).digest("hex");
}

function unitsFor(order) {
  return order.items.map((item) => ({
    identity: {
      shopId: order.shop_id, receiptId: order.receipt_id,
      transactionId: item.transaction_id, listingId: item.listing_id, ordinal: 0,
    },
    brief: item.brief,
  }));
}

function conflict() {
  return Object.assign(new Error("This Etsy unit already has a different brief."), { code: "ETSY_UNIT_CONFLICT" });
}

function createEtsyMtoPipeline({ repository, orderFiles, production, assertConfigured, checkRender, recoverRender, now = () => new Date().toISOString() }) {
  async function inspectUnit(unit, target = repository) {
    const existing = await target.findItemByIdentity(unit.identity);
    if (existing && existing.raw_personalization_hash !== briefHash(unit.brief)) throw conflict();
    return { ...unit, status: existing ? "existing" : "new" };
  }

  async function preview(file) {
    await assertConfigured();
    const order = await orderFiles.verifyFile(file);
    const units = await Promise.all(unitsFor(order).map((unit) => inspectUnit(unit)));
    return { order, units };
  }

  async function importOrder(file, acknowledged, key) {
    if (acknowledged !== true) {
      throw Object.assign(new Error("Confirm generation before importing this paid order."), { code: "ETSY_IMPORT_ACKNOWLEDGEMENT_REQUIRED" });
    }
    const { order, units } = await preview(file);
    return repository.transaction(async (target) => {
      const timestamp = now();
      await target.insertOrderIfMissing({
        id: crypto.randomUUID(), shopId: order.shop_id, receiptId: order.receipt_id,
        createdAt: timestamp, updatedAt: timestamp,
      });
      const storedOrder = await target.findOrderByReceipt({ shopId: order.shop_id, receiptId: order.receipt_id, lock: true });
      const items = [];
      for (const unit of units) {
        await inspectUnit(unit, target);
        await target.insertItemIfMissing({
          id: crypto.randomUUID(), orderId: storedOrder.id,
          transactionId: unit.identity.transactionId, ordinal: 0,
          listingId: unit.identity.listingId, briefJson: JSON.stringify(unit.brief),
          rawPersonalizationHash: briefHash(unit.brief), createdAt: timestamp, updatedAt: timestamp,
        });
        const item = await target.findItemByIdentity(unit.identity);
        await target.recordIdempotencyEvent({
          id: crypto.randomUUID(), itemId: item.id, eventType: "file_imported",
          idempotencyKey: key, requestHash: briefHash(unit.brief), createdAt: timestamp,
        });
        items.push(item);
      }
      return { items };
    });
  }

  async function generate(item, leaseToken) {
    await verifyItem(item);
    await repository.assertClaim(item.id, leaseToken, now());
    await repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "verified_paid", updatedAt: now(), leaseToken });
    await production.intake({
      identity: { shopId: item.shop_id, receiptId: item.receipt_id, transactionId: item.transaction_id, listingId: item.listing_id, ordinal: item.ordinal },
      brief: JSON.parse(item.brief_json), evidenceReference: `etsy-api:${item.receipt_id}`,
      idempotencyKey: `generate-${item.id}`,
      leaseToken,
    });
    await production.approveLyrics({ itemId: item.id, idempotencyKey: `render-${item.id}`, leaseToken });
  }

  async function verifyItem(item) {
    await assertConfigured();
    if (item.financial_state !== "active") throw Object.assign(new Error("Order is not active."), { code: "ETSY_ORDER_NOT_PAID" });
    const order = await orderFiles.exportOrder(item.receipt_id);
    const current = order.items.find((unit) => unit.transaction_id === item.transaction_id && unit.listing_id === item.listing_id);
    if (order.shop_id !== item.shop_id || !current || briefHash(current.brief) !== item.raw_personalization_hash) throw conflict();
  }

  async function processItem(candidate) {
    const token = crypto.randomUUID();
    const timestamp = now();
    const until = new Date(Date.parse(timestamp) + 15 * 60_000).toISOString();
    if (!await repository.claimItem(candidate.id, token, timestamp, until)) return;
    try {
      const item = await repository.findItemById({ itemId: candidate.id });
      if (item.financial_state !== "active") throw Object.assign(new Error("Order is not active."), { code: "ETSY_ORDER_NOT_PAID" });
      if (item.state === "received") await generate(item, token);
      else if (item.state === "rendering") {
        await checkRender(item);
        await production.reconcileArtifact({ itemId: item.id });
      } else if (item.state === "lyrics_review" && await recoverRender(item)) {
        await repository.transitionItem({ itemId: item.id, fromStates: ["lyrics_review"], state: "rendering", updatedAt: now(), leaseToken: token });
      } else {
        throw Object.assign(new Error("Interrupted production needs review before retry."), { code: "ETSY_INTERRUPTED_PRODUCTION" });
      }
    } catch (error) {
      const code = /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "ETSY_PRODUCTION_FAILED";
      await repository.failItem(candidate.id, token, code, now());
    } finally {
      await repository.releaseItem(candidate.id, token, now());
    }
  }

  async function processDue() {
    const rows = await repository.listItems();
    const due = rows.filter((item) => ["received", "verified_paid", "lyrics_review", "rendering"].includes(item.state));
    for (const item of due.slice(0, 10)) await processItem(item);
  }

  async function retryFailedRender(itemId, idempotencyKey) {
    const item = await repository.findItemById({ itemId });
    if (!item) throw Object.assign(new Error("Etsy item was not found."), { code: "ETSY_MTO_NOT_FOUND" });
    const requestHash = briefHash({ operation: "retry_render" });
    const existing = await repository.findEventByIdempotencyKey({ itemId, idempotencyKey });
    if (!existing) await verifyItem(item);
    return repository.retryFailedRender({
      itemId,
      idempotencyKey,
      requestHash,
      eventId: crypto.randomUUID(),
      updatedAt: now(),
    });
  }

  return { preview, importOrder, processDue, verifyItem, retryFailedRender };
}

module.exports = { createEtsyMtoPipeline, briefHash };
