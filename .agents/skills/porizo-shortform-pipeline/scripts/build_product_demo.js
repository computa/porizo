#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
const ffprobePath = require('@ffprobe-installer/ffprobe').path || 'ffprobe';

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
  console.error('Usage: node build_product_demo.js --reveal <reveal.mp4> --output <master.mp4> [--lyrics <file>] [--now-playing <file>] [--total-duration 15.0]');
  process.exit(1);
}

function runOrThrow(command, args, label, stdio = 'inherit') {
  const result = spawnSync(command, args, { stdio });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result;
}

function probe(filePath) {
  const result = runOrThrow(
    ffprobePath,
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath],
    `ffprobe ${filePath}`,
    'pipe'
  );
  return JSON.parse(result.stdout.toString('utf8'));
}

function getVideoStream(probeData) {
  return probeData.streams.find((stream) => stream.codec_type === 'video');
}

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function isImageFile(filePath) {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(filePath).toLowerCase());
}

function relativeOrAbsolute(targetPath) {
  return path.resolve(process.cwd(), targetPath);
}

const args = parseArgs(process.argv.slice(2));
if (!args.reveal || !args.output) {
  usage();
}

const revealPath = relativeOrAbsolute(args.reveal);
const lyricsPath = args.lyrics ? relativeOrAbsolute(args.lyrics) : null;
const nowPath = args['now-playing'] ? relativeOrAbsolute(args['now-playing']) : null;
const outputPath = relativeOrAbsolute(args.output);

if (!fs.existsSync(revealPath)) {
  throw new Error(`Reveal file does not exist: ${revealPath}`);
}
if (lyricsPath && !fs.existsSync(lyricsPath)) {
  throw new Error(`Lyrics file does not exist: ${lyricsPath}`);
}
if (nowPath && !fs.existsSync(nowPath)) {
  throw new Error(`Now Playing file does not exist: ${nowPath}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const revealProbe = probe(revealPath);
const revealVideo = getVideoStream(revealProbe);
if (!revealVideo) {
  throw new Error(`Reveal file has no video stream: ${revealPath}`);
}

const width = revealVideo.width;
const height = revealVideo.height;
const revealDuration = Number(revealProbe.format.duration);
const totalDuration = toNumber(args['total-duration'], revealDuration);
const lyricsDuration = lyricsPath ? toNumber(args['lyrics-duration'], 2.8) : 0;
const nowDuration = nowPath ? toNumber(args['now-duration'], 4.5) : 0;
const fadeDuration = toNumber(args.transition, 0.4);
const revealStart = toNumber(args['reveal-start'], 0);
const nowStart = toNumber(args['now-start'], 0);

if (totalDuration <= 0 || totalDuration > revealDuration) {
  throw new Error(`Invalid total duration ${totalDuration}; reveal duration is ${revealDuration}`);
}

let revealSegmentDuration = totalDuration;
if (lyricsPath && nowPath) {
  revealSegmentDuration = totalDuration - lyricsDuration - nowDuration + (fadeDuration * 2);
} else if (lyricsPath) {
  revealSegmentDuration = totalDuration - lyricsDuration + fadeDuration;
} else if (nowPath) {
  revealSegmentDuration = totalDuration - nowDuration + fadeDuration;
}

if (revealSegmentDuration <= 0.5) {
  throw new Error('Reveal segment duration is too short. Reduce lyrics/now durations or increase total duration.');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'porizo-demo-'));
const revealVisualPath = path.join(tempDir, 'reveal-visual.mp4');
const revealAudioPath = path.join(tempDir, 'reveal-audio.m4a');
const lyricsVideoPath = lyricsPath ? path.join(tempDir, 'lyrics.mp4') : null;
const nowVideoPath = nowPath ? path.join(tempDir, 'now.mp4') : null;

function scaleCropFilter(targetWidth, targetHeight) {
  return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},fps=30,format=yuv420p,setsar=1`;
}

runOrThrow(
  ffmpegPath,
  ['-y', '-ss', `${revealStart}`, '-t', `${revealSegmentDuration}`, '-i', revealPath, '-an', '-vf', scaleCropFilter(width, height), '-c:v', 'libx264', '-preset', 'veryfast', revealVisualPath],
  'Build reveal visual'
);

runOrThrow(
  ffmpegPath,
  ['-y', '-ss', `${revealStart}`, '-t', `${totalDuration}`, '-i', revealPath, '-vn', '-c:a', 'aac', '-b:a', '192k', revealAudioPath],
  'Extract reveal audio'
);

if (lyricsPath) {
  if (isImageFile(lyricsPath)) {
    runOrThrow(
      ffmpegPath,
      ['-y', '-loop', '1', '-t', `${lyricsDuration}`, '-i', lyricsPath, '-vf', scaleCropFilter(width, height), '-c:v', 'libx264', '-preset', 'veryfast', lyricsVideoPath],
      'Build lyrics clip'
    );
  } else {
    runOrThrow(
      ffmpegPath,
      ['-y', '-t', `${lyricsDuration}`, '-i', lyricsPath, '-an', '-vf', scaleCropFilter(width, height), '-c:v', 'libx264', '-preset', 'veryfast', lyricsVideoPath],
      'Trim lyrics clip'
    );
  }
}

if (nowPath) {
  runOrThrow(
    ffmpegPath,
    ['-y', '-ss', `${nowStart}`, '-t', `${nowDuration}`, '-i', nowPath, '-an', '-vf', scaleCropFilter(width, height), '-c:v', 'libx264', '-preset', 'veryfast', nowVideoPath],
    'Build now playing clip'
  );
}

let filterComplex;
let inputArgs;
let mapArgs;

if (lyricsVideoPath && nowVideoPath) {
  const durationOne = lyricsDuration + revealSegmentDuration - fadeDuration;
  const secondOffset = durationOne - fadeDuration;
  filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=${Math.max(0, lyricsDuration - fadeDuration)}[v1];[v1][2:v]xfade=transition=fade:duration=${fadeDuration}:offset=${secondOffset}[vout]`;
  inputArgs = ['-i', lyricsVideoPath, '-i', revealVisualPath, '-i', nowVideoPath, '-i', revealAudioPath];
  mapArgs = ['-map', '[vout]', '-map', '3:a:0'];
} else if (lyricsVideoPath) {
  filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=${Math.max(0, lyricsDuration - fadeDuration)}[vout]`;
  inputArgs = ['-i', lyricsVideoPath, '-i', revealVisualPath, '-i', revealAudioPath];
  mapArgs = ['-map', '[vout]', '-map', '2:a:0'];
} else if (nowVideoPath) {
  filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=${Math.max(0, revealSegmentDuration - fadeDuration)}[vout]`;
  inputArgs = ['-i', revealVisualPath, '-i', nowVideoPath, '-i', revealAudioPath];
  mapArgs = ['-map', '[vout]', '-map', '2:a:0'];
} else {
  filterComplex = null;
  inputArgs = ['-i', revealVisualPath, '-i', revealAudioPath];
  mapArgs = ['-map', '0:v:0', '-map', '1:a:0'];
}

const finalArgs = ['-y', ...inputArgs];
if (filterComplex) {
  finalArgs.push('-filter_complex', filterComplex);
}
finalArgs.push(
  ...mapArgs,
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-movflags',
  '+faststart',
  outputPath
);

runOrThrow(ffmpegPath, finalArgs, 'Build product demo');

console.log(outputPath);
