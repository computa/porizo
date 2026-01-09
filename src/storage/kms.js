/**
 * KMS Encryption Key Management
 *
 * Handles AWS KMS key management for encrypting sensitive data:
 * - Voice embeddings (user voice profiles)
 * - Enrollment recordings (before processing)
 *
 * Configuration:
 * - KMS_KEY_ID: KMS key ID or alias (e.g., alias/porizo-master)
 * - KMS_REGION: AWS region (default: us-east-1)
 * - KMS_USE_BUCKET_KEY: Enable S3 Bucket Keys for cost optimization
 *
 * Per CLAUDE.md:
 * - Voice embeddings encrypted with user-specific KMS keys
 * - Raw recordings auto-deleted after 7 days
 */

const crypto = require('crypto');

/**
 * Sensitive path patterns that require encryption
 */
const SENSITIVE_PATH_PATTERNS = [
  {
    pattern: /^voice_profiles\//,
    type: 'voice_profile',
    description: 'Voice embeddings - highly sensitive biometric data',
    sensitive: true,
    encrypted: true,
  },
  {
    pattern: /^enrollment\/raw\//,
    type: 'enrollment_raw',
    description: 'Raw voice recordings - sensitive, auto-deleted',
    sensitive: true,
    encrypted: true,
  },
  {
    pattern: /^enrollment\/clean\//,
    type: 'enrollment_clean',
    description: 'Cleaned voice recordings - sensitive, auto-deleted',
    sensitive: true,
    encrypted: true,
  },
];

/**
 * Create KMS configuration from environment/config
 *
 * @param {Object} config - Configuration object
 * @param {string} config.KMS_KEY_ID - KMS key ID or alias
 * @param {string} [config.KMS_REGION] - AWS region
 * @param {string} [config.KMS_USE_BUCKET_KEY] - Enable S3 Bucket Keys
 * @returns {Object} KMS configuration
 */
function createKMSConfig(config = {}) {
  const keyId = config.KMS_KEY_ID || process.env.KMS_KEY_ID;
  const region = config.KMS_REGION || process.env.KMS_REGION || 'us-east-1';
  const useBucketKey = String(config.KMS_USE_BUCKET_KEY || process.env.KMS_USE_BUCKET_KEY || 'false') === 'true';

  if (!keyId) {
    throw new Error('KMS_KEY_ID is required for encryption configuration');
  }

  return {
    keyId,
    region,
    useBucketKey,
  };
}

/**
 * Get S3 server-side encryption headers for KMS
 *
 * @param {Object} kmsConfig - KMS configuration from createKMSConfig
 * @returns {Object} Headers to include in S3 PUT requests
 */
function getS3EncryptionHeaders(kmsConfig) {
  const headers = {
    'x-amz-server-side-encryption': 'aws:kms',
    'x-amz-server-side-encryption-aws-kms-key-id': kmsConfig.keyId,
  };

  if (kmsConfig.useBucketKey) {
    headers['x-amz-server-side-encryption-bucket-key-enabled'] = 'true';
  }

  return headers;
}

/**
 * Build encryption context for additional authenticated data (AAD)
 *
 * Encryption context binds ciphertext to specific metadata,
 * ensuring data can only be decrypted in the right context.
 *
 * @param {Object} params - Context parameters
 * @param {string} params.type - Data type (voice_profile, track, etc.)
 * @param {string} [params.userId] - User ID
 * @param {string} [params.voiceProfileId] - Voice profile ID
 * @param {string} [params.trackId] - Track ID
 * @returns {Object} Encryption context object
 */
function buildEncryptionContext(params) {
  if (!params.type) {
    throw new Error('type is required for encryption context');
  }

  const context = {
    type: params.type,
  };

  if (params.userId) {
    context.user_id = params.userId;
  }

  if (params.voiceProfileId) {
    context.voice_profile_id = params.voiceProfileId;
  }

  if (params.trackId) {
    context.track_id = params.trackId;
  }

  return context;
}

/**
 * Encode encryption context for S3 header
 *
 * @param {Object} context - Encryption context object
 * @returns {string} Base64-encoded JSON string
 */
function encodeEncryptionContext(context) {
  return Buffer.from(JSON.stringify(context)).toString('base64');
}

/**
 * Determine encryption requirements for a given S3 path
 *
 * @param {string} key - S3 object key
 * @returns {Object} Encryption requirements
 */
function getKeyForPath(key) {
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.pattern.test(key)) {
      return {
        encrypted: pattern.encrypted,
        sensitive: pattern.sensitive,
        type: pattern.type,
        description: pattern.description,
      };
    }
  }

  // Default: not encrypted, not sensitive
  return {
    encrypted: false,
    sensitive: false,
    type: 'public',
    description: 'Public content - no encryption required',
  };
}

/**
 * Get all sensitive path patterns
 *
 * @returns {Array} Array of sensitive path pattern configurations
 */
function getSensitivePathPatterns() {
  return SENSITIVE_PATH_PATTERNS;
}

/**
 * Create a mock KMS client for testing without AWS
 *
 * Uses AES-256 for encryption/decryption with a fixed test key.
 * NOT for production use.
 *
 * @returns {Object} Mock KMS client with encrypt, decrypt, generateDataKey
 */
function createMockKMSClient() {
  // Fixed test key (only for mock - never use in production)
  const mockMasterKey = crypto.scryptSync('porizo-test-master-key', 'porizo-salt', 32);

  return {
    /**
     * Mock encrypt operation
     */
    async encrypt({ KeyId, Plaintext, EncryptionContext }) {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', mockMasterKey, iv);

      // Include context in AAD if provided
      if (EncryptionContext) {
        cipher.setAAD(Buffer.from(JSON.stringify(EncryptionContext)));
      }

      const encrypted = Buffer.concat([cipher.update(Plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Pack IV + authTag + ciphertext
      const ciphertextBlob = Buffer.concat([
        Buffer.from([iv.length]), // 1 byte for IV length
        iv,
        authTag,
        encrypted,
      ]);

      return {
        CiphertextBlob: ciphertextBlob,
        KeyId: KeyId || 'mock-key-id',
      };
    },

    /**
     * Mock decrypt operation
     */
    async decrypt({ CiphertextBlob, EncryptionContext }) {
      const ivLength = CiphertextBlob[0];
      const iv = CiphertextBlob.subarray(1, 1 + ivLength);
      const authTag = CiphertextBlob.subarray(1 + ivLength, 1 + ivLength + 16);
      const encrypted = CiphertextBlob.subarray(1 + ivLength + 16);

      const decipher = crypto.createDecipheriv('aes-256-gcm', mockMasterKey, iv);
      decipher.setAuthTag(authTag);

      // Include context in AAD if provided
      if (EncryptionContext) {
        decipher.setAAD(Buffer.from(JSON.stringify(EncryptionContext)));
      }

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      return {
        Plaintext: decrypted,
        KeyId: 'mock-key-id',
      };
    },

    /**
     * Mock generateDataKey operation
     */
    async generateDataKey({ KeyId, KeySpec, EncryptionContext }) {
      // Generate a random data key
      let keyLength;
      switch (KeySpec) {
        case 'AES_256':
          keyLength = 32;
          break;
        case 'AES_128':
          keyLength = 16;
          break;
        default:
          keyLength = 32;
      }

      const plaintextKey = crypto.randomBytes(keyLength);

      // Encrypt the data key with the "master key"
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', mockMasterKey, iv);

      if (EncryptionContext) {
        cipher.setAAD(Buffer.from(JSON.stringify(EncryptionContext)));
      }

      const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const ciphertextBlob = Buffer.concat([
        Buffer.from([iv.length]),
        iv,
        authTag,
        encrypted,
      ]);

      return {
        Plaintext: plaintextKey,
        CiphertextBlob: ciphertextBlob,
        KeyId: KeyId || 'mock-key-id',
      };
    },
  };
}

/**
 * Create envelope encryption utilities
 *
 * Envelope encryption generates a data key, encrypts data with it,
 * then encrypts the data key with KMS. This is more efficient for
 * large amounts of data.
 *
 * @param {Object} kmsClient - KMS client (AWS SDK or mock)
 * @param {string} keyId - KMS key ID
 * @returns {Object} Envelope encryption utilities
 */
function createEnvelopeEncryption(kmsClient, keyId) {
  return {
    /**
     * Encrypt data using envelope encryption
     *
     * @param {Buffer} plaintext - Data to encrypt
     * @param {Object} [context] - Encryption context
     * @returns {Object} Encrypted data with wrapped key
     */
    async encrypt(plaintext, context) {
      // Generate a data key
      const dataKeyResult = await kmsClient.generateDataKey({
        KeyId: keyId,
        KeySpec: 'AES_256',
        EncryptionContext: context,
      });

      // Encrypt data with the plaintext data key
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', dataKeyResult.Plaintext, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Clear the plaintext key from memory
      dataKeyResult.Plaintext.fill(0);

      return {
        ciphertext: encrypted,
        iv,
        authTag,
        encryptedDataKey: dataKeyResult.CiphertextBlob,
      };
    },

    /**
     * Decrypt data using envelope encryption
     *
     * @param {Object} params - Encrypted data package
     * @param {Object} [context] - Encryption context
     * @returns {Buffer} Decrypted plaintext
     */
    async decrypt({ ciphertext, iv, authTag, encryptedDataKey }, context) {
      // Decrypt the data key
      const dataKeyResult = await kmsClient.decrypt({
        CiphertextBlob: encryptedDataKey,
        EncryptionContext: context,
      });

      // Decrypt data with the plaintext data key
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKeyResult.Plaintext, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      // Clear the plaintext key from memory
      dataKeyResult.Plaintext.fill(0);

      return decrypted;
    },
  };
}

module.exports = {
  createKMSConfig,
  getS3EncryptionHeaders,
  buildEncryptionContext,
  encodeEncryptionContext,
  getKeyForPath,
  getSensitivePathPatterns,
  createMockKMSClient,
  createEnvelopeEncryption,
  SENSITIVE_PATH_PATTERNS,
};
