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
  console.error('Usage: node export_shortform_pack.js --input <master.mp4> --output-dir <dir> [--basename asset-name]');
  process.exit(1);
}

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args['output-dir']) {
  usage();
}

const inputPath = path.resolve(process.cwd(), args.input);
const outputDir = path.resolve(process.cwd(), args['output-dir']);
const basename = args.basename || path.basename(inputPath, path.extname(inputPath));

if (!fs.existsSync(inputPath)) {
  throw new Error(`Input file does not exist: ${inputPath}`);
}

fs.mkdirSync(outputDir, { recursive: true });

const targets = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram-reels', label: 'Instagram Reels' },
  { key: 'facebook-reels', label: 'Facebook Reels' },
  { key: 'reelfarm', label: 'ReelFarm' }
];

const filter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p';
const writtenFiles = [];

targets.forEach((target) => {
  const outputPath = path.join(outputDir, `${basename}-${target.key}.mp4`);
  runOrThrow(
    ffmpegPath,
    ['-y', '-i', inputPath, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath],
    `Export ${target.label}`
  );
  writtenFiles.push({ ...target, outputPath });
});

const manifestLines = [
  `# ${basename} short-form exports`,
  '',
  `Source: \`${inputPath}\``,
  '',
  '## Platform files',
  ''
];

writtenFiles.forEach((file) => {
  manifestLines.push(`- ${file.label}: \`${file.outputPath}\``);
});

fs.writeFileSync(path.join(outputDir, 'platform-manifest.md'), `${manifestLines.join('\n')}\n`);

console.log(`Exported ${writtenFiles.length} files to ${outputDir}`);
