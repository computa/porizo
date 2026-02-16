#!/usr/bin/env node
/**
 * analyze-song - Show current voice conversion feature flags
 * 
 * Usage: node scripts/analyze-song.js [track-id]
 * 
 * Shows the current feature flag values that would be used for rendering.
 * If track-id provided, also shows track info.
 */

const path = require('path');

async function main() {
  const id = process.argv[2];
  
  if (id === '--help' || id === '-h') {
    console.log(`
Usage: node scripts/analyze-song.js [track-id]

Shows current voice conversion parameters from feature flags.
If track-id provided, also shows track info.

Example:
  node scripts/analyze-song.js
  node scripts/analyze-song.js 010178f8-4ab9-4810-9098-b2440cc8b190
`);
    process.exit(0);
  }

  // Load database
  const { getDatabase } = require('../src/database');
  const db = await getDatabase({ dbPath: path.join(process.cwd(), 'porizo.db') });

  // Get current feature flags
  const flagKeys = [
    'seedvc_cfg_rate',
    'seedvc_diffusion_steps_preview',
    'seedvc_diffusion_steps_full',
    'timbre_blend_ratio',
    'timbre_cfg_rate',
    'timbre_blend_strategy',
    'spectral_crossover_low_hz',
    'spectral_crossover_high_hz',
    'spectral_mid_blend_ratio',
    'doubling_level',
    'doubling_presence_cut_freq',
    'doubling_presence_cut_gain',
    'formant_transfer_strength',
    'formant_max_gain_db'
  ];

  const flags = {};
  for (const key of flagKeys) {
    try {
      const row = db.prepare(`SELECT value FROM feature_flags WHERE key = ?`).get(key);
      if (row) {
        try {
          flags[key] = JSON.parse(row.value);
        } catch {
          flags[key] = row.value;
        }
      }
    } catch {
      // Flag not found, will use default
    }
  }

  // Track info if provided
  let trackInfo = '';
  if (id) {
    let track = db.prepare(`
      SELECT t.*, tv.version_num, tv.status as version_status
      FROM tracks t
      LEFT JOIN track_versions tv ON tv.track_id = t.id
      WHERE t.id = ? OR tv.id = ?
      ORDER BY tv.version_num DESC
      LIMIT 1
    `).get(id, id);

    if (track) {
      trackInfo = `
─────────────────────────────────────────────────────────────────
  TRACK INFO
─────────────────────────────────────────────────────────────────
  Track ID:        ${track.id}
  Title:           ${track.title || 'Untitled'}
  Voice Mode:      ${track.voice_mode}
  Version:         ${track.version_num}
  Status:          ${track.version_status}
`;
    } else {
      trackInfo = `\n  Track not found: ${id}\n`;
    }
  }

  // Compute effective cfg rate
  const blendRatio = flags.timbre_blend_ratio ?? 0.25;
  const effectiveCfg = blendRatio < 1.0 
    ? (flags.timbre_cfg_rate ?? 0.35)
    : (flags.seedvc_cfg_rate ?? 0.65);

  console.log(`
═══════════════════════════════════════════════════════════════
  CURRENT VOICE CONVERSION PARAMETERS
═══════════════════════════════════════════════════════════════
${trackInfo}
─────────────────────────────────────────────────────────────────
  SEED-VC (Voice Conversion)
─────────────────────────────────────────────────────────────────
  CFG Rate (base):       ${flags.seedvc_cfg_rate ?? 0.65}
  CFG Rate (effective):  ${effectiveCfg}  ${blendRatio < 1.0 ? '← uses timbre_cfg_rate' : '← uses seedvc_cfg_rate'}
  Diffusion Steps:       ${flags.seedvc_diffusion_steps_preview ?? 60} (preview) / ${flags.seedvc_diffusion_steps_full ?? 90} (full)

─────────────────────────────────────────────────────────────────
  TIMBRE BLENDING
─────────────────────────────────────────────────────────────────
  Strategy:              ${flags.timbre_blend_strategy ?? 'amplitude'}
  Blend Ratio:           ${flags.timbre_blend_ratio ?? 0.25}  (0=AI only, 1=User only)
  Timbre CFG Rate:       ${flags.timbre_cfg_rate ?? 0.35}

─────────────────────────────────────────────────────────────────
  VOCAL DOUBLING PARAMS  ${flags.timbre_blend_strategy === 'vocal_doubling' ? '← ACTIVE' : ''}
─────────────────────────────────────────────────────────────────
  Doubling Level:        ${flags.doubling_level ?? 0.12}
  Presence Cut Freq:     ${flags.doubling_presence_cut_freq ?? 4000} Hz
  Presence Cut Gain:     ${flags.doubling_presence_cut_gain ?? -8} dB

─────────────────────────────────────────────────────────────────
  SPECTRAL CROSSOVER PARAMS  ${flags.timbre_blend_strategy === 'spectral_crossover' ? '← ACTIVE' : ''}
─────────────────────────────────────────────────────────────────
  Low Crossover:         ${flags.spectral_crossover_low_hz ?? 300} Hz
  High Crossover:        ${flags.spectral_crossover_high_hz ?? 3000} Hz
  Mid Blend Ratio:       ${flags.spectral_mid_blend_ratio ?? 0.30}

─────────────────────────────────────────────────────────────────
  FORMANT TRANSFER PARAMS  ${flags.timbre_blend_strategy === 'formant_transfer' ? '← ACTIVE' : ''}
─────────────────────────────────────────────────────────────────
  Transfer Strength:     ${flags.formant_transfer_strength ?? 0.5}
  Max Gain:              ${flags.formant_max_gain_db ?? 12} dB

═══════════════════════════════════════════════════════════════
`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
