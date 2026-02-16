#!/usr/bin/env node
/**
 * CLI Tool: Analyze Voice Blend Quality
 * 
 * Usage:
 *   node scripts/analyze-blend.js --converted path/to/user_vocal.wav --blended path/to/blended.wav
 *   node scripts/analyze-blend.js --all path/to/track/v1/  (analyzes all files in directory)
 *   node scripts/analyze-blend.js --track-version <uuid>   (requires database)
 * 
 * Options:
 *   --user, -u       Path to user enrollment audio (optional)
 *   --original, -o   Path to original AI vocal (Demucs output)
 *   --converted, -c  Path to Seed-VC converted vocal
 *   --blended, -b    Path to final blended output
 *   --all, -a        Directory containing all files (auto-detect)
 *   --json           Output as JSON instead of formatted report
 *   --help, -h       Show help
 */

const fs = require('fs');
const path = require('path');
const {
  analyzeBlend,
  formatAnalysisReport,
  getAudioMetrics,
} = require('../src/utils/blend-analyzer');

function printUsage() {
  console.log(`
Voice Blend Analyzer - Diagnose voice conversion blend quality

Usage:
  node scripts/analyze-blend.js [options]

Options:
  --user, -u <path>       User enrollment audio (reference)
  --original, -o <path>   Original AI vocal (from Demucs)
  --converted, -c <path>  Seed-VC converted vocal
  --blended, -b <path>    Final blended output
  --all, -a <dir>         Auto-detect files in directory
  --json                  Output as JSON
  --help, -h              Show this help

Examples:
  # Analyze specific files
  node scripts/analyze-blend.js -c user_vocal.wav -b blended_vocal.wav

  # Analyze all files in a track directory
  node scripts/analyze-blend.js --all storage/tracks/user123/track456/v1/

  # Get JSON output for scripting
  node scripts/analyze-blend.js -c vocal.wav -b blend.wav --json
`);
}

function parseArgs(args) {
  const options = {
    userEnrollmentPath: null,
    originalVocalPath: null,
    convertedVocalPath: null,
    blendedOutputPath: null,
    allDir: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--user':
      case '-u':
        options.userEnrollmentPath = next;
        i++;
        break;
      case '--original':
      case '-o':
        options.originalVocalPath = next;
        i++;
        break;
      case '--converted':
      case '-c':
        options.convertedVocalPath = next;
        i++;
        break;
      case '--blended':
      case '-b':
        options.blendedOutputPath = next;
        i++;
        break;
      case '--all':
      case '-a':
        options.allDir = next;
        i++;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function autoDetectFiles(dir) {
  const files = {};
  
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return files;
  }

  // Common file patterns
  const patterns = {
    userEnrollmentPath: ['enrollment.wav', 'reference.wav', 'user_ref.wav'],
    originalVocalPath: ['stems/vocals.wav', 'vocals.wav', 'ai_vocal.wav', 'original_vocal.wav'],
    convertedVocalPath: ['user_vocal.wav', 'converted.wav', 'seedvc_output.wav'],
    blendedOutputPath: ['blended_vocal.wav', 'blended.wav', 'mixed_vocal.wav'],
  };

  for (const [key, candidates] of Object.entries(patterns)) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        files[key] = fullPath;
        break;
      }
    }
  }

  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  let filePaths = {};

  // Auto-detect files from directory
  if (options.allDir) {
    filePaths = autoDetectFiles(options.allDir);
    if (Object.keys(filePaths).length === 0) {
      console.error('No audio files found in directory:', options.allDir);
      process.exit(1);
    }
  }

  // Override with explicit paths
  if (options.userEnrollmentPath) filePaths.userEnrollmentPath = options.userEnrollmentPath;
  if (options.originalVocalPath) filePaths.originalVocalPath = options.originalVocalPath;
  if (options.convertedVocalPath) filePaths.convertedVocalPath = options.convertedVocalPath;
  if (options.blendedOutputPath) filePaths.blendedOutputPath = options.blendedOutputPath;

  // Validate at least one file exists
  const existingFiles = {};
  for (const [key, filePath] of Object.entries(filePaths)) {
    if (filePath) {
      const resolved = path.resolve(filePath);
      if (fs.existsSync(resolved)) {
        existingFiles[key] = resolved;
      } else {
        console.warn(`Warning: File not found: ${filePath}`);
      }
    }
  }

  if (Object.keys(existingFiles).length === 0) {
    console.error('Error: No valid audio files provided');
    printUsage();
    process.exit(1);
  }

  console.error(`Analyzing ${Object.keys(existingFiles).length} file(s)...`);

  try {
    const analysis = await analyzeBlend(existingFiles);

    if (options.json) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatAnalysisReport(analysis));
    }

    // Exit with non-zero if high severity issues found
    if (analysis.diagnosis?.overallSeverity === 'high') {
      process.exit(2);
    }
  } catch (err) {
    console.error('Analysis failed:', err.message);
    process.exit(1);
  }
}

main();
