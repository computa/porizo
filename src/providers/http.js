const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("request_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJson(url, options, timeoutMs) {
  const response = await withTimeout(fetch(url, options), timeoutMs);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider_error:${response.status}:${text}`);
  }
  return response.json();
}

/**
 * Fetch binary data (e.g., audio files) from URL
 * @returns {Promise<Buffer>}
 */
async function fetchBinary(url, options, timeoutMs) {
  const response = await withTimeout(fetch(url, options), timeoutMs);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider_error:${response.status}:${text}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadToFile(url, outputPath, timeoutMs) {
  const response = await withTimeout(fetch(url), timeoutMs);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`download_error:${response.status}:${text}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, buffer);
}

module.exports = {
  fetchJson,
  fetchBinary,
  downloadToFile,
  ensureDir,
};
