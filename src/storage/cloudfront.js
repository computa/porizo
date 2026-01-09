/**
 * CloudFront Signed URL Generator
 *
 * Generates signed URLs for CloudFront distribution access.
 * Uses RSA key pair signing for secure content delivery.
 *
 * Configuration:
 * - CLOUDFRONT_DOMAIN: CloudFront distribution domain (e.g., d1234567890.cloudfront.net)
 * - CLOUDFRONT_KEY_PAIR_ID: Key pair ID from CloudFront trusted key groups
 * - CLOUDFRONT_PRIVATE_KEY: RSA private key (PEM format) or path to key file
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * Create a CloudFront URL signer
 *
 * @param {Object} config - Configuration options
 * @param {string} config.CLOUDFRONT_DOMAIN - CloudFront distribution domain
 * @param {string} config.CLOUDFRONT_KEY_PAIR_ID - Key pair ID
 * @param {string} config.CLOUDFRONT_PRIVATE_KEY - Private key (PEM string or file path)
 * @returns {Object} CloudFront signer with createSignedUrl method
 */
function createCloudFrontSigner(config = {}) {
  const domain = config.CLOUDFRONT_DOMAIN || process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = config.CLOUDFRONT_KEY_PAIR_ID || process.env.CLOUDFRONT_KEY_PAIR_ID;
  let privateKey = config.CLOUDFRONT_PRIVATE_KEY || process.env.CLOUDFRONT_PRIVATE_KEY;

  if (!domain || !keyPairId || !privateKey) {
    throw new Error(
      'CloudFront signer requires CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY.'
    );
  }

  // If privateKey looks like a file path, read it
  if (privateKey.startsWith('/') || privateKey.startsWith('./')) {
    privateKey = fs.readFileSync(privateKey, 'utf8');
  }

  // Ensure key is in PEM format
  if (!privateKey.includes('-----BEGIN')) {
    throw new Error('CLOUDFRONT_PRIVATE_KEY must be in PEM format');
  }

  /**
   * Create a signed URL for CloudFront
   *
   * @param {Object} options - Signing options
   * @param {string} options.path - Resource path (e.g., /tracks/user123/master.aac)
   * @param {number} [options.expiresInSeconds=3600] - URL validity in seconds
   * @returns {Object} Signed URL details
   */
  function createSignedUrl({ path, expiresInSeconds = 3600 }) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    // Construct the URL
    const url = path.startsWith('http')
      ? path
      : `https://${domain}${path.startsWith('/') ? '' : '/'}${path}`;

    // Sign with canned policy for simpler URLs
    const signature = signCannedPolicy(url, expiresAt, privateKey);

    // Build signed URL with query parameters
    const signedUrl = `${url}?Expires=${expiresAt}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;

    return {
      url: signedUrl,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      domain,
      path,
    };
  }

  /**
   * Create a signed URL for streaming (HLS/DASH)
   * Shorter expiration for security
   *
   * @param {Object} options - Signing options
   * @param {string} options.path - Stream path
   * @param {number} [options.expiresInSeconds=900] - URL validity (15 min default for streaming)
   * @returns {Object} Signed URL details
   */
  function createSignedStreamUrl({ path, expiresInSeconds = 900 }) {
    return createSignedUrl({ path, expiresInSeconds });
  }

  /**
   * Create signed URLs for HLS playlist and all segments
   * Returns URLs for playlist and segment signing
   *
   * @param {Object} options - Signing options
   * @param {string} options.basePath - Base path for the track
   * @param {number} [options.expiresInSeconds=900] - URL validity
   * @returns {Object} Signed URLs for playlist
   */
  function createSignedPlaylistUrls({ basePath, expiresInSeconds = 900 }) {
    const playlistUrl = createSignedUrl({
      path: `${basePath}/playlist.m3u8`,
      expiresInSeconds,
    });

    // For segments, we create a pattern that can be used with signed cookies
    // or individual segment signing
    return {
      playlist: playlistUrl,
      basePath,
      expiresInSeconds,
      // Helper to sign individual segments on-demand
      signSegment: (segmentName) =>
        createSignedUrl({
          path: `${basePath}/${segmentName}`,
          expiresInSeconds,
        }),
    };
  }

  /**
   * Validate configuration by testing signature generation
   */
  function healthCheck() {
    try {
      createSignedUrl({ path: '/test', expiresInSeconds: 60 });
      return { healthy: true };
    } catch (err) {
      return { healthy: false, error: err.message };
    }
  }

  return {
    createSignedUrl,
    createSignedStreamUrl,
    createSignedPlaylistUrls,
    healthCheck,
    domain,
    keyPairId,
  };
}

/**
 * Sign a CloudFront URL using canned policy
 *
 * @param {string} url - Full URL to sign
 * @param {number} expires - Expiration timestamp (Unix epoch seconds)
 * @param {string} privateKey - RSA private key in PEM format
 * @returns {string} Base64-encoded signature (URL-safe)
 */
function signCannedPolicy(url, expires, privateKey) {
  // CloudFront canned policy format
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: url,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': expires,
          },
        },
      },
    ],
  });

  // Sign with RSA-SHA1 (CloudFront requirement)
  const sign = crypto.createSign('RSA-SHA1');
  sign.update(policy);
  const signature = sign.sign(privateKey, 'base64');

  // Make URL-safe (CloudFront specific encoding)
  return signature.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

/**
 * Sign a CloudFront URL using custom policy (for advanced use cases)
 *
 * @param {Object} policy - Custom policy object
 * @param {string} privateKey - RSA private key in PEM format
 * @returns {Object} Encoded policy and signature
 */
function signCustomPolicy(policy, privateKey) {
  const policyString = JSON.stringify(policy);

  // Sign with RSA-SHA1
  const sign = crypto.createSign('RSA-SHA1');
  sign.update(policyString);
  const signature = sign.sign(privateKey, 'base64');

  // Base64 encode the policy
  const encodedPolicy = Buffer.from(policyString).toString('base64');

  // Make URL-safe
  const urlSafeSignature = signature.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
  const urlSafePolicy = encodedPolicy.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');

  return {
    signature: urlSafeSignature,
    policy: urlSafePolicy,
  };
}

module.exports = {
  createCloudFrontSigner,
  signCannedPolicy,
  signCustomPolicy,
};
