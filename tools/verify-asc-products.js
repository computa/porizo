#!/usr/bin/env node
/**
 * Verify ASC Product IDs
 *
 * Compares the product IDs in the backend plan_products table with the
 * expected App Store Connect product identifiers. Reports mismatches so
 * you can fix them before submission.
 *
 * Usage:
 *   node tools/verify-asc-products.js            # uses test DB
 *   NODE_ENV=production node tools/verify-asc-products.js  # uses prod DB
 */

const { getDatabase } = require("../src/database");

// Expected product IDs that must exist in App Store Connect
const EXPECTED_PRODUCTS = {
  apple: [
    { productId: "com.porizo.plus_monthly", tier: "plus", period: "monthly" },
    { productId: "com.porizo.plus_annual", tier: "plus", period: "annual" },
    { productId: "com.porizo.pro_monthly", tier: "pro", period: "monthly" },
    { productId: "com.porizo.pro_annual", tier: "pro", period: "annual" },
  ],
  google: [
    { productId: "com.porizo.plus_monthly", tier: "plus", period: "monthly" },
    { productId: "com.porizo.plus_annual", tier: "plus", period: "annual" },
    { productId: "com.porizo.pro_monthly", tier: "pro", period: "monthly" },
    { productId: "com.porizo.pro_annual", tier: "pro", period: "annual" },
  ],
};

async function main() {
  const db = await getDatabase();
  const env = process.env.NODE_ENV || "test";

  console.log(`\n=== ASC Product ID Verification (${env}) ===\n`);

  // Fetch plan_products from database
  const result = await db.query(`
    SELECT pp.product_id, pp.platform, pp.billing_period, pp.plan_id,
           sp.tier, sp.name AS plan_name, sp.is_active
    FROM plan_products pp
    JOIN subscription_plans sp ON sp.id = pp.plan_id
    ORDER BY pp.platform, sp.tier, pp.billing_period
  `);

  const dbProducts = result.rows;

  if (dbProducts.length === 0) {
    console.log("WARNING: No products found in plan_products table.");
    console.log("Run migrations or seed data first.\n");
    process.exit(1);
  }

  console.log("Database plan_products:");
  console.log("-".repeat(80));
  for (const row of dbProducts) {
    const active = row.is_active ? "active" : "INACTIVE";
    console.log(
      `  ${row.platform.padEnd(8)} ${row.product_id.padEnd(30)} ${row.tier.padEnd(6)} ${row.billing_period.padEnd(8)} [${active}]`
    );
  }
  console.log();

  // Cross-reference with expected products
  let mismatches = 0;

  for (const [platform, expected] of Object.entries(EXPECTED_PRODUCTS)) {
    console.log(`Checking ${platform} products:`);

    for (const exp of expected) {
      const found = dbProducts.find(
        (r) => r.platform === platform && r.product_id === exp.productId
      );

      if (!found) {
        console.log(`  MISSING: ${exp.productId} (${exp.tier} ${exp.period})`);
        mismatches++;
      } else if (found.tier !== exp.tier) {
        console.log(
          `  MISMATCH: ${exp.productId} tier=${found.tier}, expected ${exp.tier}`
        );
        mismatches++;
      } else if (found.billing_period !== exp.period) {
        console.log(
          `  MISMATCH: ${exp.productId} period=${found.billing_period}, expected ${exp.period}`
        );
        mismatches++;
      } else if (!found.is_active) {
        console.log(`  WARN: ${exp.productId} exists but plan is INACTIVE`);
      } else {
        console.log(`  OK: ${exp.productId}`);
      }
    }

    // Check for unexpected products in DB
    const platformProducts = dbProducts.filter((r) => r.platform === platform);
    for (const dbProd of platformProducts) {
      const isExpected = expected.some((e) => e.productId === dbProd.product_id);
      if (!isExpected) {
        console.log(`  EXTRA: ${dbProd.product_id} (not in expected list)`);
      }
    }

    console.log();
  }

  // Also check iOS StoreKitManager enum alignment
  console.log("iOS StoreKitManager ProductID enum expected values:");
  console.log("  com.porizo.plus_monthly  (plusMonthly)");
  console.log("  com.porizo.plus_annual   (plusAnnual)");
  console.log("  com.porizo.pro_monthly   (proMonthly)");
  console.log("  com.porizo.pro_annual    (proAnnual)");
  console.log();

  if (mismatches > 0) {
    console.log(`RESULT: ${mismatches} mismatch(es) found. Fix before ASC submission.\n`);
    process.exit(1);
  } else {
    console.log("RESULT: All product IDs aligned.\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
