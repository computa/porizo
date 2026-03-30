const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getKeyForPath } = require("./kms");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function createLocalStorage(config = {}) {
  const storageDir = config.STORAGE_DIR || config.storageDir || process.cwd();
  const baseUrl = normalizeBaseUrl(
    config.STREAM_BASE_URL || config.streamBaseUrl || "http://localhost:3000"
  );
  const signingSecret =
    config.UPLOAD_SIGNING_SECRET ||
    config.uploadSigningSecret ||
    crypto.randomBytes(32).toString("hex");
  const defaultExpiresSec = Number(config.UPLOAD_URL_TTL_SEC || 900);

  if (!config.UPLOAD_SIGNING_SECRET && !config.uploadSigningSecret) {
    console.warn("[Storage] UPLOAD_SIGNING_SECRET not set; using ephemeral key.");
  }

  function sign({ key, expiresAt, contentType, purpose }) {
    const payload = [purpose || "upload", key, String(expiresAt), contentType || ""].join("|");
    return crypto.createHmac("sha256", signingSecret).update(payload).digest("hex");
  }

  function resolveBaseUrl(overrideBaseUrl) {
    return normalizeBaseUrl(overrideBaseUrl || baseUrl);
  }

  function createPresignedUpload({ key, contentType, expiresInSec, baseUrl: overrideBaseUrl }) {
    const expiresAt = Date.now() + (expiresInSec || defaultExpiresSec) * 1000;
    const signature = sign({ key, expiresAt, contentType, purpose: "upload" });
    const resolvedBaseUrl = resolveBaseUrl(overrideBaseUrl);
    const url = `${resolvedBaseUrl}/storage/upload?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${signature}&content_type=${encodeURIComponent(contentType || "")}`;
    return {
      url,
      method: "PUT",
      headers: contentType ? { "Content-Type": contentType } : {},
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  function createPresignedDownload({ key, expiresInSec, baseUrl: overrideBaseUrl }) {
    const expiresAt = Date.now() + (expiresInSec || defaultExpiresSec) * 1000;
    const signature = sign({ key, expiresAt, purpose: "download" });
    const resolvedBaseUrl = resolveBaseUrl(overrideBaseUrl);
    const url = `${resolvedBaseUrl}/storage/download?key=${encodeURIComponent(key)}&expires=${expiresAt}&sig=${signature}`;
    return {
      url,
      method: "GET",
      headers: {},
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  function verifyPresignedRequest({ key, expiresAt, signature, contentType, purpose }) {
    const expected = sign({ key, expiresAt, contentType, purpose });
    const sigBuffer = Buffer.from(signature || "");
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  }

  function resolveLocalPath(key) {
    const resolved = path.resolve(storageDir, key);
    const root = path.resolve(storageDir) + path.sep;
    if (!resolved.startsWith(root)) {
      return null;
    }
    return resolved;
  }

  async function objectExists({ key }) {
    const resolved = resolveLocalPath(key);
    if (!resolved) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + key);
    }
    return fs.existsSync(resolved);
  }

  async function listKeys({ prefix }) {
    const dirPath = resolveLocalPath(prefix);
    if (!dirPath) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + prefix);
    }
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.posix.join(prefix, entry.name));
  }

  /**
   * List objects with a given prefix (S3-compatible interface)
   * @param {Object} options
   * @param {string} options.prefix - Prefix to filter objects
   * @returns {Promise<{keys: string[], prefixes: string[]}>}
   */
  async function listObjects({ prefix }) {
    const safePfx = prefix || "";
    const dirPath = resolveLocalPath(safePfx);
    if (!dirPath) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + safePfx);
    }
    if (!fs.existsSync(dirPath)) {
      return { keys: [], prefixes: [] };
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const keys = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.posix.join(safePfx, entry.name));
    const prefixes = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.posix.join(safePfx, entry.name) + "/");
    return { keys, prefixes };
  }

  async function downloadToFile({ key, filePath }) {
    const source = resolveLocalPath(key);
    if (!source) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + key);
    }
    if (!fs.existsSync(source)) {
      throw new Error(`Local object missing: ${key}`);
    }
    if (path.resolve(source) === path.resolve(filePath)) {
      return;
    }
    ensureDir(path.dirname(filePath));
    fs.copyFileSync(source, filePath);
  }

  async function putFile({ key, filePath }) {
    const destination = resolveLocalPath(key);
    if (!destination) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + key);
    }
    if (path.resolve(destination) === path.resolve(filePath)) {
      return;
    }
    ensureDir(path.dirname(destination));
    fs.copyFileSync(filePath, destination);
  }

  async function deleteObject({ key }) {
    const destination = resolveLocalPath(key);
    if (!destination) {
      throw new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + key);
    }
    if (!fs.existsSync(destination)) {
      return;
    }
    fs.rmSync(destination, { force: true });
  }

  /**
   * Check if a path requires encryption (for API consistency with S3)
   * Local storage doesn't actually encrypt, but this helps callers know
   * whether they're dealing with sensitive data.
   */
  function getPathEncryptionInfo(key) {
    return getKeyForPath(key);
  }

  /**
   * Check if encryption is enabled (always false for local storage)
   */
  function isEncryptionEnabled() {
    return false;
  }

  return {
    type: "local",
    storageDir,
    createPresignedUpload,
    createPresignedDownload,
    verifyPresignedRequest,
    resolveLocalPath,
    objectExists,
    listKeys,
    listObjects,
    downloadToFile,
    putFile,
    deleteObject,
    // Encryption helpers (for API consistency with S3)
    getPathEncryptionInfo,
    isEncryptionEnabled,
  };
}

module.exports = {
  createLocalStorage,
};
