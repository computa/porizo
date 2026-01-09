/**
 * KMS Encryption Tests
 *
 * Tests for AWS KMS key management and encryption utilities.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

describe('KMS Configuration', () => {
  test('createKMSConfig validates required parameters', () => {
    const { createKMSConfig } = require('../../src/storage/kms.js');

    // Missing key ID should throw
    assert.throws(() => createKMSConfig({}), /KMS_KEY_ID/);

    // Valid config should work
    const config = createKMSConfig({
      KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789:key/test-key-id',
    });
    assert.ok(config);
    assert.strictEqual(config.keyId, 'arn:aws:kms:us-east-1:123456789:key/test-key-id');
  });

  test('createKMSConfig accepts key alias', () => {
    const { createKMSConfig } = require('../../src/storage/kms.js');

    const config = createKMSConfig({
      KMS_KEY_ID: 'alias/porizo-master',
    });

    assert.strictEqual(config.keyId, 'alias/porizo-master');
  });

  test('createKMSConfig sets default region', () => {
    const { createKMSConfig } = require('../../src/storage/kms.js');

    const config = createKMSConfig({
      KMS_KEY_ID: 'alias/porizo-master',
    });

    assert.strictEqual(config.region, 'us-east-1');

    const configWithRegion = createKMSConfig({
      KMS_KEY_ID: 'alias/porizo-master',
      KMS_REGION: 'eu-west-1',
    });

    assert.strictEqual(configWithRegion.region, 'eu-west-1');
  });
});

describe('S3 Encryption Headers', () => {
  test('getS3EncryptionHeaders returns SSE-KMS headers', () => {
    const { createKMSConfig, getS3EncryptionHeaders } = require('../../src/storage/kms.js');

    const config = createKMSConfig({
      KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789:key/test-key-id',
    });

    const headers = getS3EncryptionHeaders(config);

    assert.strictEqual(headers['x-amz-server-side-encryption'], 'aws:kms');
    assert.strictEqual(headers['x-amz-server-side-encryption-aws-kms-key-id'], config.keyId);
  });

  test('getS3EncryptionHeaders includes bucket key when enabled', () => {
    const { createKMSConfig, getS3EncryptionHeaders } = require('../../src/storage/kms.js');

    const config = createKMSConfig({
      KMS_KEY_ID: 'alias/porizo-master',
      KMS_USE_BUCKET_KEY: 'true',
    });

    const headers = getS3EncryptionHeaders(config);

    assert.strictEqual(headers['x-amz-server-side-encryption-bucket-key-enabled'], 'true');
  });
});

describe('Encryption Context', () => {
  test('buildEncryptionContext creates valid context for voice profiles', () => {
    const { buildEncryptionContext } = require('../../src/storage/kms.js');

    const context = buildEncryptionContext({
      type: 'voice_profile',
      userId: 'user-123',
      voiceProfileId: 'vp-456',
    });

    assert.strictEqual(context.type, 'voice_profile');
    assert.strictEqual(context.user_id, 'user-123');
    assert.strictEqual(context.voice_profile_id, 'vp-456');
  });

  test('buildEncryptionContext creates valid context for tracks', () => {
    const { buildEncryptionContext } = require('../../src/storage/kms.js');

    const context = buildEncryptionContext({
      type: 'track',
      userId: 'user-123',
      trackId: 'track-789',
    });

    assert.strictEqual(context.type, 'track');
    assert.strictEqual(context.user_id, 'user-123');
    assert.strictEqual(context.track_id, 'track-789');
  });

  test('buildEncryptionContext requires type', () => {
    const { buildEncryptionContext } = require('../../src/storage/kms.js');

    assert.throws(() => buildEncryptionContext({}), /type is required/);
  });

  test('encodeEncryptionContext returns base64 JSON', () => {
    const { encodeEncryptionContext } = require('../../src/storage/kms.js');

    const context = { type: 'test', user_id: '123' };
    const encoded = encodeEncryptionContext(context);

    // Should be base64
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assert.deepStrictEqual(decoded, context);
  });
});

describe('Key Path Mapping', () => {
  test('getKeyForPath returns appropriate key strategy', () => {
    const { getKeyForPath } = require('../../src/storage/kms.js');

    // Voice profiles get encryption
    const vpResult = getKeyForPath('voice_profiles/user123/vp456/embedding.bin');
    assert.strictEqual(vpResult.encrypted, true);
    assert.strictEqual(vpResult.sensitive, true);

    // Enrollment raw data gets encryption
    const enrollResult = getKeyForPath('enrollment/raw/user123/session/chunk.wav');
    assert.strictEqual(enrollResult.encrypted, true);
    assert.strictEqual(enrollResult.sensitive, true);

    // Track audio doesn't need encryption (public delivery)
    const trackResult = getKeyForPath('tracks/user123/track456/v1/master.aac');
    assert.strictEqual(trackResult.encrypted, false);
    assert.strictEqual(trackResult.sensitive, false);
  });

  test('getSensitivePathPatterns returns correct patterns', () => {
    const { getSensitivePathPatterns } = require('../../src/storage/kms.js');

    const patterns = getSensitivePathPatterns();

    assert.ok(Array.isArray(patterns));
    assert.ok(patterns.length > 0);
    // Voice profiles should be sensitive
    assert.ok(patterns.some((p) => p.pattern.test('voice_profiles/user/vp/embedding.bin')));
  });
});

describe('Mock Encryption (for testing without AWS)', () => {
  test('createMockKMSClient returns working mock', () => {
    const { createMockKMSClient } = require('../../src/storage/kms.js');

    const mock = createMockKMSClient();

    assert.ok(mock.encrypt);
    assert.ok(mock.decrypt);
    assert.ok(mock.generateDataKey);
  });

  test('mock encrypt/decrypt round trip works', async () => {
    const { createMockKMSClient } = require('../../src/storage/kms.js');

    const mock = createMockKMSClient();
    const plaintext = Buffer.from('secret voice embedding data');

    const encrypted = await mock.encrypt({
      KeyId: 'test-key',
      Plaintext: plaintext,
    });

    assert.ok(encrypted.CiphertextBlob);

    const decrypted = await mock.decrypt({
      CiphertextBlob: encrypted.CiphertextBlob,
    });

    assert.deepStrictEqual(decrypted.Plaintext, plaintext);
  });

  test('mock generateDataKey returns key and encrypted key', async () => {
    const { createMockKMSClient } = require('../../src/storage/kms.js');

    const mock = createMockKMSClient();

    const result = await mock.generateDataKey({
      KeyId: 'test-key',
      KeySpec: 'AES_256',
    });

    assert.ok(result.Plaintext);
    assert.ok(result.CiphertextBlob);
    assert.strictEqual(result.Plaintext.length, 32); // AES-256 = 32 bytes
  });
});
