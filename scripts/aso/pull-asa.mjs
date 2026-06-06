#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { pullDailySpend } from './spend-pull.mjs';
import { ASA_CSV_HEADERS, asaRowsToCsvRows, toCsv } from './rerank-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUT_DIR = path.join(ROOT, 'marketing/appstore/aso/inputs');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = { days: 30, output: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') args.days = parseInt(argv[++i], 10);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/aso/pull-asa.mjs [options]

Pulls Apple Search Ads keyword performance and writes the ASO rerank CSV.

Options:
  --days N       Days to pull, ending today (default 30)
  --output PATH  Output CSV path (default inputs/asa-YYYY-MM-DD.csv)
  -h, --help     Show this help
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
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  if (!Number.isInteger(args.days) || args.days <= 0) {
    throw new Error('--days must be a positive integer');
  }

  await loadEnvFile(path.join(ROOT, '.env'));
  const output = args.output
    ? path.resolve(ROOT, args.output)
    : path.join(INPUT_DIR, `asa-${today()}.csv`);

  console.log(`🛰  Pulling ASA keyword data for last ${args.days} days`);
  const pull = await pullDailySpend({
    days: args.days,
    log: (message) => console.log(`   ${message}`),
  });
  const rows = asaRowsToCsvRows(pull.keywords);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, toCsv(rows, ASA_CSV_HEADERS));
  console.log(`💾 Wrote ${path.relative(ROOT, output)} (${rows.length} keyword rows)`);
}

main().catch((err) => {
  console.error(`✖ pull-asa failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
