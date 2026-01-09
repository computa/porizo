const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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
    return path.join(storageDir, key);
  }

  async function objectExists({ key }) {
    return fs.existsSync(resolveLocalPath(key));
  }

  async function listKeys({ prefix }) {
    const dirPath = path.join(storageDir, prefix);
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.posix.join(prefix, entry.name));
  }

  async function downloadToFile({ key, filePath }) {
    const source = resolveLocalPath(key);
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
    if (path.resolve(destination) === path.resolve(filePath)) {
      return;
    }
    ensureDir(path.dirname(destination));
    fs.copyFileSync(filePath, destination);
  }

  async function deleteObject({ key }) {
    const destination = resolveLocalPath(key);
    if (!fs.existsSync(destination)) {
      return;
    }
    fs.rmSync(destination, { force: true });
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
    downloadToFile,
    putFile,
    deleteObject,
  };
}

module.exports = {
  createLocalStorage,
};
