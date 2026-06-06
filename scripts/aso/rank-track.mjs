#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import {
  pullRanks,
  ranksToCsvRows,
  formatRankTable,
  RANK_CSV_HEADERS,
  DEFAULT_KEYWORDS,
  DEFAULT_COUNTRIES,
  PORIZO_APP_ID,
} from './rank-core.mjs';
import { toCsv } from './rerank-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RANKS_DIR = path.join(ROOT, 'marketing/appstore/aso/ranks');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {
    keywords: null,
    countries: DEFAULT_COUNTRIES,
    appId: PORIZO_APP_ID,
    output: null,
    json: false,
    sleepMs: 500,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keywords') args.keywords = argv[++i];
    else if (arg === '--countries') args.countries = argv[++i].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
    else if (arg === '--app-id') args.appId = parseInt(argv[++i], 10);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--sleep') args.sleepMs = parseInt(argv[++i], 10);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/aso/rank-track.mjs [options]

Pulls LIVE App Store keyword ranks for Porizo across storefronts via Apple's
iTunes Search API and writes a dated CSV snapshot + appends to history.csv.

This is the real scoreboard. It is NOT the keyword-relevance "potential rank"
an ASO tool estimates — those run 20-130 positions optimistic. Storefront
matters: your AU iPhone searches the AU store, which ranks lower than US.

Options:
  --keywords LIST   Comma-separated terms, or a path to a newline file
                    (default: the 16 tracked terms)
  --countries LIST  Comma-separated storefronts (default: ${DEFAULT_COUNTRIES.join(',')})
  --app-id ID       Numeric App Store ID (default: ${PORIZO_APP_ID})
  --output PATH     Snapshot CSV path (default: ranks/ranks-YYYY-MM-DD.csv)
  --json            Also write a JSON snapshot alongside the CSV
  --sleep MS        Delay between API calls to avoid throttling (default 500)
  -h, --help        Show this help

Examples:
  node scripts/aso/rank-track.mjs
  node scripts/aso/rank-track.mjs --countries us,au --keywords "song gift,gift song"
  node scripts/aso/rank-track.mjs --json
`);
}

async function resolveKeywords(spec) {
  if (!spec) return DEFAULT_KEYWORDS;
  // A path to a file of newline-separated terms?
  try {
    const raw = await fs.readFile(path.resolve(ROOT, spec), 'utf8');
    const terms = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (terms.length) return terms;
  } catch {
    // not a file — fall through to comma-split
  }
  return spec.split(',').map((t) => t.trim()).filter(Boolean);
}

async function appendHistory(historyPath, csvRows) {
  let exists = true;
  try {
    await fs.access(historyPath);
  } catch {
    exists = false;
  }
  const body = exists
    ? csvRows.map((row) => RANK_CSV_HEADERS.map((h) => csvCell(row[h])).join(',')).join('\n') + '\n'
    : toCsv(csvRows, RANK_CSV_HEADERS);
  await fs.appendFile(historyPath, body);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  const keywords = await resolveKeywords(args.keywords);
  console.log(`📊 Pulling live ranks: ${keywords.length} keywords × ${args.countries.length} storefronts (${args.countries.join(', ').toUpperCase()})`);

  const pull = await pullRanks({
    keywords,
    countries: args.countries,
    appId: args.appId,
    sleepMs: args.sleepMs,
    log: (m) => console.log(`   ${m}`),
  });

  console.log('');
  console.log(formatRankTable(pull));
  console.log('');

  await fs.mkdir(RANKS_DIR, { recursive: true });
  const csvRows = ranksToCsvRows(pull);

  const snapshot = args.output
    ? path.resolve(ROOT, args.output)
    : path.join(RANKS_DIR, `ranks-${today()}.csv`);
  await fs.writeFile(snapshot, toCsv(csvRows, RANK_CSV_HEADERS));
  console.log(`💾 Snapshot: ${path.relative(ROOT, snapshot)} (${csvRows.length} rows)`);

  const historyPath = path.join(RANKS_DIR, 'history.csv');
  await appendHistory(historyPath, csvRows);
  console.log(`🗂  Appended to ${path.relative(ROOT, historyPath)}`);

  if (args.json) {
    const jsonPath = snapshot.replace(/\.csv$/, '.json');
    await fs.writeFile(jsonPath, JSON.stringify(pull, null, 2) + '\n');
    console.log(`💾 JSON: ${path.relative(ROOT, jsonPath)}`);
  }

  const found = pull.rows.filter((r) => r.indexed).length;
  console.log(`✅ Indexed in ${found}/${pull.rows.length} keyword×storefront cells`);
}

main().catch((err) => {
  console.error(`✖ rank-track failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
