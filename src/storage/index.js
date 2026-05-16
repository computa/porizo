const { createLocalStorage } = require("./local");
const { createS3Storage } = require("./s3");
const { createCloudFrontSigner } = require("./cloudfront");
const lifecycle = require("./lifecycle");
const kms = require("./kms");

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

function enrollmentSunoPersonaKey({ userId, sessionId }) {
  return `enrollment/clean/${userId}/${sessionId}/suno-persona.wav`;
}

// Voice profile storage keys
function voiceEmbeddingKey({ userId, voiceProfileId }) {
  return `voice_profiles/${userId}/${voiceProfileId}/embedding.bin`;
}

// Track storage keys
function trackVersionKey({ userId, trackId, versionNum }) {
  return `tracks/${userId}/${trackId}/v${versionNum}`;
}

function trackMasterKey({ userId, trackId, versionNum, format = "aac" }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/master.${format}`;
}

function trackPreviewKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/preview.m4a`;
}

function trackStemsKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/stems/`;
}

function trackHLSKey({ userId, trackId, versionNum }) {
  return `${trackVersionKey({ userId, trackId, versionNum })}/hls/`;
}

// Per-song occasion artwork. Lives at the TRACK root (not v{n}/) so it survives
// audio retries — its identity is (occasion + recipient), not the audio bytes.
function trackArtworkKey({ userId, trackId }) {
  return `tracks/${userId}/${trackId}/artwork.jpg`;
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
  enrollmentSunoPersonaKey,
  voiceEmbeddingKey,
  trackVersionKey,
  trackMasterKey,
  trackPreviewKey,
  trackStemsKey,
  trackHLSKey,
  trackArtworkKey,
  // Lifecycle policies
  ...lifecycle,
  // KMS encryption
  ...kms,
};
