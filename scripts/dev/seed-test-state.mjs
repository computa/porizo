#!/usr/bin/env node
// Local dev seed for simulator E2E testing. Sets feature flags / test state in
// the LOCAL Postgres so the real backend (npm run dev) can drive flows like the
// pay-per-song paywall. SAFE: refuses to run against a non-local database.
//
// Usage:
//   node -r dotenv/config scripts/dev/seed-test-state.mjs payperson:on
//   node -r dotenv/config scripts/dev/seed-test-state.mjs payperson:off
//   node -r dotenv/config scripts/dev/seed-test-state.mjs status
//
// Or via npm:  npm run seed:payperson   /   npm run seed:status

import pg from "pg";

const url = process.env.DATABASE_URL || "";
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
if (!isLocal) {
  console.error(
    `Refusing to run: DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@") || "unset"}).\n` +
      "This script only seeds a local dev database.",
  );
  process.exit(1);
}

const cmd = process.argv[2] || "status";
const pool = new pg.Pool({ connectionString: url });

async function setFlag(id, value) {
  await pool.query(
    `INSERT INTO feature_flags (id, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [id, JSON.stringify(value)],
  );
}

async function showStatus() {
  const flags = await pool.query(
    `SELECT id, value FROM feature_flags WHERE id LIKE 'paywall_%' ORDER BY id`,
  );
  const plans = await pool.query(
    `SELECT tier, songs_per_month FROM subscription_plans ORDER BY sort_order`,
  );
  console.log("Feature flags (paywall_*):");
  if (flags.rows.length === 0) console.log("  (none set — defaults apply)");
  for (const r of flags.rows) console.log(`  ${r.id} = ${r.value}`);
  console.log("Plans:");
  for (const r of plans.rows) console.log(`  ${r.tier}: ${r.songs_per_month} songs/mo`);
}

try {
  switch (cmd) {
    case "payperson:on":
      await setFlag("paywall_pay_per_song_enabled", true);
      console.log("✓ paywall_pay_per_song_enabled = true");
      await showStatus();
      break;
    case "payperson:off":
      await setFlag("paywall_pay_per_song_enabled", false);
      console.log("✓ paywall_pay_per_song_enabled = false");
      await showStatus();
      break;
    case "status":
      await showStatus();
      break;
    default:
      console.error(`Unknown command: ${cmd}. Use payperson:on | payperson:off | status`);
      process.exit(1);
  }
} finally {
  await pool.end();
}
