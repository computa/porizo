const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

module.exports = {
  writeWav,
};
