/**
 * S3 Storage Tests
 *
 * Tests for S3 storage provider with LocalStack for local development.
 * Requires LocalStack running: docker-compose up localstack
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Check if LocalStack is available
async function isLocalStackAvailable() {
  try {
    const response = await fetch('http://localhost:4566/_localstack/health', {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Create test bucket in LocalStack
async function createTestBucket(bucketName) {
  const response = await fetch(`http://localhost:4566/${bucketName}`, {
    method: 'PUT',
    headers: {
      'Host': `${bucketName}.s3.localhost.localstack.cloud:4566`,
    },
  });
  return response.ok || response.status === 409; // 409 = bucket exists
}

describe('S3 Storage Provider', async () => {
  let localStackAvailable = false;
  const testBucket = 'porizo-test';
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-test-'));

  before(async () => {
    localStackAvailable = await isLocalStackAvailable();
    if (localStackAvailable) {
      await createTestBucket(testBucket);
    }
  });

  after(() => {
    // Clean up temp directory
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true });
    }
  });

  test('createS3Storage validates required configuration', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    assert.throws(() => {
      createS3Storage({});
    }, /S3 storage requires S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET/);

    assert.throws(() => {
      createS3Storage({ S3_ACCESS_KEY_ID: 'test' });
    }, /S3 storage requires/);

    assert.throws(() => {
      createS3Storage({ S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test' });
    }, /S3 storage requires/);
  });

  test('createS3Storage returns storage interface', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
    });

    assert.strictEqual(storage.type, 's3');
    assert.strictEqual(typeof storage.createPresignedUpload, 'function');
    assert.strictEqual(typeof storage.createPresignedDownload, 'function');
    assert.strictEqual(typeof storage.objectExists, 'function');
    assert.strictEqual(typeof storage.downloadToFile, 'function');
    assert.strictEqual(typeof storage.putFile, 'function');
    assert.strictEqual(typeof storage.deleteObject, 'function');
  });

  test('createPresignedUpload generates valid signed URL', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      S3_BUCKET: 'test-bucket',
      S3_REGION: 'us-east-1',
    });

    const result = storage.createPresignedUpload({
      key: 'test/file.wav',
      contentType: 'audio/wav',
      expiresInSec: 900,
    });

    assert.ok(result.url.includes('test-bucket'));
    assert.ok(result.url.includes('test%2Ffile.wav') || result.url.includes('test/file.wav'));
    assert.ok(result.url.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'));
    assert.ok(result.url.includes('X-Amz-Credential='));
    assert.ok(result.url.includes('X-Amz-Signature='));
    assert.ok(result.url.includes('X-Amz-Expires=900'));
    assert.strictEqual(result.method, 'PUT');
    assert.ok(result.expiresAt);
  });

  test('createPresignedDownload generates valid signed URL', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      S3_BUCKET: 'test-bucket',
    });

    const result = storage.createPresignedDownload({
      key: 'tracks/user123/track456/master.aac',
      expiresInSec: 3600,
    });

    assert.ok(result.url.includes('X-Amz-Signature='));
    assert.ok(result.url.includes('X-Amz-Expires=3600'));
    assert.strictEqual(result.method, 'GET');
  });

  test('presigned URLs work with custom endpoint (LocalStack)', async (t) => {
    if (!localStackAvailable) {
      t.skip('LocalStack not available');
      return;
    }

    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: testBucket,
      S3_ENDPOINT: 'http://localhost:4566',
      S3_FORCE_PATH_STYLE: 'true',
      S3_REGION: 'us-east-1',
    });

    // Generate upload URL
    const uploadResult = storage.createPresignedUpload({
      key: 'test/integration.txt',
      contentType: 'text/plain',
    });

    assert.ok(uploadResult.url.includes('localhost:4566'));
    assert.ok(uploadResult.url.includes(testBucket));
  });

  test('putFile and downloadToFile work with LocalStack', async (t) => {
    if (!localStackAvailable) {
      t.skip('LocalStack not available');
      return;
    }

    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: testBucket,
      S3_ENDPOINT: 'http://localhost:4566',
      S3_FORCE_PATH_STYLE: 'true',
    });

    const testKey = `test/integration-${Date.now()}.txt`;
    const testContent = 'Hello from S3 integration test!';
    const uploadPath = path.join(testTempDir, 'upload.txt');
    const downloadPath = path.join(testTempDir, 'download.txt');

    // Create test file
    fs.writeFileSync(uploadPath, testContent);

    // Upload
    await storage.putFile({
      key: testKey,
      filePath: uploadPath,
      contentType: 'text/plain',
    });

    // Verify exists
    const exists = await storage.objectExists({ key: testKey });
    assert.strictEqual(exists, true, 'Object should exist after upload');

    // Download
    await storage.downloadToFile({
      key: testKey,
      filePath: downloadPath,
    });

    const downloadedContent = fs.readFileSync(downloadPath, 'utf8');
    assert.strictEqual(downloadedContent, testContent, 'Downloaded content should match');

    // Delete
    await storage.deleteObject({ key: testKey });

    // Verify deleted
    const existsAfterDelete = await storage.objectExists({ key: testKey });
    assert.strictEqual(existsAfterDelete, false, 'Object should not exist after delete');
  });

  test('objectExists returns false for non-existent key', async (t) => {
    if (!localStackAvailable) {
      t.skip('LocalStack not available');
      return;
    }

    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: testBucket,
      S3_ENDPOINT: 'http://localhost:4566',
      S3_FORCE_PATH_STYLE: 'true',
    });

    const exists = await storage.objectExists({ key: 'nonexistent/path/file.txt' });
    assert.strictEqual(exists, false);
  });
});

describe('S3 Storage KMS Encryption', () => {
  test('createS3Storage without KMS config does not enable encryption', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
    });

    assert.strictEqual(storage.isEncryptionEnabled(), false);
  });

  test('createS3Storage with KMS config enables encryption', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      KMS_KEY_ID: 'alias/porizo-master',
    });

    assert.strictEqual(storage.isEncryptionEnabled(), true);
  });

  test('getPathEncryptionInfo returns correct info for sensitive paths', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      KMS_KEY_ID: 'alias/porizo-master',
    });

    // Voice profile - sensitive
    const vpInfo = storage.getPathEncryptionInfo('voice_profiles/user123/profile456/embedding.bin');
    assert.strictEqual(vpInfo.encrypted, true);
    assert.strictEqual(vpInfo.sensitive, true);
    assert.strictEqual(vpInfo.type, 'voice_profile');

    // Enrollment raw - sensitive
    const enrollInfo = storage.getPathEncryptionInfo('enrollment/raw/user123/session/chunk.wav');
    assert.strictEqual(enrollInfo.encrypted, true);
    assert.strictEqual(enrollInfo.sensitive, true);

    // Track audio - not sensitive
    const trackInfo = storage.getPathEncryptionInfo('tracks/user123/track456/v1/master.aac');
    assert.strictEqual(trackInfo.encrypted, false);
    assert.strictEqual(trackInfo.sensitive, false);
  });

  test('createPresignedUpload includes encryption headers for sensitive paths with KMS', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      KMS_KEY_ID: 'alias/porizo-master',
    });

    // Sensitive path (enrollment)
    const result = storage.createPresignedUpload({
      key: 'enrollment/raw/user123/session/chunk.wav',
      contentType: 'audio/wav',
    });

    assert.ok(result.encrypted, 'Result should indicate encryption');
    assert.ok(result.sensitive, 'Result should indicate sensitive');
    assert.strictEqual(result.headers['x-amz-server-side-encryption'], 'aws:kms');
    assert.strictEqual(result.headers['x-amz-server-side-encryption-aws-kms-key-id'], 'alias/porizo-master');
  });

  test('createPresignedUpload does not include encryption headers for non-sensitive paths', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      KMS_KEY_ID: 'alias/porizo-master',
    });

    // Non-sensitive path (track audio)
    const result = storage.createPresignedUpload({
      key: 'tracks/user123/track456/v1/master.aac',
      contentType: 'audio/aac',
    });

    assert.strictEqual(result.encrypted, false);
    assert.strictEqual(result.sensitive, false);
    assert.strictEqual(result.headers['x-amz-server-side-encryption'], undefined);
  });

  test('createPresignedUpload without KMS does not include encryption headers', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      // No KMS_KEY_ID
    });

    // Even for sensitive path, no encryption headers without KMS config
    const result = storage.createPresignedUpload({
      key: 'enrollment/raw/user123/session/chunk.wav',
      contentType: 'audio/wav',
    });

    // Path is still flagged as sensitive for caller awareness
    assert.strictEqual(result.encrypted, true);
    assert.strictEqual(result.sensitive, true);
    // But no encryption headers since KMS not configured
    assert.strictEqual(result.headers['x-amz-server-side-encryption'], undefined);
  });

  test('createPresignedUpload includes bucket key header when enabled', () => {
    const { createS3Storage } = require('../../src/storage/s3.js');

    const storage = createS3Storage({
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
      KMS_KEY_ID: 'alias/porizo-master',
      KMS_USE_BUCKET_KEY: 'true',
    });

    const result = storage.createPresignedUpload({
      key: 'voice_profiles/user123/profile456/embedding.bin',
      contentType: 'application/octet-stream',
    });

    assert.strictEqual(result.headers['x-amz-server-side-encryption-bucket-key-enabled'], 'true');
  });
});

describe('Storage Provider Factory', () => {
  test('createStorageProvider returns local storage by default', () => {
    const { createStorageProvider } = require('../../src/storage/index.js');

    const storage = createStorageProvider({});
    assert.strictEqual(storage.type, 'local');
  });

  test('createStorageProvider returns S3 storage when configured', () => {
    const { createStorageProvider } = require('../../src/storage/index.js');

    const storage = createStorageProvider({
      STORAGE_PROVIDER: 's3',
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_BUCKET: 'test-bucket',
    });

    assert.strictEqual(storage.type, 's3');
  });

  test('enrollmentChunkKey generates correct path', () => {
    const { enrollmentChunkKey } = require('../../src/storage/index.js');

    const key = enrollmentChunkKey({
      userId: 'user-123',
      sessionId: 'session-456',
      chunkId: 'chunk-789',
    });

    assert.strictEqual(key, 'enrollment/raw/user-123/session-456/chunk-789.wav');
  });

  test('enrollmentCleanKey generates correct path', () => {
    const { enrollmentCleanKey } = require('../../src/storage/index.js');

    const key = enrollmentCleanKey({
      userId: 'user-123',
      sessionId: 'session-456',
    });

    assert.strictEqual(key, 'enrollment/clean/user-123/session-456/clean.wav');
  });

  test('voiceEmbeddingKey generates correct path', () => {
    const { voiceEmbeddingKey } = require('../../src/storage/index.js');

    const key = voiceEmbeddingKey({
      userId: 'user-123',
      voiceProfileId: 'profile-456',
    });

    assert.strictEqual(key, 'voice_profiles/user-123/profile-456/embedding.bin');
  });

  test('trackMasterKey generates correct path', () => {
    const { trackMasterKey } = require('../../src/storage/index.js');

    const key = trackMasterKey({
      userId: 'user-123',
      trackId: 'track-456',
      versionNum: 2,
    });

    assert.strictEqual(key, 'tracks/user-123/track-456/v2/master.aac');
  });

  test('trackPreviewKey generates correct path', () => {
    const { trackPreviewKey } = require('../../src/storage/index.js');

    const key = trackPreviewKey({
      userId: 'user-123',
      trackId: 'track-456',
      versionNum: 1,
    });

    assert.strictEqual(key, 'tracks/user-123/track-456/v1/preview.aac');
  });

  test('trackHLSKey generates correct path', () => {
    const { trackHLSKey } = require('../../src/storage/index.js');

    const key = trackHLSKey({
      userId: 'user-123',
      trackId: 'track-456',
      versionNum: 1,
    });

    assert.strictEqual(key, 'tracks/user-123/track-456/v1/hls/');
  });

  test('createCDNSigner returns null when not configured', () => {
    const { createCDNSigner } = require('../../src/storage/index.js');

    const signer = createCDNSigner({});
    assert.strictEqual(signer, null);
  });
});
