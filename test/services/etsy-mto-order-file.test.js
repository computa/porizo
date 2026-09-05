"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEtsyOrderFileService, normalizeBrief } = require("../../src/services/etsy-mto-order-file");
const { getStyleDisplayMap } = require("../../src/providers/style-registry");

const answers = {
  "Recipient's name": " Ada ",
  "Your relationship to them": "My sister",
  Occasion: "Mother's Day",
  "Song style": "Afrobeats",
  "A specific memory or message": "Our trip\nto the sea",
};

test("missing Etsy configuration disables operations without crashing server construction", async () => {
  const service = createEtsyOrderFileService({ client: { configured: false } });
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_API_UNCONFIGURED" });
  await assert.rejects(service.verifyFile("{}"), { code: "ETSY_API_UNCONFIGURED" });
});

function fixture() {
  const transaction = {
    transaction_id: 456, listing_id: 789, quantity: 1,
    variations: Object.entries(answers).map(([formatted_name, formatted_value]) => ({ property_id: 54, formatted_name, formatted_value })),
  };
  const receipt = { receipt_id: 123, is_paid: true, status: "paid", transactions: [transaction], refunds: [] };
  const payment = { receipt_id: 123, shop_id: 99, status: "settled", payment_adjustments: [] };
  const calls = [];
  const client = {
    async getReceipt(receiptId) { calls.push(["receipt", receiptId]); return receipt; },
    async getPaymentByReceiptId(receiptId) { calls.push(["payment", receiptId]); return { count: 1, results: [payment] }; },
  };
  const service = createEtsyOrderFileService({ client, shopId: "99", listingIds: ["789"], now: () => "2026-09-05T01:00:00.000Z" });
  return { receipt, transaction, payment, client, calls, service };
}

test("exports paid eligible item with canonical catalog choices and preserved newlines", async () => {
  const { service, calls } = fixture();
  const file = await service.exportOrder("123");
  assert.deepEqual(file, {
    schema_version: 1, exported_at: "2026-09-05T01:00:00.000Z", shop_id: "99", receipt_id: "123",
    items: [{ transaction_id: "456", listing_id: "789", quantity: 1, brief: {
      recipient_name: "Ada", relationship: "My sister", occasion: "mothers_day", style: "afrobeats", specific_memory: "Our trip\nto the sea",
    } }],
  });
  assert.deepEqual(calls, [["receipt", "123"], ["payment", "123"]]);
  assert.equal(JSON.stringify(file).includes("buyer_email"), false);
});

test("decodes Etsy HTML entities once before matching questions and normalizing answers", async () => {
  const { service, transaction } = fixture();
  transaction.variations[0].formatted_name = "Recipient&#39;s name";
  transaction.variations[0].formatted_value = "Zo&#235; &amp; Maya";
  transaction.variations[2].formatted_value = "Mother&#39;s Day";
  transaction.variations[3].formatted_value = "R&amp;B";
  transaction.variations[4].formatted_value = "You said &quot;hello&quot;.\nKeep the literal &amp;lt;heart&amp;gt;.";
  const file = await service.exportOrder("123");
  assert.equal(file.items[0].brief.recipient_name, "Zoë & Maya");
  assert.equal(file.items[0].brief.occasion, "mothers_day");
  assert.equal(file.items[0].brief.style, "rnb");
  assert.equal(file.items[0].brief.specific_memory, 'You said "hello".\nKeep the literal &lt;heart&gt;.');
  assert.deepEqual((await service.verifyFile(JSON.stringify(file))).items, file.items);
});

test("re-fetches payment and receipt on upload, allowing timestamp differences", async () => {
  const { service, calls } = fixture();
  const file = await service.exportOrder("123");
  file.exported_at = "2026-09-01T01:00:00.000Z";
  assert.equal((await service.verifyFile(JSON.stringify(file))).receipt_id, "123");
  assert.equal(calls.length, 4);
});

test("rejects edited answers and Etsy answers changed since export", async () => {
  const { service, transaction } = fixture();
  const file = await service.exportOrder("123");
  file.items[0].brief.recipient_name = "Not Ada";
  await assert.rejects(service.verifyFile(JSON.stringify(file)), { code: "ETSY_ORDER_FILE_STALE" });
  file.items[0].brief.recipient_name = "Ada";
  transaction.variations[0].formatted_value = "Another recipient";
  await assert.rejects(service.verifyFile(JSON.stringify(file)), { code: "ETSY_ORDER_FILE_STALE" });
});

test("refund after export prevents generation even with untouched order file", async () => {
  const { service, payment } = fixture();
  const file = await service.exportOrder("123");
  payment.payment_adjustments.push({ is_success: true, total_adjustment_amount: 1 });
  await assert.rejects(service.verifyFile(JSON.stringify(file)), { code: "ETSY_ORDER_REFUNDED" });
});

test("fails closed for unpaid, canceled, refunded and unknown receipt statuses", async () => {
  for (const change of [{ is_paid: false }, { is_paid: "true" }, { status: "canceled" }, { status: "mystery" }, { is_canceled: true }, { refunds: [{}] }]) {
    const { service, receipt } = fixture();
    Object.assign(receipt, change);
    await assert.rejects(service.exportOrder("123"));
  }
});

test("requires settled payment, refund evidence and matching order/shop", async () => {
  for (const change of [{ status: "authed" }, { status: "" }, { payment_adjustments: undefined }, { shop_id: 100 }, { receipt_id: 124 }]) {
    const { service, payment } = fixture();
    Object.assign(payment, change);
    await assert.rejects(service.exportOrder("123"));
  }
  const { service, client } = fixture();
  client.getPaymentByReceiptId = async () => ({ results: [] });
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_PAYMENT_UNVERIFIED" });
});

test("accepts the direct payment shape as well as official results wrapper", async () => {
  const { service, client, payment } = fixture();
  client.getPaymentByReceiptId = async () => payment;
  assert.equal((await service.exportOrder("123")).items.length, 1);
});

test("accepts Etsy's uppercase settled payment status", async () => {
  const { service, payment } = fixture();
  payment.status = "SETTLED";
  assert.equal((await service.exportOrder("123")).receipt_id, "123");
});

test("only exports allowed listings and rejects missing eligible items", async () => {
  const { service, receipt, transaction } = fixture();
  receipt.transactions.push({ listing_id: 800, quantity: 1, transaction_id: 457 });
  assert.equal((await service.exportOrder("123")).items.length, 1);
  transaction.listing_id = 801;
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_ITEMS_INVALID" });
});

test("rejects ambiguous quantity, duplicate transactions and excessive item counts", async () => {
  for (const quantity of [0, 2, "1", undefined]) {
    const { service, transaction } = fixture();
    transaction.quantity = quantity;
    await assert.rejects(service.exportOrder("123"), { code: "ETSY_QUANTITY_UNSUPPORTED" });
  }
  const { service, receipt, transaction } = fixture();
  receipt.transactions.push(transaction);
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_TRANSACTION_DUPLICATE" });
  receipt.transactions = Array.from({ length: 21 }, (_, index) => ({ ...transaction, transaction_id: index + 1 }));
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_ITEMS_INVALID" });
});

test("all five exact labels are required; duplicate and unknown questions fail", async () => {
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push(values[0]),
    (values) => { values[0].formatted_name = "Personalization"; },
    (values) => { values[0].formatted_name = "__proto__"; },
  ]) {
    const { service, transaction } = fixture();
    mutate(transaction.variations);
    await assert.rejects(service.exportOrder("123"));
  }
});

test("accepts every canonical display style and all fifteen occasions", async () => {
  const { service } = fixture();
  const brief = (await service.exportOrder("123")).items[0].brief;
  for (const [style, label] of Object.entries(getStyleDisplayMap())) {
    assert.equal(normalizeBrief({ ...brief, style: label }).style, style);
  }
  for (const occasion of ["Birthday", "Mother's Day", "Anniversary", "Thank You", "I Love You", "Wedding", "Graduation", "Celebration", "Apology", "Encouragement", "Advice", "Bereavement", "Friendship", "Get Well", "Custom"]) {
    assert.ok(normalizeBrief({ ...brief, occasion }).occasion);
  }
  assert.throws(() => normalizeBrief({ ...brief, style: "not-a-style" }), { code: "INVALID_ETSY_STYLE" });
  assert.throws(() => normalizeBrief({ ...brief, occasion: "not-an-occasion" }), { code: "INVALID_ETSY_OCCASION" });
});

test("supports1000-character stories and256-character short answers without coercion", async () => {
  const { service } = fixture();
  const brief = (await service.exportOrder("123")).items[0].brief;
  assert.equal(normalizeBrief({ ...brief, specific_memory: "x".repeat(1000) }).specific_memory.length, 1000);
  assert.equal(normalizeBrief({ ...brief, recipient_name: "x".repeat(256) }).recipient_name.length, 256);
  for (const change of [{ specific_memory: "x".repeat(1001) }, { recipient_name: "x".repeat(257) }, { recipient_name: 123 }, { specific_memory: " " }, { extra: "field" }]) {
    assert.throws(() => normalizeBrief({ ...brief, ...change }), { code: "INVALID_ETSY_BRIEF" });
  }
});

test("rejects malformed, oversized, unknown-field and unsupported-version uploads before network", async () => {
  const { service, calls } = fixture();
  const file = await service.exportOrder("123");
  const invalid = ["{", "x".repeat(128 * 1024 + 1), "null", "[]", JSON.stringify({ ...file, paid: true }), JSON.stringify({ ...file, schema_version: 2 }), JSON.stringify({ ...file, exported_at: "today" }), JSON.stringify({ ...file, receipt_id: 123 }), JSON.stringify({ ...file, items: [] })];
  for (const text of invalid) await assert.rejects(service.verifyFile(text));
  assert.equal(calls.length, 2);
});

test("IDs cannot overflow, carry leading zeros or escape API path", async () => {
  const { service } = fixture();
  for (const receiptId of ["0", "0123", "../123", "123?x=1", 9007199254740992, "9223372036854775808", null]) {
    await assert.rejects(service.exportOrder(receiptId), { code: "INVALID_ETSY_ORDER_ID" });
  }
});

test("wrong-shop uploads and mismatched upstream receipt are refused", async () => {
  const { service, receipt } = fixture();
  const file = await service.exportOrder("123");
  await assert.rejects(service.verifyFile(JSON.stringify({ ...file, shop_id: "100" })), { code: "ETSY_SHOP_MISMATCH" });
  receipt.shop_id = 100;
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_SHOP_MISMATCH" });
  delete receipt.shop_id;
  receipt.receipt_id = 124;
  await assert.rejects(service.exportOrder("123"), { code: "ETSY_RECEIPT_MISMATCH" });
});
