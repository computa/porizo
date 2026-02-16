/**
 * Blend Analyzer - Diagnostic tool for voice blend quality assessment
 * 
 * Extracts FFmpeg-based metrics from audio files to diagnose blend issues:
 * - LUFS (loudness)
 * - Spectral centroid (voice "color")
 * - Dynamic range
 * - Volume statistics
 */
const { spawn } = require('child_process');
const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 30000;

function getFFmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function runFFmpegCapture(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ffmpeg.kill('SIGKILL');
      reject(new Error('FFmpeg capture timed out'));
    }, timeoutMs);

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (_code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve(stderr);
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Extract LUFS loudness metrics using EBU R128
 */
async function measureLUFS(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const args = [
    '-i', filePath,
    '-af', 'ebur128=framelog=quiet',
    '-f', 'null', '-'
  ];

  const stderr = await runFFmpegCapture(args);
  
  // Parse integrated loudness
  const intMatch = stderr.match(/I:\s*([-\d.]+)\s*LUFS/);
  const lraMatch = stderr.match(/LRA:\s*([-\d.]+)\s*LU/);
  const tpMatch = stderr.match(/Peak:\s*([-\d.]+)\s*dBFS/);

  return {
    integrated: intMatch ? parseFloat(intMatch[1]) : null,
    loudnessRange: lraMatch ? parseFloat(lraMatch[1]) : null,
    truePeak: tpMatch ? parseFloat(tpMatch[1]) : null,
  };
}

/**
 * Extract volume statistics (mean, max, histogram)
 */
async function measureVolume(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const args = [
    '-i', filePath,
    '-af', 'volumedetect',
    '-f', 'null', '-'
  ];

  const stderr = await runFFmpegCapture(args);

  const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);

  return {
    meanVolume: meanMatch ? parseFloat(meanMatch[1]) : null,
    maxVolume: maxMatch ? parseFloat(maxMatch[1]) : null,
  };
}

/**
 * Extract audio statistics (RMS, peak, dynamic range)
 */
async function measureAstats(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const args = [
    '-i', filePath,
    '-af', 'astats=metadata=1:reset=1',
    '-f', 'null', '-'
  ];

  const stderr = await runFFmpegCapture(args);

  // Parse overall stats
  const rmsMatch = stderr.match(/RMS level dB:\s*([-\d.]+)/);
  const peakMatch = stderr.match(/Peak level dB:\s*([-\d.]+)/);
  const dynamicMatch = stderr.match(/Dynamic range:\s*([-\d.]+)/);
  const crestMatch = stderr.match(/Crest factor:\s*([-\d.]+)/);
  const flatMatch = stderr.match(/Flat factor:\s*([-\d.]+)/);
  const zcrMatch = stderr.match(/Zero crossings rate:\s*([-\d.]+)/);

  return {
    rmsLevel: rmsMatch ? parseFloat(rmsMatch[1]) : null,
    peakLevel: peakMatch ? parseFloat(peakMatch[1]) : null,
    dynamicRange: dynamicMatch ? parseFloat(dynamicMatch[1]) : null,
    crestFactor: crestMatch ? parseFloat(crestMatch[1]) : null,
    flatFactor: flatMatch ? parseFloat(flatMatch[1]) : null,
    zeroCrossingRate: zcrMatch ? parseFloat(zcrMatch[1]) : null,
  };
}

/**
 * Extract spectral centroid (voice "brightness/color")
 */
async function measureSpectralCentroid(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Get average spectral centroid over the file
  const args = [
    '-i', filePath,
    '-af', 'aspectralstats=measure=centroid,ametadata=print:file=-',
    '-f', 'null', '-'
  ];

  try {
    const stderr = await runFFmpegCapture(args);
    
    // Parse centroid values and compute average
    const centroidMatches = stderr.matchAll(/lavfi\.astats\.Overall\.Spectral_centroid=(\d+\.?\d*)/g);
    const centroids = [];
    for (const match of centroidMatches) {
      centroids.push(parseFloat(match[1]));
    }

    if (centroids.length === 0) {
      // Fallback: try alternate parsing
      const altMatch = stderr.match(/centroid[:\s]*([\d.]+)/i);
      if (altMatch) {
        return { centroid: parseFloat(altMatch[1]), samples: 1 };
      }
      return { centroid: null, samples: 0 };
    }

    const avgCentroid = centroids.reduce((a, b) => a + b, 0) / centroids.length;
    return {
      centroid: Math.round(avgCentroid),
      samples: centroids.length,
    };
  } catch (err) {
    // aspectralstats may not be available in older FFmpeg versions
    console.warn('[blend-analyzer] spectral centroid measurement failed:', err.message);
    return { centroid: null, samples: 0, error: err.message };
  }
}

/**
 * Get all metrics for a single audio file
 */
async function getAudioMetrics(filePath) {
  const [lufs, volume, astats, spectral] = await Promise.all([
    measureLUFS(filePath).catch(e => ({ error: e.message })),
    measureVolume(filePath).catch(e => ({ error: e.message })),
    measureAstats(filePath).catch(e => ({ error: e.message })),
    measureSpectralCentroid(filePath).catch(e => ({ error: e.message })),
  ]);

  return {
    lufs,
    volume,
    astats,
    spectral,
  };
}

/**
 * Analyze a complete blend pipeline
 * 
 * @param {Object} options
 * @param {string} options.userEnrollmentPath - User's reference audio (enrollment)
 * @param {string} options.originalVocalPath - AI vocal (from Suno/Demucs)
 * @param {string} options.convertedVocalPath - Seed-VC converted vocal
 * @param {string} options.blendedOutputPath - Final blended output
 */
async function analyzeBlend({
  userEnrollmentPath,
  originalVocalPath,
  convertedVocalPath,
  blendedOutputPath,
}) {
  const results = {
    timestamp: new Date().toISOString(),
    files: {},
    metrics: {},
    diagnosis: null,
    recommendations: [],
  };

  // Collect metrics for each available file
  const files = {
    userEnrollment: userEnrollmentPath,
    originalVocal: originalVocalPath,
    convertedVocal: convertedVocalPath,
    blendedOutput: blendedOutputPath,
  };

  for (const [key, filePath] of Object.entries(files)) {
    if (filePath && fs.existsSync(filePath)) {
      results.files[key] = filePath;
      try {
        results.metrics[key] = await getAudioMetrics(filePath);
      } catch (err) {
        results.metrics[key] = { error: err.message };
      }
    }
  }

  // Compute comparative metrics
  results.comparison = computeComparison(results.metrics);
  
  // Diagnose issues
  results.diagnosis = diagnoseBlendIssue(results.metrics, results.comparison);
  
  // Generate recommendations
  results.recommendations = generateRecommendations(results.diagnosis, results.comparison);

  return results;
}

/**
 * Compute comparative metrics between sources
 */
function computeComparison(metrics) {
  const comparison = {};

  // LUFS difference between converted and blended
  if (metrics.convertedVocal?.lufs?.integrated && metrics.blendedOutput?.lufs?.integrated) {
    comparison.lufsDropFromConverted = 
      metrics.convertedVocal.lufs.integrated - metrics.blendedOutput.lufs.integrated;
  }

  // LUFS difference between original AI and blended
  if (metrics.originalVocal?.lufs?.integrated && metrics.blendedOutput?.lufs?.integrated) {
    comparison.lufsDropFromOriginal = 
      metrics.originalVocal.lufs.integrated - metrics.blendedOutput.lufs.integrated;
  }

  // Volume balance: which source is louder in the blend
  if (metrics.convertedVocal?.volume?.meanVolume && metrics.originalVocal?.volume?.meanVolume) {
    comparison.convertedToOriginalVolume = 
      metrics.convertedVocal.volume.meanVolume - metrics.originalVocal.volume.meanVolume;
  }

  // Spectral centroid drift (is user's voice "color" preserved?)
  if (metrics.userEnrollment?.spectral?.centroid && metrics.blendedOutput?.spectral?.centroid) {
    comparison.spectralDriftFromUser = 
      metrics.blendedOutput.spectral.centroid - metrics.userEnrollment.spectral.centroid;
  }

  if (metrics.convertedVocal?.spectral?.centroid && metrics.blendedOutput?.spectral?.centroid) {
    comparison.spectralDriftFromConverted = 
      metrics.blendedOutput.spectral.centroid - metrics.convertedVocal.spectral.centroid;
  }

  // Dynamic range comparison
  if (metrics.convertedVocal?.astats?.dynamicRange && metrics.blendedOutput?.astats?.dynamicRange) {
    comparison.dynamicRangeChange = 
      metrics.blendedOutput.astats.dynamicRange - metrics.convertedVocal.astats.dynamicRange;
  }

  return comparison;
}

/**
 * Diagnose blend issues based on metrics
 */
function diagnoseBlendIssue(metrics, comparison) {
  const issues = [];

  // Check if user voice is being ducked too much
  if (comparison.lufsDropFromConverted > 6) {
    issues.push({
      code: 'USER_DUCKED_TOO_MUCH',
      severity: 'high',
      message: `Converted vocal lost ${comparison.lufsDropFromConverted.toFixed(1)} LUFS in blend`,
    });
  }

  // Check if AI voice is dominating
  if (comparison.lufsDropFromOriginal < 3 && comparison.lufsDropFromConverted > 6) {
    issues.push({
      code: 'AI_VOICE_DOMINANT',
      severity: 'high',
      message: 'AI vocal maintains volume while user vocal is suppressed',
    });
  }

  // Check for spectral drift (voice color changing)
  if (Math.abs(comparison.spectralDriftFromUser || 0) > 500) {
    issues.push({
      code: 'SPECTRAL_DRIFT',
      severity: 'medium',
      message: `Voice color shifted ${comparison.spectralDriftFromUser > 0 ? 'brighter' : 'darker'} by ${Math.abs(comparison.spectralDriftFromUser)}Hz`,
    });
  }

  // Check for over-compression
  if (comparison.dynamicRangeChange < -10) {
    issues.push({
      code: 'OVER_COMPRESSED',
      severity: 'medium',
      message: `Dynamic range reduced by ${Math.abs(comparison.dynamicRangeChange).toFixed(1)}dB`,
    });
  }

  // Check if converted vocal is too quiet to begin with
  if (metrics.convertedVocal?.volume?.meanVolume < -30) {
    issues.push({
      code: 'CONVERTED_VOCAL_QUIET',
      severity: 'medium',
      message: `Seed-VC output is quiet (${metrics.convertedVocal.volume.meanVolume.toFixed(1)}dB mean)`,
    });
  }

  return {
    issues,
    primaryIssue: issues.length > 0 ? issues[0].code : 'NONE_DETECTED',
    overallSeverity: issues.some(i => i.severity === 'high') ? 'high' : 
                     issues.some(i => i.severity === 'medium') ? 'medium' : 'low',
  };
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(diagnosis, comparison) {
  const recommendations = [];

  for (const issue of diagnosis.issues) {
    switch (issue.code) {
      case 'USER_DUCKED_TOO_MUCH':
        recommendations.push({
          parameter: 'timbre_blend_ratio',
          action: 'increase',
          suggested: 0.95,
          reason: 'Increase user vocal presence in the blend',
        });
        break;

      case 'AI_VOICE_DOMINANT':
        recommendations.push({
          parameter: 'timbre_blend_ratio',
          action: 'increase',
          suggested: 0.98,
          reason: 'Near-total user voice with minimal AI smoothing',
        });
        recommendations.push({
          parameter: 'timbre_blend_strategy',
          action: 'change',
          suggested: 'perceptual_primary',
          reason: 'Try sidechain-based blending where user is primary',
        });
        break;

      case 'SPECTRAL_DRIFT':
        recommendations.push({
          parameter: 'timbre_cfg_rate',
          action: comparison.spectralDriftFromUser > 0 ? 'decrease' : 'increase',
          suggested: comparison.spectralDriftFromUser > 0 ? 0.5 : 0.85,
          reason: 'Adjust voice conversion strength to preserve user timbre',
        });
        break;

      case 'OVER_COMPRESSED':
        recommendations.push({
          parameter: 'doubling_presence_cut_gain',
          action: 'increase',
          suggested: -2,
          reason: 'Reduce compression on user vocal',
        });
        break;

      case 'CONVERTED_VOCAL_QUIET':
        recommendations.push({
          parameter: 'seedvc_cfg_rate',
          action: 'increase',
          suggested: 0.8,
          reason: 'Stronger voice conversion may produce louder output',
        });
        break;
    }
  }

  // Always suggest testing blend_ratio=1.0 as baseline
  if (diagnosis.primaryIssue !== 'NONE_DETECTED') {
    recommendations.push({
      parameter: 'timbre_blend_ratio',
      action: 'test_baseline',
      suggested: 1.0,
      reason: 'Test with 100% converted vocal to verify Seed-VC output quality',
    });
  }

  return recommendations;
}

/**
 * Format analysis results for logging/display
 */
function formatAnalysisReport(analysis) {
  const lines = [];
  
  lines.push('=== BLEND ANALYSIS REPORT ===');
  lines.push(`Timestamp: ${analysis.timestamp}`);
  lines.push('');

  // File summary
  lines.push('--- Files Analyzed ---');
  for (const [key, path] of Object.entries(analysis.files)) {
    lines.push(`  ${key}: ${path}`);
  }
  lines.push('');

  // Key metrics
  lines.push('--- Key Metrics ---');
  for (const [source, metrics] of Object.entries(analysis.metrics)) {
    if (metrics.error) {
      lines.push(`  ${source}: ERROR - ${metrics.error}`);
      continue;
    }
    lines.push(`  ${source}:`);
    if (metrics.lufs?.integrated) {
      lines.push(`    LUFS: ${metrics.lufs.integrated.toFixed(1)}`);
    }
    if (metrics.volume?.meanVolume) {
      lines.push(`    Mean Volume: ${metrics.volume.meanVolume.toFixed(1)} dB`);
    }
    if (metrics.spectral?.centroid) {
      lines.push(`    Spectral Centroid: ${metrics.spectral.centroid} Hz`);
    }
  }
  lines.push('');

  // Comparison
  lines.push('--- Comparison ---');
  for (const [key, value] of Object.entries(analysis.comparison)) {
    if (value !== undefined && value !== null) {
      lines.push(`  ${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`);
    }
  }
  lines.push('');

  // Diagnosis
  lines.push('--- Diagnosis ---');
  lines.push(`  Primary Issue: ${analysis.diagnosis.primaryIssue}`);
  lines.push(`  Severity: ${analysis.diagnosis.overallSeverity}`);
  for (const issue of analysis.diagnosis.issues) {
    lines.push(`  - [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
  }
  lines.push('');

  // Recommendations
  lines.push('--- Recommendations ---');
  for (const rec of analysis.recommendations) {
    lines.push(`  ${rec.parameter}: ${rec.action} to ${rec.suggested}`);
    lines.push(`    Reason: ${rec.reason}`);
  }

  return lines.join('\n');
}

module.exports = {
  measureLUFS,
  measureVolume,
  measureAstats,
  measureSpectralCentroid,
  getAudioMetrics,
  analyzeBlend,
  formatAnalysisReport,
  computeComparison,
  diagnoseBlendIssue,
  generateRecommendations,
};
