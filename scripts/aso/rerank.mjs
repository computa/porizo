#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import {
  latestInputFile,
  mergeSignals,
  parseAsaRows,
  parseAscRows,
  parseExternalRows,
} from './rerank-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANK_PATH = path.join(ROOT, 'marketing/appstore/aso/keywords.json');
const INPUT_DIR = path.join(ROOT, 'marketing/appstore/aso/inputs');
const SNAPSHOT_DIR = path.join(ROOT, 'marketing/appstore/aso/snapshots');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timestamp() {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 16).replace(':', '')}`;
}

function parseArgs(argv) {
  const args = {
    asa: null,
    asc: null,
    external: null,
    note: '',
    dryRun: false,
    date: today(),
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--asa') args.asa = argv[++i];
    else if (arg === '--asc') args.asc = argv[++i];
    else if (arg === '--external') args.external = argv[++i];
    else if (arg === '--note') args.note = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/aso/rerank.mjs [options]

Merges ASO inputs into marketing/appstore/aso/keywords.json, writes a snapshot,
and prints the App Store keywords-field recommendation.

Options:
  --asa PATH       Apple Search Ads keyword CSV
  --asc PATH       App Store Connect organic search terms CSV
  --external PATH  External keyword metrics CSV
  --note TEXT      Required audit note unless --dry-run
  --date YYYY-MM-DD Review date override
  --dry-run        Print report without writing keywords.json or snapshot
  -h, --help       Show this help
`);
}

async function readRows(filePath, parser) {
  if (!filePath) return [];
  const raw = await fs.readFile(filePath, 'utf8');
  return parser(raw);
}

function resolveInput(filePath) {
  return filePath ? path.resolve(ROOT, filePath) : null;
}

function printReport(report, bank, { dryRun }) {
  const live = bank.live_surfaces?.keywords || '';
  console.log(dryRun ? '🧪 ASO rerank dry run' : '✅ ASO rerank complete');
  console.log(`ASA: ${report.asaRowsMerged} rows merged (${report.asaRowsDiscovered} discovered)`);
  console.log(`ASC: ${report.ascRowsMerged} rows merged`);
  console.log(`External: ${report.externalRowsMerged} rows merged`);
  console.log('');
  console.log(`Keywords field (${report.packed.chars}/100):`);
  console.log(`  ${report.packed.string}`);
  console.log(`Live differs: ${live !== report.packed.string ? 'yes' : 'no'}`);
  console.log('');

  const movers = report.movers.filter((m) => Math.abs(m.delta) >= 3).slice(0, 6);
  console.log('Biggest movers:');
  if (movers.length === 0) {
    console.log('  none over 3 rank positions');
  } else {
    for (const m of movers) {
      const direction = m.delta > 0 ? 'up' : 'down';
      console.log(`  ${m.term}: ${direction} ${Math.abs(m.delta)} (${m.before} → ${m.after})`);
    }
  }
  console.log('');

  const actionRows = report.actions
    .filter((row) => row.action !== 'MONITOR')
    .slice(0, 12);
  console.log('Actions:');
  if (actionRows.length === 0) {
    console.log('  none');
  } else {
    for (const row of actionRows) {
      const installs = row.asa.installs ?? 0;
      const taps = row.asa.taps ?? 0;
      const rate = taps > 0 ? `${Math.round((installs / taps) * 100)}%` : '0%';
      const spend = `$${Number(row.asa.spend ?? 0).toFixed(2)}`;
      console.log(`  ${row.action}: ${row.term} (${row.asa.impressions} imp, ${taps} taps, ${installs} installs, ${rate}, ${spend})`);
    }
  }
  console.log('');

  console.log('Discovery candidates:');
  if (report.discoveryCandidates.length === 0) {
    console.log('  none');
  } else {
    for (const term of report.discoveryCandidates.slice(0, 20)) {
      console.log(`  ${term}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  if (!args.dryRun && !args.note) {
    throw new Error('--note is required so the ASO review log is auditable');
  }

  const asaPath =
    resolveInput(args.asa) ??
    (await latestInputFile(INPUT_DIR, 'asa', args.date)) ??
    (await latestInputFile(INPUT_DIR, 'asa'));
  const ascPath =
    resolveInput(args.asc) ??
    (await latestInputFile(INPUT_DIR, 'asc', args.date)) ??
    (await latestInputFile(INPUT_DIR, 'asc'));
  const externalPath = resolveInput(args.external);

  const bank = JSON.parse(await fs.readFile(BANK_PATH, 'utf8'));
  const asaRows = await readRows(asaPath, parseAsaRows);
  const ascRows = await readRows(ascPath, parseAscRows);
  const externalRows = await readRows(externalPath, parseExternalRows);

  const { bank: nextBank, report } = mergeSignals(bank, {
    asaRows,
    ascRows,
    externalRows,
    date: args.date,
    note: args.note || 'dry run',
  });

  printReport(report, nextBank, { dryRun: args.dryRun });

  if (args.dryRun) {
    return;
  }

  await fs.writeFile(BANK_PATH, `${JSON.stringify(nextBank, null, 2)}\n`);
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const snapshotPath = path.join(SNAPSHOT_DIR, `${timestamp()}.json`);
  await fs.writeFile(snapshotPath, `${JSON.stringify(nextBank, null, 2)}\n`);
  console.log('');
  console.log(`💾 Wrote ${path.relative(ROOT, BANK_PATH)}`);
  console.log(`📸 Wrote ${path.relative(ROOT, snapshotPath)}`);
}

main().catch((err) => {
  console.error(`✖ rerank failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
