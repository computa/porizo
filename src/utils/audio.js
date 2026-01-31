const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Parse WAV file to extract format info and data location.
 * Handles extended WAV formats with JUNK, LIST, and other metadata chunks.
 * (iOS's AVAudioRecorder adds these extra chunks)
 */
function parseWavBuffer(buffer) {
  if (buffer.length < 44) {
    throw new Error("E105_INVALID_WAV: Buffer too small for WAV header");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("E105_INVALID_WAV: Invalid WAV header");
  }

  let sampleRate = 0;
  let bitsPerSample = 16;
  let numChannels = 1;
  let dataOffset = 0;
  let dataSize = 0;

  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  console.log("[parseWav] Starting chunk scan, buffer length:", buffer.length);
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    console.log("[parseWav] Chunk:", JSON.stringify(chunkId), "size:", chunkSize, "at offset:", offset);

    if (chunkId === "fmt ") {
      numChannels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break; // Found data chunk, we're done
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 === 1) offset++; // WAV chunks are word-aligned
  }

  if (sampleRate === 0 || dataSize === 0) {
    throw new Error("E105_INVALID_WAV: Missing fmt or data chunk");
  }

  const bytesPerSample = (bitsPerSample / 8) * numChannels;
  const durationSec = dataSize / bytesPerSample / sampleRate;

  return {
    sampleRate,
    bitsPerSample,
    numChannels,
    dataOffset,
    dataSize,
    durationSec,
  };
}

function writeWav(filePath, { durationSec = 2, frequencyHz = 440, sampleRate = 44100 }) {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    const intSample = Math.max(-1, Math.min(1, sample)) * 0x7fff;
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

function concatWavFiles(inputPaths, outputPath) {
  if (!inputPaths || inputPaths.length === 0) {
    throw new Error("E105_NO_AUDIO: No WAV files to concatenate");
  }
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  const dataChunks = [];

  for (const inputPath of inputPaths) {
    const buffer = fs.readFileSync(inputPath);
    const wavInfo = parseWavBuffer(buffer);

    if (sampleRate === null) {
      sampleRate = wavInfo.sampleRate;
      channels = wavInfo.numChannels;
      bitsPerSample = wavInfo.bitsPerSample;
    } else if (sampleRate !== wavInfo.sampleRate || channels !== wavInfo.numChannels || bitsPerSample !== wavInfo.bitsPerSample) {
      throw new Error("E105_WAV_MISMATCH: WAV formats differ");
    }
    // Extract actual audio data using parsed offset
    dataChunks.push(buffer.slice(wavInfo.dataOffset, wavInfo.dataOffset + wavInfo.dataSize));
  }

  const dataSize = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  header.writeUInt32LE(byteRate, 28);
  const blockAlign = channels * (bitsPerSample / 8);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, Buffer.concat([header, ...dataChunks]));
}

module.exports = {
  writeWav,
  concatWavFiles,
  parseWavBuffer,
};
