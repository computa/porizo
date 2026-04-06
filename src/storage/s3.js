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
  // Support both R2_* and S3_* env vars (R2 takes precedence via config.js)
  const accessKeyId = config.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = config.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || null;
  // R2 uses "auto" as region for signing
  const region = config.S3_REGION || process.env.AWS_REGION || "auto";
  const bucket = config.S3_BUCKET || process.env.R2_BUCKET_NAME;
  const endpoint = config.S3_ENDPOINT || process.env.R2_ENDPOINT || null;
  // R2 works best with path-style URLs
  const forcePathStyle = String(config.S3_FORCE_PATH_STYLE ?? "true") === "true";
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

  function presign({ method, key, expiresInSec, contentType }) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const { host, url, canonicalUri } = buildS3Endpoint({
      endpoint,
      bucket,
      key,
      forcePathStyle,
      region,
    });

    // Build signed headers - include content-type for PUT uploads if provided
    const signedHeadersList = ["host"];
    if (contentType && method === "PUT") {
      signedHeadersList.push("content-type");
    }
    signedHeadersList.sort();
    const signedHeaders = signedHeadersList.join(";");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const query = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSec || defaultExpiresSec),
      "X-Amz-SignedHeaders": signedHeaders,
    };
    if (sessionToken) {
      query["X-Amz-Security-Token"] = sessionToken;
    }

    const sortedQuery = Object.keys(query)
      .sort()
      .map((keyName) => `${encodeURIComponent(keyName)}=${encodeURIComponent(query[keyName])}`)
      .join("&");

    // Build canonical headers - must be sorted and include all signed headers
    let canonicalHeaders = "";
    if (contentType && method === "PUT") {
      canonicalHeaders += `content-type:${contentType}\n`;
    }
    canonicalHeaders += `host:${host}\n`;

    const canonicalRequest = [
      method,
      canonicalUri,
      sortedQuery,
      canonicalHeaders,
      signedHeaders,
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
    const presigned = presign({ method: "PUT", key, expiresInSec, contentType });
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

  async function objectExists({ key, maxRetries = 2 }) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const presigned = presign({ method: "HEAD", key, expiresInSec: 60 });
      try {
        const response = await fetch(presigned.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return true;
        if (response.status === 404) return false;
        // 5xx is transient — retry rather than returning false
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = new Error(`S3 HEAD failed (${response.status}) for ${key}`);
        } else {
          throw new Error(`S3 HEAD failed (${response.status}) for ${key}`);
        }
      } catch (err) {
        if (err.name === "TimeoutError" || err.cause?.code === "ECONNRESET") {
          if (attempt >= maxRetries) throw err;
          lastError = err;
        } else if (err.message?.startsWith("S3 HEAD failed")) {
          if (attempt >= maxRetries) throw err;
          lastError = err;
        } else {
          throw err;
        }
      }
      const delayMs = 1000 * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw lastError;
  }

  async function downloadToFile({ key, filePath, maxRetries = 3 }) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const presigned = presign({ method: "GET", key, expiresInSec: 300 });
      try {
        const response = await fetch(presigned.url, {
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          ensureDir(path.dirname(filePath));
          fs.writeFileSync(filePath, buffer);
          return;
        }
        const isTransient = response.status >= 500;
        if (!isTransient || attempt >= maxRetries) {
          throw new Error(`S3 download failed (${response.status}) for ${key}`);
        }
        lastError = new Error(`S3 download failed (${response.status}) for ${key}`);
      } catch (err) {
        const isNetworkError = err.name === "TimeoutError" || err.cause?.code === "ECONNRESET" || err.cause?.code === "ETIMEDOUT";
        if (!isNetworkError && !err.message?.startsWith("S3 download failed (5")) {
          throw err;
        }
        if (attempt >= maxRetries) throw err;
        lastError = err;
      }
      const delayMs = 1000 * Math.pow(2, attempt);
      console.warn(`[S3] Download attempt ${attempt + 1}/${maxRetries + 1} failed for ${key}, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw lastError;
  }

  async function putFile({ key, filePath, contentType, maxRetries = 3 }) {
    const buffer = fs.readFileSync(filePath);
    const headers = contentType ? { "Content-Type": contentType } : {};

    // Add encryption headers for sensitive paths when KMS is configured
    const pathInfo = getKeyForPath(key);
    if (kmsConfig && pathInfo.encrypted) {
      const encryptionHeaders = getS3EncryptionHeaders(kmsConfig);
      Object.assign(headers, encryptionHeaders);
    }

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fresh presigned URL per attempt (avoids expiry on retries)
      const presigned = presign({ method: "PUT", key, expiresInSec: 300 });
      try {
        const response = await fetch(presigned.url, {
          method: "PUT",
          headers,
          body: buffer,
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return;

        const isTransient = response.status >= 500;
        if (!isTransient || attempt >= maxRetries) {
          throw new Error(`S3 upload failed (${response.status}) for ${key}`);
        }
        lastError = new Error(`S3 upload failed (${response.status}) for ${key}`);
      } catch (err) {
        // Network errors (ECONNRESET, timeout) are transient
        const isNetworkError = err.cause?.code === "ECONNRESET" || err.cause?.code === "ETIMEDOUT" || err.message?.includes("fetch failed");
        if (!isNetworkError && !err.message?.startsWith("S3 upload failed (5")) {
          throw err; // Non-transient error, don't retry
        }
        if (attempt >= maxRetries) throw err;
        lastError = err;
      }
      const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      console.warn(`[S3] Upload attempt ${attempt + 1}/${maxRetries + 1} failed for ${key}, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw lastError;
  }

  async function deleteObject({ key }) {
    const presigned = presign({ method: "DELETE", key, expiresInSec: 300 });
    const response = await fetch(presigned.url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed (${response.status}) for ${key}`);
    }
  }

  /**
   * List objects with a given prefix
   * @param {Object} options
   * @param {string} options.prefix - Prefix to filter objects
   * @param {number} options.maxKeys - Max number of keys to return (default 1000)
   * @returns {Promise<{keys: string[], prefixes: string[]}>} List of object keys and common prefixes
   */
  async function listObjects({ prefix, maxKeys = 1000 }) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    // Build the URL for ListObjectsV2
    const baseUrl = endpoint || `https://s3.${region}.amazonaws.com`;
    const parsed = new URL(baseUrl);
    const host = forcePathStyle ? parsed.host : `${bucket}.${parsed.host}`;
    const canonicalUri = forcePathStyle ? `/${bucket}/` : "/";

    // Query parameters for ListObjectsV2
    const queryParams = {
      "list-type": "2",
      "prefix": prefix || "",
      "max-keys": String(maxKeys),
      "delimiter": "/",
    };

    const sortedQuery = Object.keys(queryParams)
      .sort()
      .map((keyName) => `${encodeURIComponent(keyName)}=${encodeURIComponent(queryParams[keyName])}`)
      .join("&");

    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      "GET",
      canonicalUri,
      sortedQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashSha256(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, "s3");
    const signature = hmac(signingKey, stringToSign, "hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const url = forcePathStyle
      ? `${parsed.protocol}//${parsed.host}/${bucket}/?${sortedQuery}`
      : `${parsed.protocol}//${bucket}.${parsed.host}/?${sortedQuery}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Host": host,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
        "Authorization": authorization,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`S3 listObjects failed (${response.status}): ${text}`);
    }

    const xml = await response.text();

    // Parse XML response (simple regex-based parsing)
    const keys = [];
    const prefixes = [];

    // Extract object keys
    const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const match of keyMatches) {
      keys.push(match[1]);
    }

    // Extract common prefixes (directories)
    const prefixMatches = xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g);
    for (const match of prefixMatches) {
      // Skip the query prefix itself
      if (match[1] !== prefix) {
        prefixes.push(match[1]);
      }
    }

    return { keys, prefixes };
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
    listObjects,
    // Encryption helpers
    getPathEncryptionInfo,
    isEncryptionEnabled,
  };
}

module.exports = {
  createS3Storage,
};
