#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static') || 'ffmpeg';

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
  console.error('Usage: node cut_song_assets.js --input <song.mp3> --output-dir <dir> --cuts "hook=00:58-01:04,proof=..." [--title "Song Title"]');
  process.exit(1);
}

function parseCuts(cutsValue) {
  return cutsValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [namePart, rangePart] = entry.split('=');
      if (!namePart || !rangePart || !rangePart.includes('-')) {
        throw new Error(`Invalid cut entry: ${entry}`);
      }
      const [start, end] = rangePart.split('-');
      return {
        name: namePart.trim(),
        start: start.trim(),
        end: end.trim()
      };
    });
}

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function usageNoteFor(name) {
  const notes = {
    hook: 'Fast attention clip. Use under the spoken hook or first on-screen claim.',
    proof: 'Specific memory clip. Use when showing the app or the story itself.',
    payoff: 'Emotional lift. Use for reveal-heavy or feeling-heavy edits.',
    tail: 'Soft support. Use under CTA, logo, or final app demo frames.'
  };
  return notes[name] || 'Reusable short-form audio excerpt.';
}

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args['output-dir'] || !args.cuts) {
  usage();
}

const inputPath = path.resolve(process.cwd(), args.input);
const outputDir = path.resolve(process.cwd(), args['output-dir']);
const title = args.title || path.basename(inputPath, path.extname(inputPath));

if (!fs.existsSync(inputPath)) {
  throw new Error(`Input file does not exist: ${inputPath}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const cuts = parseCuts(args.cuts);

cuts.forEach((cut) => {
  const outputPath = path.join(outputDir, `${cut.name}.mp3`);
  runOrThrow(
    ffmpegPath,
    ['-y', '-ss', cut.start, '-to', cut.end, '-i', inputPath, '-vn', '-acodec', 'libmp3lame', outputPath],
    `Cut ${cut.name}`
  );
});

const cutsJsonPath = path.join(outputDir, 'cuts.json');
fs.writeFileSync(cutsJsonPath, `${JSON.stringify({ title, source: inputPath, cuts }, null, 2)}\n`);

const manifestLines = [
  `# ${title} clip manifest`,
  '',
  `Source: \`${inputPath}\``,
  '',
  '## Cuts',
  ''
];

cuts.forEach((cut) => {
  manifestLines.push(`- \`${cut.name}.mp3\` — \`${cut.start} - ${cut.end}\` — ${usageNoteFor(cut.name)}`);
});

manifestLines.push('', '## Files', '');
cuts.forEach((cut) => {
  manifestLines.push(`- \`${path.join(outputDir, `${cut.name}.mp3`)}\``);
});

fs.writeFileSync(path.join(outputDir, 'cuts-manifest.md'), `${manifestLines.join('\n')}\n`);

console.log(`Created ${cuts.length} cut(s) in ${outputDir}`);
