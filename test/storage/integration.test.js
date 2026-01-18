/**
 * Storage Integration Tests
 *
 * Tests the full storage workflow with both local and S3 providers.
 * S3 tests require LocalStack: docker-compose up localstack
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  createStorageProvider,
  enrollmentChunkKey,
  enrollmentCleanKey,
  voiceEmbeddingKey,
  trackMasterKey,
  trackPreviewKey,
  trackHLSKey,
} = require("../../src/storage");

// Check if LocalStack is available
async function isLocalStackAvailable() {
  try {
    const response = await fetch("http://localhost:4566/_localstack/health", {
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
    method: "PUT",
    headers: {
      Host: `${bucketName}.s3.localhost.localstack.cloud:4566`,
    },
  });
  return response.ok || response.status === 409;
}

describe("Storage Provider Integration", () => {
  let testTempDir;

  before(() => {
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-integration-"));
  });

  after(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true });
    }
  });

  test("createStorageProvider defaults to local storage", () => {
    const storage = createStorageProvider({
      STORAGE_DIR: testTempDir,
    });

    assert.strictEqual(storage.type, "local");
    assert.strictEqual(storage.isEncryptionEnabled(), false);
  });

  test("createStorageProvider creates S3 storage when configured", () => {
    const storage = createStorageProvider({
      STORAGE_PROVIDER: "s3",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      S3_BUCKET: "test-bucket",
    });

    assert.strictEqual(storage.type, "s3");
  });

  test("storage key generators produce correct paths", () => {
    const userId = "user-123";
    const sessionId = "session-456";
    const trackId = "track-789";
    const voiceProfileId = "vp-abc";

    assert.strictEqual(
      enrollmentChunkKey({ userId, sessionId, chunkId: "chunk-1" }),
      "enrollment/raw/user-123/session-456/chunk-1.wav"
    );

    assert.strictEqual(
      enrollmentCleanKey({ userId, sessionId }),
      "enrollment/clean/user-123/session-456/clean.wav"
    );

    assert.strictEqual(
      voiceEmbeddingKey({ userId, voiceProfileId }),
      "voice_profiles/user-123/vp-abc/embedding.bin"
    );

    assert.strictEqual(
      trackMasterKey({ userId, trackId, versionNum: 1 }),
      "tracks/user-123/track-789/v1/master.aac"
    );

    assert.strictEqual(
      trackPreviewKey({ userId, trackId, versionNum: 2 }),
      "tracks/user-123/track-789/v2/preview.m4a"
    );

    assert.strictEqual(
      trackHLSKey({ userId, trackId, versionNum: 1 }),
      "tracks/user-123/track-789/v1/hls/"
    );
  });

  test("local storage full workflow: put, exists, download, delete", async () => {
    const storage = createStorageProvider({
      STORAGE_DIR: testTempDir,
      STREAM_BASE_URL: "http://localhost:3000",
    });

    const testContent = "Integration test content";
    const testKey = `integration/test-${Date.now()}.txt`;
    const uploadPath = path.join(testTempDir, "upload.txt");
    const downloadPath = path.join(testTempDir, "download.txt");

    // Create test file
    fs.writeFileSync(uploadPath, testContent);

    // Put
    await storage.putFile({
      key: testKey,
      filePath: uploadPath,
      contentType: "text/plain",
    });

    // Exists
    const exists = await storage.objectExists({ key: testKey });
    assert.strictEqual(exists, true, "Object should exist after put");

    // Download
    await storage.downloadToFile({
      key: testKey,
      filePath: downloadPath,
    });

    const downloadedContent = fs.readFileSync(downloadPath, "utf8");
    assert.strictEqual(downloadedContent, testContent, "Downloaded content should match");

    // Delete
    await storage.deleteObject({ key: testKey });

    // Verify deleted
    const existsAfterDelete = await storage.objectExists({ key: testKey });
    assert.strictEqual(existsAfterDelete, false, "Object should not exist after delete");
  });

  test("local storage handles sensitive path info correctly", async () => {
    const storage = createStorageProvider({
      STORAGE_DIR: testTempDir,
    });

    // Sensitive paths
    const vpInfo = storage.getPathEncryptionInfo("voice_profiles/u1/vp1/embedding.bin");
    assert.strictEqual(vpInfo.sensitive, true);
    assert.strictEqual(vpInfo.type, "voice_profile");

    const enrollInfo = storage.getPathEncryptionInfo("enrollment/raw/u1/s1/chunk.wav");
    assert.strictEqual(enrollInfo.sensitive, true);

    // Non-sensitive paths
    const trackInfo = storage.getPathEncryptionInfo("tracks/u1/t1/v1/master.aac");
    assert.strictEqual(trackInfo.sensitive, false);
  });
});

describe("S3 Storage Integration (LocalStack)", async () => {
  let localStackAvailable = false;
  let storage;
  const testBucket = "porizo-integration-test";
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3-integration-"));

  before(async () => {
    localStackAvailable = await isLocalStackAvailable();
    if (localStackAvailable) {
      await createTestBucket(testBucket);
      storage = createStorageProvider({
        STORAGE_PROVIDER: "s3",
        S3_ACCESS_KEY_ID: "test",
        S3_SECRET_ACCESS_KEY: "test",
        S3_BUCKET: testBucket,
        S3_ENDPOINT: "http://localhost:4566",
        S3_FORCE_PATH_STYLE: "true",
        S3_REGION: "us-east-1",
      });
    }
  });

  after(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true });
    }
  });

  test("S3 full workflow: put, exists, download, delete", async (t) => {
    if (!localStackAvailable) {
      t.skip("LocalStack not available");
      return;
    }

    const testContent = "S3 integration test content";
    const testKey = `integration/s3-test-${Date.now()}.txt`;
    const uploadPath = path.join(testTempDir, "s3-upload.txt");
    const downloadPath = path.join(testTempDir, "s3-download.txt");

    // Create test file
    fs.writeFileSync(uploadPath, testContent);

    // Put
    await storage.putFile({
      key: testKey,
      filePath: uploadPath,
      contentType: "text/plain",
    });

    // Exists
    const exists = await storage.objectExists({ key: testKey });
    assert.strictEqual(exists, true, "Object should exist after put");

    // Download
    await storage.downloadToFile({
      key: testKey,
      filePath: downloadPath,
    });

    const downloadedContent = fs.readFileSync(downloadPath, "utf8");
    assert.strictEqual(downloadedContent, testContent, "Downloaded content should match");

    // Delete
    await storage.deleteObject({ key: testKey });

    // Verify deleted
    const existsAfterDelete = await storage.objectExists({ key: testKey });
    assert.strictEqual(existsAfterDelete, false, "Object should not exist after delete");
  });

  test("S3 presigned URLs work with LocalStack", async (t) => {
    if (!localStackAvailable) {
      t.skip("LocalStack not available");
      return;
    }

    // Generate upload URL
    const uploadResult = storage.createPresignedUpload({
      key: "presigned-test/file.txt",
      contentType: "text/plain",
      expiresInSec: 900,
    });

    assert.ok(uploadResult.url.includes("localhost:4566"));
    assert.ok(uploadResult.url.includes(testBucket));
    assert.ok(uploadResult.url.includes("X-Amz-Signature"));

    // Generate download URL
    const downloadResult = storage.createPresignedDownload({
      key: "presigned-test/file.txt",
      expiresInSec: 900,
    });

    assert.ok(downloadResult.url.includes("X-Amz-Signature"));
  });

  test("S3 encryption info for sensitive paths", async (t) => {
    if (!localStackAvailable) {
      t.skip("LocalStack not available");
      return;
    }

    // Sensitive paths should be marked even without KMS configured
    const vpInfo = storage.getPathEncryptionInfo("voice_profiles/u1/vp1/embedding.bin");
    assert.strictEqual(vpInfo.sensitive, true);
    assert.strictEqual(vpInfo.encrypted, true);

    // Non-sensitive paths
    const trackInfo = storage.getPathEncryptionInfo("tracks/u1/t1/v1/master.aac");
    assert.strictEqual(trackInfo.sensitive, false);
    assert.strictEqual(trackInfo.encrypted, false);
  });
});
