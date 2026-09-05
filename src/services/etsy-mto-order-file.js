"use strict";

const { isDeepStrictEqual } = require("node:util");
const { z } = require("zod");
const { decode } = require("he");
const { getAllStyleKeys, getStyleDisplayMap, normalizeStyle } = require("../providers/style-registry");

const MAX_FILE_BYTES = 128 * 1024;
const MAX_ITEMS = 20;
const LABELS = Object.freeze({
  "Recipient's name": "recipient_name",
  "Your relationship to them": "relationship",
  Occasion: "occasion",
  "Song style": "style",
  "A specific memory or message": "specific_memory",
});
const BRIEF_KEYS = Object.values(LABELS);
const OCCASIONS = new Set([
  "birthday", "mothers_day", "anniversary", "thank_you", "i_love_you",
  "wedding", "graduation", "celebration", "apology", "encouragement",
  "advice", "bereavement", "friendship", "get_well", "custom",
]);
const STYLE_KEYS = new Set(getAllStyleKeys());
const STYLE_LABELS = new Map(Object.entries(getStyleDisplayMap()).map(([key, label]) => [label.toLowerCase(), key]));
const ID_SCHEMA = z.union([z.string(), z.number().int().safe()]).transform(String)
  .pipe(z.string().regex(/^[1-9][0-9]{0,18}$/))
  .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n));
const BRIEF_SCHEMA = z.strictObject(Object.fromEntries(BRIEF_KEYS.map((field) => [
  field, z.string().trim().min(1).max(field === "specific_memory" ? 1000 : 256),
])));
const ENVELOPE_SCHEMA = z.strictObject({
  schema_version: z.literal(1), exported_at: z.iso.datetime({ precision: 3 }),
  shop_id: z.string().pipe(ID_SCHEMA), receipt_id: z.string().pipe(ID_SCHEMA),
  items: z.array(z.strictObject({
    transaction_id: z.string().pipe(ID_SCHEMA), listing_id: z.string().pipe(ID_SCHEMA),
    quantity: z.literal(1), brief: BRIEF_SCHEMA,
  })).min(1).max(MAX_ITEMS),
});

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function id(value) {
  const result = ID_SCHEMA.safeParse(value);
  if (!result.success) {
    fail("INVALID_ETSY_ORDER_ID", "Etsy IDs must be positive int64 values.");
  }
  return result.data;
}

function normalizeBrief(brief) {
  const parsed = BRIEF_SCHEMA.safeParse(brief);
  if (!parsed.success) fail("INVALID_ETSY_BRIEF", "Provide exactly five text answers, at most 256 characters each and 1000 for the memory.");
  const result = parsed.data;
  result.style = STYLE_LABELS.get(result.style.toLowerCase()) || normalizeStyle(result.style);
  if (!STYLE_KEYS.has(result.style)) fail("INVALID_ETSY_STYLE", "Etsy song style is not in the Porizo catalog.");
  result.occasion = result.occasion.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "_");
  if (!OCCASIONS.has(result.occasion)) fail("INVALID_ETSY_OCCASION", "Etsy occasion is not in the Porizo catalog.");
  return result;
}

function readPersonalization(transaction) {
  if (!Array.isArray(transaction.variations)) fail("ETSY_PERSONALIZATION_UNAVAILABLE", "Etsy personalization is unavailable.");
  const brief = {};
  for (const variation of transaction.variations) {
    if (Number(variation.property_id) !== 54) continue;
    const text = z.object({ formatted_name: z.string(), formatted_value: z.string() }).safeParse(variation);
    if (!text.success) fail("ETSY_PERSONALIZATION_UNAVAILABLE", "Etsy personalization answers must be text.");
    const name = decode(text.data.formatted_name);
    const field = LABELS[name];
    if (!Object.hasOwn(LABELS, name) || Object.hasOwn(brief, field)) {
      fail("ETSY_PERSONALIZATION_AMBIGUOUS", "Etsy personalization labels are unknown or duplicated.");
    }
    brief[field] = decode(text.data.formatted_value);
  }
  return normalizeBrief(brief);
}

function checkReceipt(receipt, shopId, receiptId) {
  if (!receipt || id(receipt.receipt_id) !== receiptId) fail("ETSY_RECEIPT_MISMATCH", "Etsy returned a different order.");
  if (receipt.shop_id !== undefined && id(receipt.shop_id) !== shopId) fail("ETSY_SHOP_MISMATCH", "Etsy order belongs to another shop.");
  const status = String(receipt.status).toLowerCase();
  if (receipt.is_paid !== true || !["paid", "completed", "open", "processing"].includes(status)
    || receipt.is_canceled === true || receipt.is_cancelled === true) {
    fail("ETSY_ORDER_NOT_PAID", "Etsy order is not confirmed paid and active.");
  }
  if (receipt.refunds !== undefined && (!Array.isArray(receipt.refunds) || receipt.refunds.length > 0)) {
    fail("ETSY_ORDER_REFUNDED", "Refunded Etsy orders cannot generate songs.");
  }
}

function checkPayment(payload, shopId, receiptId) {
  const payments = Array.isArray(payload?.results) ? payload.results : [payload];
  if (payments.length !== 1 || !payments[0]) fail("ETSY_PAYMENT_UNVERIFIED", "One authoritative Etsy payment is required.");
  const payment = payments[0];
  if (id(payment.receipt_id) !== receiptId || id(payment.shop_id) !== shopId) {
    fail("ETSY_PAYMENT_MISMATCH", "Etsy payment does not match the shop and order.");
  }
  if (String(payment.status).toLowerCase() !== "settled") fail("ETSY_PAYMENT_UNVERIFIED", "Etsy payment must be settled before generation.");
  if (!Array.isArray(payment.payment_adjustments)) fail("ETSY_PAYMENT_UNVERIFIED", "Etsy refund evidence is unavailable.");
  if (payment.payment_adjustments.length > 0) fail("ETSY_ORDER_REFUNDED", "Adjusted Etsy payments require operator review.");
}

function readItems(receipt, allowed) {
  if (!Array.isArray(receipt.transactions)) fail("ETSY_TRANSACTIONS_UNAVAILABLE", "Etsy transactions are unavailable.");
  const items = [];
  const seen = new Set();
  for (const transaction of receipt.transactions) {
    const listingId = id(transaction.listing_id);
    if (!allowed.has(listingId)) continue;
    const transactionId = id(transaction.transaction_id);
    if (seen.has(transactionId)) fail("ETSY_TRANSACTION_DUPLICATE", "Duplicate Etsy transaction.");
    seen.add(transactionId);
    if (transaction.quantity !== 1) fail("ETSY_QUANTITY_UNSUPPORTED", "Each personalized Etsy transaction must contain exactly one song.");
    items.push({ transaction_id: transactionId, listing_id: listingId, quantity: 1, brief: readPersonalization(transaction) });
  }
  if (!items.length || items.length > MAX_ITEMS) fail("ETSY_ITEMS_INVALID", "Order must contain between one and twenty eligible songs.");
  return items.sort((left, right) => left.transaction_id.localeCompare(right.transaction_id));
}

function parseItem(item) {
  if (!isDeepStrictEqual(item.brief, normalizeBrief(item.brief))) fail("INVALID_ETSY_ORDER_FILE", "JSON answers must use the exported canonical values.");
}

function parseFile(fileText) {
  if (!z.string().safeParse(fileText).success || Buffer.byteLength(fileText, "utf8") > MAX_FILE_BYTES) {
    fail("INVALID_ETSY_ORDER_FILE", "Order file must be JSON text no larger than 128 KiB.");
  }
  let file;
  try { file = JSON.parse(fileText); } catch { fail("INVALID_ETSY_ORDER_FILE", "Order file is not valid JSON."); }
  if (!ENVELOPE_SCHEMA.safeParse(file).success) fail("INVALID_ETSY_ORDER_FILE", "Order file does not match the version 1 export contract.");
  file.items.forEach(parseItem);
  return file;
}

function createEtsyOrderFileService({ client, shopId, listingIds, now = () => new Date().toISOString() }) {
  function configuration() {
    if (!shopId || !Array.isArray(listingIds) || !listingIds.length || client?.configured === false
      || !z.object({ getReceipt: z.function(), getPaymentByReceiptId: z.function() }).safeParse(client).success) {
      fail("ETSY_API_UNCONFIGURED", "Configure the authenticated Etsy client, shop and eligible listings before exporting orders.");
    }
    return { configuredShopId: id(shopId), allowed: new Set(listingIds.map(id)) };
  }

  async function exportOrder(receiptId) {
    const { configuredShopId, allowed } = configuration();
    const normalizedId = id(receiptId);
    const [receipt, payment] = await Promise.all([client.getReceipt(normalizedId), client.getPaymentByReceiptId(normalizedId)]);
    checkReceipt(receipt, configuredShopId, normalizedId);
    checkPayment(payment, configuredShopId, normalizedId);
    const envelope = {
      schema_version: 1, exported_at: now(), shop_id: configuredShopId,
      receipt_id: normalizedId, items: readItems(receipt, allowed),
    };
    parseFile(JSON.stringify(envelope));
    return envelope;
  }

  async function verifyFile(fileText) {
    const { configuredShopId } = configuration();
    const file = parseFile(fileText);
    if (file.shop_id !== configuredShopId) fail("ETSY_SHOP_MISMATCH", "Uploaded order belongs to another shop.");
    const current = await exportOrder(file.receipt_id);
    if (!isDeepStrictEqual(file.items, current.items)) fail("ETSY_ORDER_FILE_STALE", "Uploaded order details changed or were modified. Export the current Etsy order again.");
    return current;
  }

  return { exportOrder, verifyFile };
}

module.exports = { createEtsyOrderFileService, normalizeBrief };
