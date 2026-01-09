/**
 * S3 Lifecycle Policy Configuration
 *
 * Defines retention policies for different storage paths:
 * - Enrollment data: 7-day retention (privacy protection)
 * - Voice profiles: Indefinite retention (encrypted)
 * - Tracks: Indefinite retention (user deliverables)
 * - Stems: 30-day retention (internal processing only)
 *
 * Per CLAUDE.md S3 Object Layout:
 * enrollment/raw/{user_id}/{session_id}/{chunk_id}.wav    # 7-day retention
 * enrollment/clean/{user_id}/{session_id}/clean.wav       # 7-day retention
 * voice_profiles/{user_id}/{voice_profile_id}/embedding.bin  # Encrypted, indefinite
 * tracks/{user_id}/{track_id}/v{n}/                       # indefinite
 */

/**
 * Retention policies by category
 * days: number of days before expiration (null = never expires)
 * description: Human-readable explanation
 */
const RETENTION_POLICIES = {
  enrollment_raw: {
    days: 7,
    description: 'Raw enrollment audio chunks - deleted after processing for privacy',
    prefix: 'enrollment/raw/',
  },
  enrollment_clean: {
    days: 7,
    description: 'Cleaned enrollment audio - deleted after embedding extraction',
    prefix: 'enrollment/clean/',
  },
  voice_profile: {
    days: null,
    description: 'Voice embeddings - retained indefinitely with encryption',
    prefix: 'voice_profiles/',
  },
  track: {
    days: null,
    description: 'Final track deliverables - retained indefinitely',
    prefix: 'tracks/',
    excludePattern: '/stems/',
  },
  track_stems: {
    days: 30,
    description: 'Internal processing stems - deleted after 30 days',
    // Stems are nested under tracks, matched by pattern
    pattern: /tracks\/[^/]+\/[^/]+\/v\d+\/stems\//,
  },
  unknown: {
    days: null,
    description: 'Unrecognized path - no automatic expiration',
    prefix: null,
  },
};

/**
 * Determine the retention category for a given S3 key
 *
 * @param {string} key - S3 object key
 * @returns {string} Category name (enrollment_raw, enrollment_clean, voice_profile, track, track_stems, unknown)
 */
function getRetentionCategory(key) {
  if (!key || typeof key !== 'string') {
    return 'unknown';
  }

  // Check for stems first (more specific pattern)
  if (RETENTION_POLICIES.track_stems.pattern.test(key)) {
    return 'track_stems';
  }

  // Check prefix-based categories
  if (key.startsWith('enrollment/raw/')) {
    return 'enrollment_raw';
  }
  if (key.startsWith('enrollment/clean/')) {
    return 'enrollment_clean';
  }
  if (key.startsWith('voice_profiles/')) {
    return 'voice_profile';
  }
  if (key.startsWith('tracks/')) {
    return 'track';
  }

  return 'unknown';
}

/**
 * Check if a key is subject to automatic expiration
 *
 * @param {string} key - S3 object key
 * @returns {boolean} True if the key will be automatically deleted
 */
function isExpirableKey(key) {
  const category = getRetentionCategory(key);
  const policy = RETENTION_POLICIES[category];
  return policy && policy.days !== null;
}

/**
 * Get the number of days until expiration for a key
 *
 * @param {string} key - S3 object key
 * @returns {number|null} Days until expiration, or null if never expires
 */
function getExpirationDays(key) {
  const category = getRetentionCategory(key);
  const policy = RETENTION_POLICIES[category];
  return policy ? policy.days : null;
}

/**
 * Generate AWS S3 Lifecycle Configuration
 *
 * Creates a lifecycle configuration object that can be applied to an S3 bucket
 * using the AWS SDK or CLI.
 *
 * @returns {Object} AWS S3 lifecycle configuration object
 */
function generateLifecycleConfiguration() {
  return {
    Rules: [
      {
        ID: 'enrollment-raw-expiration',
        Filter: {
          Prefix: 'enrollment/raw/',
        },
        Status: 'Enabled',
        Expiration: {
          Days: RETENTION_POLICIES.enrollment_raw.days,
        },
      },
      {
        ID: 'enrollment-clean-expiration',
        Filter: {
          Prefix: 'enrollment/clean/',
        },
        Status: 'Enabled',
        Expiration: {
          Days: RETENTION_POLICIES.enrollment_clean.days,
        },
      },
      {
        ID: 'track-stems-expiration',
        Filter: {
          // AWS doesn't support regex, so we use a tag-based approach
          // or prefix pattern. Since stems are under tracks/*/v*/stems/,
          // we need to use a tag-based filter or multiple rules per track.
          // For simplicity, we'll use a broad prefix and rely on the
          // application to tag stems appropriately.
          // Alternative: Use S3 Batch Operations for cleanup.
          //
          // For now, we'll use a suffix-based approach with tags.
          // The application should tag stem files with "lifecycle=stems"
          And: {
            Prefix: 'tracks/',
            Tags: [
              {
                Key: 'lifecycle',
                Value: 'stems',
              },
            ],
          },
        },
        Status: 'Enabled',
        Expiration: {
          Days: RETENTION_POLICIES.track_stems.days,
        },
      },
    ],
  };
}

/**
 * Generate AWS CLI command to apply lifecycle configuration
 *
 * @param {string} bucket - S3 bucket name
 * @returns {string} AWS CLI command
 */
function toAWSCLI(bucket) {
  const config = generateLifecycleConfiguration();
  const configJson = JSON.stringify(config);

  return `aws s3api put-bucket-lifecycle-configuration \\
  --bucket ${bucket} \\
  --lifecycle-configuration '${configJson}'`;
}

/**
 * Get tags that should be applied to a new S3 object based on its key
 *
 * @param {string} key - S3 object key
 * @returns {Object|null} Tags to apply, or null if no tags needed
 */
function getObjectTags(key) {
  const category = getRetentionCategory(key);

  // Only stems need special tagging for lifecycle rules
  if (category === 'track_stems') {
    return {
      TagSet: [
        {
          Key: 'lifecycle',
          Value: 'stems',
        },
      ],
    };
  }

  return null;
}

/**
 * Get the S3 storage class recommendation for a category
 *
 * @param {string} category - Retention category
 * @returns {string} Recommended S3 storage class
 */
function getStorageClass(category) {
  switch (category) {
    case 'enrollment_raw':
    case 'enrollment_clean':
    case 'track_stems':
      // Temporary files - standard storage (frequent access during processing)
      return 'STANDARD';
    case 'voice_profile':
      // Infrequent access but important
      return 'STANDARD_IA';
    case 'track':
      // Final deliverables - standard for fast CDN access
      return 'STANDARD';
    default:
      return 'STANDARD';
  }
}

module.exports = {
  RETENTION_POLICIES,
  getRetentionCategory,
  isExpirableKey,
  getExpirationDays,
  generateLifecycleConfiguration,
  toAWSCLI,
  getObjectTags,
  getStorageClass,
};
