const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getKeyForPath, getS3EncryptionHeaders } = require("./kms");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hashSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function getSignatureKey(secret, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function buildS3Endpoint({ endpoint, bucket, key, forcePathStyle, region }) {
  const baseUrl = endpoint || `https://s3.${region || "us-east-1"}.amazonaws.com`;
  const parsed = new URL(baseUrl);
  const encodedKey = encodeKey(key);

  if (forcePathStyle) {
    return {
      host: parsed.host,
      url: `${parsed.protocol}//${parsed.host}/${bucket}/${encodedKey}`,
      canonicalUri: `/${bucket}/${encodedKey}`,
    };
  }

  return {
    host: `${bucket}.${parsed.host}`,
    url: `${parsed.protocol}//${bucket}.${parsed.host}/${encodedKey}`,
    canonicalUri: `/${encodedKey}`,
  };
}

function createS3Storage(config = {}) {
  const accessKeyId = config.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = config.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || null;
  const region = config.S3_REGION || process.env.AWS_REGION || "us-east-1";
  const bucket = config.S3_BUCKET;
  const endpoint = config.S3_ENDPOINT || null;
  const forcePathStyle = String(config.S3_FORCE_PATH_STYLE || "false") === "true";
  const defaultExpiresSec = Number(config.S3_URL_EXPIRES_SEC || config.UPLOAD_URL_TTL_SEC || 900);

  // Optional KMS configuration for encrypting sensitive data
  let kmsConfig = null;
  const kmsKeyId = config.KMS_KEY_ID || process.env.KMS_KEY_ID;
  if (kmsKeyId) {
    kmsConfig = {
      keyId: kmsKeyId,
      region: config.KMS_REGION || process.env.KMS_REGION || region,
      useBucketKey: String(config.KMS_USE_BUCKET_KEY || process.env.KMS_USE_BUCKET_KEY || "false") === "true",
    };
  }

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("S3 storage requires S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET.");
  }

  function presign({ method, key, expiresInSec }) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const { host, url, canonicalUri } = buildS3Endpoint({
      endpoint,
      bucket,
      key,
      forcePathStyle,
      region,
    });

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const query = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSec || defaultExpiresSec),
      "X-Amz-SignedHeaders": "host",
    };
    if (sessionToken) {
      query["X-Amz-Security-Token"] = sessionToken;
    }

    const sortedQuery = Object.keys(query)
      .sort()
      .map((keyName) => `${encodeURIComponent(keyName)}=${encodeURIComponent(query[keyName])}`)
      .join("&");

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      method,
      canonicalUri,
      sortedQuery,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashSha256(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, "s3");
    const signature = hmac(signingKey, stringToSign, "hex");
    const fullUrl = `${url}?${sortedQuery}&X-Amz-Signature=${signature}`;

    return {
      url: fullUrl,
      expiresAt: new Date(Date.now() + (expiresInSec || defaultExpiresSec) * 1000).toISOString(),
    };
  }

  function createPresignedUpload({ key, contentType, expiresInSec }) {
    const presigned = presign({ method: "PUT", key, expiresInSec });
    const headers = contentType ? { "Content-Type": contentType } : {};

    // Add encryption headers for sensitive paths when KMS is configured
    const pathInfo = getKeyForPath(key);
    if (kmsConfig && pathInfo.encrypted) {
      const encryptionHeaders = getS3EncryptionHeaders(kmsConfig);
      Object.assign(headers, encryptionHeaders);
    }

    return {
      url: presigned.url,
      method: "PUT",
      headers,
      expiresAt: presigned.expiresAt,
      encrypted: pathInfo.encrypted,
      sensitive: pathInfo.sensitive,
    };
  }

  function createPresignedDownload({ key, expiresInSec }) {
    const presigned = presign({ method: "GET", key, expiresInSec });
    return {
      url: presigned.url,
      method: "GET",
      headers: {},
      expiresAt: presigned.expiresAt,
    };
  }

  async function objectExists({ key }) {
    const presigned = presign({ method: "HEAD", key, expiresInSec: 60 });
    const response = await fetch(presigned.url, { method: "HEAD" });
    return response.ok;
  }

  async function downloadToFile({ key, filePath }) {
    const presigned = presign({ method: "GET", key, expiresInSec: 300 });
    const response = await fetch(presigned.url);
    if (!response.ok) {
      throw new Error(`S3 download failed (${response.status}) for ${key}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, buffer);
  }

  async function putFile({ key, filePath, contentType }) {
    const presigned = presign({ method: "PUT", key, expiresInSec: 300 });
    const buffer = fs.readFileSync(filePath);
    const headers = contentType ? { "Content-Type": contentType } : {};

    // Add encryption headers for sensitive paths when KMS is configured
    const pathInfo = getKeyForPath(key);
    if (kmsConfig && pathInfo.encrypted) {
      const encryptionHeaders = getS3EncryptionHeaders(kmsConfig);
      Object.assign(headers, encryptionHeaders);
    }

    const response = await fetch(presigned.url, {
      method: "PUT",
      headers,
      body: buffer,
    });
    if (!response.ok) {
      throw new Error(`S3 upload failed (${response.status}) for ${key}`);
    }
  }

  async function deleteObject({ key }) {
    const presigned = presign({ method: "DELETE", key, expiresInSec: 300 });
    const response = await fetch(presigned.url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed (${response.status}) for ${key}`);
    }
  }

  /**
   * Check if a path requires encryption
   * @param {string} key - S3 object key
   * @returns {Object} Path encryption info
   */
  function getPathEncryptionInfo(key) {
    return getKeyForPath(key);
  }

  /**
   * Check if KMS encryption is configured
   * @returns {boolean} True if KMS is configured
   */
  function isEncryptionEnabled() {
    return kmsConfig !== null;
  }

  return {
    type: "s3",
    createPresignedUpload,
    createPresignedDownload,
    objectExists,
    downloadToFile,
    putFile,
    deleteObject,
    // Encryption helpers
    getPathEncryptionInfo,
    isEncryptionEnabled,
  };
}

module.exports = {
  createS3Storage,
};
