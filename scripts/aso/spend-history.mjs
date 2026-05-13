#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { pullDailySpend } from './spend-pull.mjs';
import { loadStore, saveStore, mergeSpend } from './spend-store.mjs';
import { writeDashboard } from './spend-dashboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_PATH = path.join(ROOT, 'marketing/appstore/aso/spend-history/daily.json');
const DASHBOARD_PATH = path.join(ROOT, 'marketing/appstore/aso/spend-history/dashboard.html');

function parseArgs(argv) {
  const args = { days: 30, dryRun: false, skipPull: false, fromFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-pull') args.skipPull = true;
    else if (a === '--from-file') args.fromFile = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/aso/spend-history.mjs [options]

Pulls daily ASA spend (campaigns + keywords) for the last N days, merges into
marketing/appstore/aso/spend-history/daily.json, and regenerates dashboard.html.

Options:
  --days N            Days of history to pull (default 30)
  --skip-pull         Only regenerate dashboard from existing daily.json
  --from-file PATH    Load a pull JSON from disk (testing/replay) instead of ASA
  --dry-run           Pull but do not write to disk
  -h, --help          Show this help
`);
}

async function loadEnvFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) {
      process.env[k] = v.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  await loadEnvFile(path.join(ROOT, '.env'));

  console.log(`📥 Loading existing store from ${path.relative(ROOT, STORE_PATH)}`);
  const store = await loadStore(STORE_PATH);
  const startCounts = {
    campaigns: Object.keys(store.campaigns).length,
    keywords: Object.keys(store.keywords).length,
  };
  console.log(`   ${startCounts.campaigns} campaigns, ${startCounts.keywords} keywords on disk`);

  let pull;
  if (args.skipPull) {
    console.log('⏭  --skip-pull, regenerating dashboard only');
  } else if (args.fromFile) {
    console.log(`📂 Loading pull from ${args.fromFile}`);
    pull = JSON.parse(await fs.readFile(args.fromFile, 'utf8'));
  } else {
    console.log(`🛰  Pulling last ${args.days} days from ASA v5`);
    pull = await pullDailySpend({ days: args.days, log: (m) => console.log(`   ${m}`) });
    console.log(
      `   Got ${pull.campaigns.length} campaign-day rows, ${pull.keywords.length} keyword-day rows`,
    );
  }

  let merged = store;
  if (pull) {
    merged = mergeSpend(store, pull);
  }

  if (args.dryRun) {
    console.log('🧪 --dry-run, not writing to disk. Would write:');
    console.log(`   ${path.relative(ROOT, STORE_PATH)}  (${Object.keys(merged.campaigns).length} campaigns, ${Object.keys(merged.keywords).length} keywords)`);
    console.log(`   ${path.relative(ROOT, DASHBOARD_PATH)}`);
    return;
  }

  if (pull) {
    await saveStore(STORE_PATH, merged);
    console.log(`💾 Wrote ${path.relative(ROOT, STORE_PATH)}`);
  }
  await writeDashboard(DASHBOARD_PATH, merged);
  console.log(`📊 Wrote ${path.relative(ROOT, DASHBOARD_PATH)}`);
  console.log(`   file://${DASHBOARD_PATH}`);
}

main().catch((err) => {
  console.error(`✖ spend-history failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
