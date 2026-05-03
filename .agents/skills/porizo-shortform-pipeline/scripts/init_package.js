#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    args[key] = value;
  }
  return args;
}

function usage() {
  console.error('Usage: node init_package.js --slug <campaign-slug> [--base-dir marketing/campaigns/output]');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const slug = args.slug;

if (!slug || typeof slug !== 'string') {
  usage();
}

const repoRoot = process.cwd();
const baseDir = path.resolve(repoRoot, args['base-dir'] || 'marketing/campaigns/output');
const rootDir = path.join(baseDir, slug);
const subdirs = ['story', 'song', 'demo', 'platforms', 'reelfarm', 'sources'];

fs.mkdirSync(rootDir, { recursive: true });
subdirs.forEach((subdir) => fs.mkdirSync(path.join(rootDir, subdir), { recursive: true }));

const manifestPath = path.join(rootDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  const manifest = {
    slug,
    createdAt: new Date().toISOString(),
    story: {
      file: 'story/story.md',
      status: 'pending'
    },
    song: {
      source: null,
      cuts: {}
    },
    demo: {
      lyrics: null,
      reveal: null,
      nowPlaying: null,
      master: null
    },
    platforms: {
      tiktok: null,
      instagramReels: null,
      facebookReels: null,
      reelfarm: null
    }
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const storyTemplatePath = path.join(rootDir, 'story', 'story.md');
if (!fs.existsSync(storyTemplatePath)) {
  fs.writeFileSync(
    storyTemplatePath,
    [
      '# Story package',
      '',
      '## Hook',
      '',
      '',
      '## Story summary',
      '',
      '',
      '## Porizo Story Input',
      '',
      '',
      '## Story paste block',
      '',
      '',
      '## Optional lyric draft',
      '',
      ''
    ].join('\n')
  );
}

const reelfarmTemplatePath = path.join(rootDir, 'reelfarm', 'brief.md');
if (!fs.existsSync(reelfarmTemplatePath)) {
  fs.writeFileSync(
    reelfarmTemplatePath,
    [
      '# ReelFarm brief',
      '',
      '## Hook',
      '',
      '',
      '## Avatar angle',
      '',
      '',
      '## Sound cut to upload',
      '',
      '',
      '## Demo asset to upload',
      '',
      '',
      '## CTA',
      '',
      ''
    ].join('\n')
  );
}

console.log(rootDir);
