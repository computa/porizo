#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { compareKeywordLanesFromAsaCsv, formatLaneComparison } from './lane-comparison.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUT_DIR = path.join(ROOT, 'marketing/appstore/aso/inputs');
const MIN_RERANK_DAYS = 14;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {
    days: 30,
    note: `ASO review ${today()}`,
    asc: null,
    external: null,
    skipAsa: false,
    skipRerank: false,
    forceShortWindowRerank: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') args.days = parseInt(argv[++i], 10);
    else if (arg === '--note') args.note = argv[++i];
    else if (arg === '--asc') args.asc = argv[++i];
    else if (arg === '--external') args.external = argv[++i];
    else if (arg === '--skip-asa') args.skipAsa = true;
    else if (arg === '--skip-rerank') args.skipRerank = true;
    else if (arg === '--force-short-window-rerank') args.forceShortWindowRerank = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/aso/review.mjs [options]

Runs the Porizo ASO review: ASA pull, keyword rerank, and spend dashboard refresh.

Options:
  --days N          Days of ASA data to pull (default 30)
  --note TEXT       Audit note for rerank
  --asc PATH        Optional ASC organic search terms CSV
  --external PATH   Optional external keyword metrics CSV
  --skip-asa        Do not pull fresh ASA CSV
  --skip-rerank     Pull ASA and refresh spend dashboard only
  --force-short-window-rerank
                    Allow reranking with < ${MIN_RERANK_DAYS} days of ASA data
  -h, --help        Show this help
`);
}

function runNode(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) resolve(code);
      else reject(new Error(`${args.join(' ')} exited ${code}`));
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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
  if (!args.skipRerank && args.days < MIN_RERANK_DAYS && !args.forceShortWindowRerank) {
    throw new Error(
      `Refusing to rerank with only ${args.days} days of ASA data. Use scripts/aso/spend-history.mjs --days ${args.days} for monitoring, pass --skip-rerank, or use --force-short-window-rerank if this is intentional.`,
    );
  }

  const date = today();
  const asaPath = path.join(INPUT_DIR, `asa-${date}.csv`);

  if (!args.skipAsa) {
    console.log('== Pull ASA keyword CSV ==');
    const code = await runNode([
      'scripts/aso/pull-asa.mjs',
      '--days',
      String(args.days),
      '--output',
      asaPath,
    ], { allowFailure: true });
    if (code !== 0) {
      console.warn('⚠ ASA pull failed; rerank will use existing inputs if available.');
    }
  }

  if (!args.skipRerank) {
    console.log('\n== Rerank keyword bank ==');
    const rerankArgs = [
      'scripts/aso/rerank.mjs',
      '--date',
      date,
      '--note',
      args.note,
    ];
    if (await exists(asaPath)) rerankArgs.push('--asa', asaPath);
    if (args.asc) rerankArgs.push('--asc', args.asc);
    if (args.external) rerankArgs.push('--external', args.external);
    await runNode(rerankArgs);
  }

  if (await exists(asaPath)) {
    console.log('\n== Compare acquisition lanes ==');
    const comparison = await compareKeywordLanesFromAsaCsv(asaPath);
    console.log(formatLaneComparison(comparison).replace(/^== Compare acquisition lanes ==\n/, ''));
  }

  console.log('\n== Refresh spend history dashboard ==');
  const spendCode = await runNode([
    'scripts/aso/spend-history.mjs',
    '--days',
    String(args.days),
  ], { allowFailure: true });
  if (spendCode !== 0) {
    console.warn('⚠ Spend dashboard refresh failed; existing dashboard left untouched by spend-history.');
  }
}

main().catch((err) => {
  console.error(`✖ review failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
