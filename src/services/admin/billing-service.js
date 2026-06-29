"use strict";

const { safeBounds } = require("./pagination");

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return null;
}

function normalizeCurrency(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toUpperCase();
}

function extractReceiptMoney(row, productCatalog) {
  const payload = parseMaybeJson(row.verification_response) || {};
  const rawTransaction =
    payload.transactionInfo ||
    payload.transaction_info ||
    payload.apple_transaction ||
    payload.raw?.transactionInfo ||
    payload._raw?.transactionInfo ||
    {};
  const currency = normalizeCurrency(
    payload.currency ||
      payload.currency_code ||
      rawTransaction.currency ||
      row.currency,
  );
  const priceMillis = firstFiniteNumber(
    payload.price_millis,
    payload.apple_price_millis,
    rawTransaction.price,
  );

  if (currency && priceMillis !== null) {
    return {
      amount: priceMillis / 1000,
      currency,
      amount_source: "apple_receipt",
    };
  }

  const directAmount = firstFiniteNumber(payload.amount, payload.amount_paid);
  if (currency && directAmount !== null) {
    return {
      amount: directAmount,
      currency,
      amount_source: "receipt_amount",
    };
  }

  const catalogEntry = productCatalog.get(row.product_id);
  if (catalogEntry?.amount != null) {
    return {
      amount: catalogEntry.amount,
      currency: catalogEntry.currency,
      amount_source: "product_catalog",
    };
  }

  return {
    amount: null,
    currency: null,
    amount_source: "unknown",
  };
}

function isCurrentSubscriberStatus(status) {
  return ["active", "grace_period", "billing_retry"].includes(status);
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentSubscription(
  { status, expiresAt, gracePeriodExpiresAt },
  nowMs,
) {
  if (!isCurrentSubscriberStatus(status)) return false;

  const gracePeriodMs = parseTimestampMs(gracePeriodExpiresAt);
  if (gracePeriodMs !== null && gracePeriodMs > nowMs) {
    return true;
  }

  const expiresMs = parseTimestampMs(expiresAt);
  if (expiresMs === null) {
    return true;
  }

  return expiresMs > nowMs;
}

function normalizeSaleType(row) {
  if (
    row.gift_wallet_transaction_id ||
    String(row.product_id || "").includes("gift")
  ) {
    return "gift";
  }
  if (
    row.subscription_id ||
    String(row.product_id || "").includes("monthly") ||
    String(row.product_id || "").includes("annual")
  ) {
    return "subscription";
  }
  return "purchase";
}

function isCountedPaidSale(sale) {
  if (sale.is_trial) return false;
  if (sale.amount === 0) return false;
  return true;
}

function isPositivePaidSale(sale) {
  return !sale.is_trial && sale.amount != null && sale.amount > 0;
}

function addRevenueBucket(buckets, sale) {
  if (sale.amount == null || !sale.currency) return false;
  const existing = buckets.get(sale.currency) || {
    currency: sale.currency,
    amount: 0,
    count: 0,
  };
  existing.amount += sale.amount;
  existing.count += 1;
  buckets.set(sale.currency, existing);
  return true;
}

function serializeRevenueBuckets(buckets) {
  return Array.from(buckets.values()).sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}

function singleCurrencyAmount(buckets) {
  if (buckets.length === 0) {
    return 0;
  }
  if (buckets.length !== 1) {
    return null;
  }
  return buckets[0].amount;
}

function createSalesSummaryAccumulator() {
  return {
    totalSalesCount: 0,
    subscriptionSalesCount: 0,
    giftSalesCount: 0,
    giftTokensGranted: 0,
    payingUserIds: new Set(),
    revenueBuckets: new Map(),
    subscriptionRevenueBuckets: new Map(),
    giftRevenueBuckets: new Map(),
    unknownAmountCount: 0,
  };
}

function addSaleToSummary(summary, sale) {
  if (!isCountedPaidSale(sale)) return;

  summary.totalSalesCount += 1;
  if (sale.sale_type === "subscription") {
    summary.subscriptionSalesCount += 1;
  }
  if (sale.sale_type === "gift") {
    summary.giftSalesCount += 1;
    summary.giftTokensGranted += sale.gift_tokens_granted || 0;
  }
  if (isPositivePaidSale(sale)) {
    summary.payingUserIds.add(sale.user_id);
  }

  const hasKnownRevenue = addRevenueBucket(summary.revenueBuckets, sale);
  if (!hasKnownRevenue) {
    summary.unknownAmountCount += 1;
  } else if (sale.sale_type === "subscription") {
    addRevenueBucket(summary.subscriptionRevenueBuckets, sale);
  } else if (sale.sale_type === "gift") {
    addRevenueBucket(summary.giftRevenueBuckets, sale);
  }
}

function finalizeSalesSummary(summary, activeSubscriberCount) {
  return {
    totalSalesCount: summary.totalSalesCount,
    subscriptionSalesCount: summary.subscriptionSalesCount,
    giftSalesCount: summary.giftSalesCount,
    giftTokensGranted: summary.giftTokensGranted,
    payingUsers: summary.payingUserIds.size,
    activeSubscriberCount,
    revenueByCurrency: serializeRevenueBuckets(summary.revenueBuckets),
    subscriptionRevenueByCurrency: serializeRevenueBuckets(
      summary.subscriptionRevenueBuckets,
    ),
    giftRevenueByCurrency: serializeRevenueBuckets(summary.giftRevenueBuckets),
    unknownAmountCount: summary.unknownAmountCount,
  };
}

function createAdminBillingService({
  adminBillingRepository,
  now = () => new Date(),
}) {
  if (!adminBillingRepository) {
    throw new Error("adminBillingRepository is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  function nowIso() {
    return nowDate().toISOString();
  }

  function nowMs() {
    return nowDate().getTime();
  }

  function clampDays(days) {
    const n = Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : 30;
    return Math.max(1, Math.min(365, n));
  }

  function parseSalesPeriod(days) {
    if (String(days || "").toLowerCase() === "all") {
      return {
        days: "all",
        label: "all_time",
        since: null,
      };
    }

    const clampedDays = clampDays(days);
    return {
      days: clampedDays,
      label: `${clampedDays}_days`,
      since: new Date(nowMs() - clampedDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async function getProductCatalog() {
    const catalog = new Map();

    const giftBundles = await adminBillingRepository.listGiftBundleProducts();
    for (const bundle of giftBundles) {
      catalog.set(bundle.product_id, {
        display_name: bundle.display_name,
        amount: bundle.price_cents == null ? null : Number(bundle.price_cents) / 100,
        currency: "USD",
        source: "gift_bundles",
      });
    }

    const planProducts = await adminBillingRepository.listPlanProducts();
    for (const product of planProducts) {
      const priceCents =
        product.billing_period === "annual"
          ? product.price_annual_cents
          : product.price_monthly_cents;
      catalog.set(product.product_id, {
        display_name: [product.name, product.billing_period]
          .filter(Boolean)
          .join(" "),
        tier: product.tier,
        amount: priceCents == null ? null : Number(priceCents) / 100,
        currency: "USD",
        source: "subscription_plans",
      });
    }

    return catalog;
  }

  async function getReceiptSaleRows(period, { limit = 50, offset = 0 } = {}) {
    return adminBillingRepository.listReceiptSaleRows({
      since: period.since,
      limit,
      offset,
    });
  }

  function normalizeReceiptSale(row, productCatalog) {
    const catalogEntry = productCatalog.get(row.product_id);
    const money = extractReceiptMoney(row, productCatalog);
    const saleType = normalizeSaleType(row);
    const userEmail = row.primary_email || row.user_email || null;
    const subscriptionExpiresAt = row.subscription_expires_at || row.expires_date || null;

    return {
      id: row.id,
      user_id: row.user_id,
      user_email: userEmail,
      user_display_name: row.user_display_name || null,
      sale_type: saleType,
      product_id: row.product_id,
      product_name: catalogEntry?.display_name || row.product_id,
      platform: row.platform,
      transaction_id: row.transaction_id,
      original_transaction_id: row.original_transaction_id,
      purchase_date: row.purchase_date,
      created_at: row.created_at,
      amount: money.amount,
      currency: money.currency,
      amount_source: money.amount_source,
      gift_tokens_granted:
        row.gift_tokens_granted == null ? null : Number(row.gift_tokens_granted),
      is_trial: Boolean(row.is_trial),
      subscription_id: row.subscription_id || null,
      subscription_status: row.subscription_status || null,
      subscription_tier: row.subscription_tier || catalogEntry?.tier || null,
      subscription_expires_at: subscriptionExpiresAt,
      auto_renew_enabled: Boolean(row.auto_renew_enabled),
      is_current_subscriber: isCurrentSubscription(
        {
          status: row.subscription_status,
          expiresAt: subscriptionExpiresAt,
          gracePeriodExpiresAt: row.subscription_grace_period_expires_at,
        },
        nowMs(),
      ),
    };
  }

  function normalizeCurrentSubscriber(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      user_email: row.primary_email || row.user_email || null,
      user_display_name: row.user_display_name || null,
      product_id: row.product_id,
      tier: row.tier,
      status: row.status,
      platform: row.platform,
      original_transaction_id: row.original_transaction_id,
      latest_transaction_id: row.latest_transaction_id,
      original_purchase_date: row.original_purchase_date,
      expires_at: row.expires_at,
      auto_renew_enabled: Boolean(row.auto_renew_enabled),
      grace_period_expires_at: row.grace_period_expires_at,
      cancelled_at: row.cancelled_at,
      updated_at: row.updated_at,
    };
  }

  async function getReceiptSalesPage(period, productCatalog, { limit, offset }) {
    const sales = [];
    const scanLimit = Math.max(limit, 100);
    let scanOffset = 0;
    let countedOffset = 0;

    while (sales.length < limit) {
      const rows = await getReceiptSaleRows(period, {
        limit: scanLimit,
        offset: scanOffset,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const sale = normalizeReceiptSale(row, productCatalog);
        if (!isCountedPaidSale(sale)) continue;
        if (countedOffset < offset) {
          countedOffset += 1;
          continue;
        }
        sales.push(sale);
        if (sales.length >= limit) break;
      }

      scanOffset += rows.length;
      if (rows.length < scanLimit) break;
    }

    return sales;
  }

  async function countCurrentSubscribers() {
    return adminBillingRepository.countCurrentSubscribers({ now: nowIso() });
  }

  async function getCurrentSubscribers(limit = 50) {
    return adminBillingRepository.listCurrentSubscribers({
      now: nowIso(),
      limit,
    });
  }

  async function buildBillingSalesSummary(period, productCatalog) {
    const summary = createSalesSummaryAccumulator();
    const scanLimit = 1000;
    let scanOffset = 0;

    while (true) {
      const rows = await getReceiptSaleRows(period, {
        limit: scanLimit,
        offset: scanOffset,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        addSaleToSummary(summary, normalizeReceiptSale(row, productCatalog));
      }

      scanOffset += rows.length;
      if (rows.length < scanLimit) break;
    }

    const activeSubscriberCount = await countCurrentSubscribers();
    return finalizeSalesSummary(summary, activeSubscriberCount);
  }

  async function getBillingSales({ days = 30, limit = 50, offset = 0 } = {}) {
    const period = parseSalesPeriod(days);
    const bounds = safeBounds(limit, offset, 200);
    const productCatalog = await getProductCatalog();

    const summary = await buildBillingSalesSummary(period, productCatalog);
    const recentSales = await getReceiptSalesPage(period, productCatalog, bounds);
    const currentSubscribers = (await getCurrentSubscribers(100)).map(
      (row) => normalizeCurrentSubscriber(row),
    );

    return {
      period,
      summary,
      recentSales,
      currentSubscribers,
      pagination: {
        limit: bounds.limit,
        offset: bounds.offset,
        returned: recentSales.length,
      },
    };
  }

  async function getRevenueMetrics(days = 30) {
    const sales = await getBillingSales({ days, limit: 5000, offset: 0 });
    const totalRevenue = singleCurrencyAmount(sales.summary.revenueByCurrency);
    const subscriptionRevenue = singleCurrencyAmount(
      sales.summary.subscriptionRevenueByCurrency,
    );
    const giftRevenue = singleCurrencyAmount(sales.summary.giftRevenueByCurrency);
    const period = parseSalesPeriod(days);

    const subscriptionsByTier =
      await adminBillingRepository.listSubscriptionsByTierSince({
        since: period.since,
      });

    const trialData =
      await adminBillingRepository.getTrialConversionStatsSince({
        since: period.since,
      });

    const cancellations =
      await adminBillingRepository.countCancelledSubscriptionsSince({
        since: period.since,
      });

    const activeSubscriptions =
      await adminBillingRepository.countActiveSubscriptions();

    const churnRate =
      activeSubscriptions > 0
        ? ((cancellations / activeSubscriptions) * 100).toFixed(2)
        : "0.00";

    return {
      totalRevenue,
      subscriptionRevenue,
      songPurchases: giftRevenue,
      hasMixedRevenueCurrencies: sales.summary.revenueByCurrency.length > 1,
      payingUsers: sales.summary.payingUsers,
      subscriptionsByTier,
      trialCount: trialData.current_trials || 0,
      trialConversions: trialData.converted_trials || 0,
      cancellations,
      churnRate,
      salesCount: sales.summary.totalSalesCount,
      giftSalesCount: sales.summary.giftSalesCount,
      subscriptionSalesCount: sales.summary.subscriptionSalesCount,
      revenueByCurrency: sales.summary.revenueByCurrency,
      unknownAmountCount: sales.summary.unknownAmountCount,
    };
  }

  async function getSubscriptionHealth() {
    const nowValue = nowMs();
    const health = await adminBillingRepository.getSubscriptionHealthCounts({
      now: new Date(nowValue).toISOString(),
      weekFromNow: new Date(nowValue + 7 * 24 * 60 * 60 * 1000).toISOString(),
      weekAgo: new Date(nowValue - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    return {
      activeSubscriptions: health.activeSubscriptions,
      totalActive: health.activeSubscriptions.reduce(
        (sum, t) => sum + t.count,
        0,
      ),
      trialCount: health.trialCount,
      expiringThisWeek: health.expiringThisWeek,
      recentCancellations: health.recentCancellations,
      inGracePeriod: health.inGracePeriod,
    };
  }

  async function getBillingTransactions({ limit = 50, offset = 0 } = {}) {
    const sales = await getBillingSales({ days: "all", limit, offset });
    return sales.recentSales.map((sale) => ({
      id: sale.id,
      user_id: sale.user_id,
      user_email: sale.user_email,
      type: sale.sale_type,
      amount: sale.amount ?? 0,
      currency: sale.currency,
      product_id: sale.product_id,
      transaction_id: sale.transaction_id,
      created_at: sale.purchase_date || sale.created_at,
      sale,
    }));
  }

  return {
    getBillingSales,
    getBillingTransactions,
    getRevenueMetrics,
    getSubscriptionHealth,
  };
}

module.exports = {
  createAdminBillingService,
};
