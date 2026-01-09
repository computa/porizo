const { createLocalStorage } = require("./local");
const { createS3Storage } = require("./s3");
const { createCloudFrontSigner } = require("./cloudfront");

/**
 * Create a storage provider based on configuration
 *
 * @param {Object} config - Storage configuration
 * @param {string} [config.STORAGE_PROVIDER] - 'local' or 's3' (default: 'local')
 * @returns {Object} Storage provider instance
 */
function createStorageProvider(config) {
  const provider = (config.STORAGE_PROVIDER || "local").toLowerCase();
  if (provider === "s3") {
    return createS3Storage(config);
  }
  return createLocalStorage(config);
}

/**
 * Create a CDN signer for signed URL generation
 * Returns null if CloudFront is not configured
 *
 * @param {Object} config - CloudFront configuration
 * @returns {Object|null} CloudFront signer or null
 */
function createCDNSigner(config = {}) {
  const domain = config.CLOUDFRONT_DOMAIN || process.env.CLOUDFRONT_DOMAIN;
  if (!domain) {
    return null;
  }
  try {
    return createCloudFrontSigner(config);
  } catch {
    return null;
  }
}

// Enrollment storage keys
function enrollmentChunkKey({ userId, sessionId, chunkId }) {
  return `enrollment/raw/${userId}/${sessionId}/${chunkId}.wav`;
}

function enrollmentCleanKey({ userId, sessionId }) {
  return `enrollment/clean/${userId}/${sessionId}/clean.wav`;
}

// Voice profile storage keys
function voiceEmbeddingKey({ userId, voiceProfileId }) {
  return `voice_profiles/${userId}/${voiceProfileId}/embedding.bin`;
}

// Track storage keys
function trackVersionKey({ userId, trackId, versionNum }) {
  return `tracks/${userId}/${trackId}/v${versionNum}`;
}

function trackMasterKey({ userId, trackId, versionNum, format = 'aac' }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/master.${format}`;
}

function trackPreviewKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/preview.aac`;
}

function trackStemsKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/stems/`;
}

function trackHLSKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/hls/`;
}

module.exports = {
  // Providers
  createStorageProvider,
  createCDNSigner,
  createCloudFrontSigner,
  createS3Storage,
  createLocalStorage,
  // Key generators
  enrollmentChunkKey,
  enrollmentCleanKey,
  voiceEmbeddingKey,
  trackVersionKey,
  trackMasterKey,
  trackPreviewKey,
  trackStemsKey,
  trackHLSKey,
};
