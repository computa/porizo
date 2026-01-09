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

async function fetchJson(url, options, timeoutMs, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await withTimeout(fetch(url, options), timeoutMs);
    } catch (err) {
      if (err && err.message === "request_timeout") {
        throw err;
      }
      const message = err && err.message ? err.message : "network_error";
      throw new Error(`provider_error:network:${message}`);
    }
    if (response.ok) {
      return response.json();
    }
    // Handle retryable errors (502, 503, 504)
    if ([502, 503, 504].includes(response.status) && attempt < retries) {
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000); // Exponential backoff: 1s, 2s, 4s, 8s
      console.warn(`[HTTP] ${response.status} error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }
    const text = await response.text();
    // Provide cleaner error for gateway errors
    if (response.status === 502) {
      lastError = new Error(`provider_error:502:Music service temporarily unavailable. Please try again.`);
    } else if (response.status === 503) {
      lastError = new Error(`provider_error:503:Music service is overloaded. Please try again later.`);
    } else {
      lastError = new Error(`provider_error:${response.status}:${text.slice(0, 200)}`);
    }
  }
  throw lastError;
}

/**
 * Fetch binary data (e.g., audio files) from URL
 * @returns {Promise<Buffer>}
 */
async function fetchBinary(url, options, timeoutMs) {
  let response;
  try {
    response = await withTimeout(fetch(url, options), timeoutMs);
  } catch (err) {
    if (err && err.message === "request_timeout") {
      throw err;
    }
    const message = err && err.message ? err.message : "network_error";
    throw new Error(`provider_error:network:${message}`);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider_error:${response.status}:${text}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch binary data with response headers (for credit tracking)
 * @returns {Promise<{buffer: Buffer, headers: Headers}>}
 */
async function fetchBinaryWithHeaders(url, options, timeoutMs) {
  let response;
  try {
    response = await withTimeout(fetch(url, options), timeoutMs);
  } catch (err) {
    if (err && err.message === "request_timeout") {
      throw err;
    }
    const message = err && err.message ? err.message : "network_error";
    throw new Error(`provider_error:network:${message}`);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider_error:${response.status}:${text}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, headers: response.headers };
}

async function downloadToFile(url, outputPath, timeoutMs) {
  let response;
  try {
    response = await withTimeout(fetch(url), timeoutMs);
  } catch (err) {
    if (err && err.message === "request_timeout") {
      throw err;
    }
    const message = err && err.message ? err.message : "network_error";
    throw new Error(`download_error:network:${message}`);
  }
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
  fetchBinaryWithHeaders,
  downloadToFile,
  ensureDir,
};
