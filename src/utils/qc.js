/**
 * Audio Quality Control functions for enrollment validation
 */

const { parseWavBuffer } = require("./audio");

const WAV_HEADER_SIZE = 44;

/**
 * Parse WAV and extract samples.
 * Uses parseWavBuffer to handle extended WAV formats (iOS adds JUNK/LIST chunks).
 */
function parseWav(buffer) {
  const wavInfo = parseWavBuffer(buffer);

  if (wavInfo.bitsPerSample !== 16) {
    throw new Error("Unsupported bit depth: " + wavInfo.bitsPerSample);
  }

  const numSamples = Math.floor(wavInfo.dataSize / 2);
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buffer.readInt16LE(wavInfo.dataOffset + i * 2);
  }
  return { samples, sampleRate: wavInfo.sampleRate, channels: wavInfo.numChannels };
}

function calculateSNR(buffer) {
  const { samples } = parseWav(buffer);
  if (samples.length === 0) return 0;

  // Calculate signal RMS
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768;
    sumSquares += normalized * normalized;
  }
  const signalRms = Math.sqrt(sumSquares / samples.length);

  // Check for silence (RMS below -60dB threshold)
  if (signalRms < 0.001) {
    return -1; // Special value indicating silence
  }

  // Quantization noise floor (theoretical minimum for 16-bit audio)
  const quantizationNoise = 1 / (32768 * Math.sqrt(12));

  // Use autocorrelation to detect tonal vs noisy content
  let sumXY = 0, sumX2 = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const x = samples[i] / 32768;
    const y = samples[i + 1] / 32768;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const autocorr = sumX2 > 0 ? sumXY / sumX2 : 0;

  // Frame-based noise floor estimation
  const frameSize = 1024;
  const framePowers = [];
  for (let i = 0; i < samples.length - frameSize; i += frameSize) {
    let framePower = 0;
    for (let j = 0; j < frameSize; j++) {
      const normalized = samples[i + j] / 32768;
      framePower += normalized * normalized;
    }
    framePowers.push(Math.sqrt(framePower / frameSize));
  }

  if (framePowers.length === 0) {
    const noiseFloor = Math.max(quantizationNoise, signalRms * 0.001);
    return 20 * Math.log10(signalRms / noiseFloor);
  }

  framePowers.sort((a, b) => a - b);
  const noiseFloorIndex = Math.floor(framePowers.length * 0.1);
  let noiseFloor = framePowers[noiseFloorIndex] || quantizationNoise;

  // High autocorrelation (>0.8) indicates clean tonal signal
  if (autocorr > 0.8) {
    noiseFloor = quantizationNoise;
  }

  noiseFloor = Math.max(noiseFloor, quantizationNoise);
  const snr = 20 * Math.log10(signalRms / noiseFloor);
  return Math.max(0, Math.min(100, snr));
}

function calculateClippingRatio(buffer) {
  const { samples } = parseWav(buffer);
  if (samples.length === 0) return 0;

  const MAX_THRESHOLD = 32760;
  let clippedCount = 0;
  let consecutiveMax = 0;

  for (let i = 0; i < samples.length; i++) {
    const absValue = Math.abs(samples[i]);
    if (absValue >= MAX_THRESHOLD) {
      consecutiveMax++;
      if (consecutiveMax >= 3) {
        clippedCount++;
      }
    } else {
      consecutiveMax = 0;
    }
  }

  return clippedCount / samples.length;
}

function vadTrim(buffer, thresholdDb = -40) {
  const { samples, sampleRate } = parseWav(buffer);
  if (samples.length === 0) return buffer;

  const threshold = Math.pow(10, thresholdDb / 20);
  const frameSize = Math.floor(sampleRate * 0.02);
  let startSample = 0;
  let endSample = samples.length;
  let foundStart = false;
  let foundEnd = false;

  for (let i = 0; i < samples.length - frameSize; i += frameSize) {
    let framePower = 0;
    for (let j = 0; j < frameSize; j++) {
      framePower += Math.pow(Math.abs(samples[i + j]) / 32768, 2);
    }
    if (Math.sqrt(framePower / frameSize) > threshold) {
      startSample = Math.max(0, i - frameSize);
      foundStart = true;
      break;
    }
  }

  for (let i = samples.length - frameSize; i >= 0; i -= frameSize) {
    let framePower = 0;
    for (let j = 0; j < frameSize; j++) {
      framePower += Math.pow(Math.abs(samples[i + j]) / 32768, 2);
    }
    if (Math.sqrt(framePower / frameSize) > threshold) {
      endSample = Math.min(samples.length, i + frameSize * 2);
      foundEnd = true;
      break;
    }
  }

  // If no voice detected, return very short buffer to trigger E103
  if (!foundStart || !foundEnd || startSample >= endSample) {
    return buffer.slice(0, WAV_HEADER_SIZE + 100);
  }

  const trimmedSamples = samples.slice(startSample, endSample);
  const dataSize = trimmedSamples.length * 2;
  const newBuffer = Buffer.alloc(WAV_HEADER_SIZE + dataSize);
  buffer.copy(newBuffer, 0, 0, WAV_HEADER_SIZE);
  newBuffer.writeUInt32LE(36 + dataSize, 4);
  newBuffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < trimmedSamples.length; i++) {
    newBuffer.writeInt16LE(trimmedSamples[i], WAV_HEADER_SIZE + i * 2);
  }
  return newBuffer;
}

function analyzeAudioQuality(buffer) {
  const errors = [];
  const metrics = { snr_db: 0, clipping_ratio: 0, vad_ratio: 0 };

  try {
    const { samples } = parseWav(buffer);
    if (samples.length < 1000) {
      errors.push("E103_NO_AUDIO_DETECTED: Audio too short");
      return { passed: false, metrics, errors };
    }

    metrics.snr_db = calculateSNR(buffer);
    
    // Check for silence first (SNR -1 indicates silence)
    if (metrics.snr_db < 0) {
      metrics.snr_db = 0;
      errors.push("E103_NO_AUDIO_DETECTED: Silent audio detected");
      return { passed: false, metrics, errors };
    }
    
    if (metrics.snr_db < 15) {
      errors.push("E101_AUDIO_TOO_NOISY: SNR is " + metrics.snr_db.toFixed(1) + "dB");
    }

    metrics.clipping_ratio = calculateClippingRatio(buffer);
    if (metrics.clipping_ratio > 0.05) {
      errors.push("E102_AUDIO_CLIPPED: " + (metrics.clipping_ratio * 100).toFixed(1) + "% clipped");
    }

    const trimmed = vadTrim(buffer, -40);
    const origSize = buffer.length - WAV_HEADER_SIZE;
    const trimSize = trimmed.length - WAV_HEADER_SIZE;
    metrics.vad_ratio = trimSize / origSize;

    if (metrics.vad_ratio < 0.1) {
      errors.push("E103_NO_AUDIO_DETECTED: Only " + (metrics.vad_ratio * 100).toFixed(1) + "% audio");
    }

    return { passed: errors.length === 0, metrics, errors };
  } catch (err) {
    errors.push(err.message);
    return { passed: false, metrics, errors };
  }
}

module.exports = { parseWav, calculateSNR, calculateClippingRatio, vadTrim, analyzeAudioQuality };
