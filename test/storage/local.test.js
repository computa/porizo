/**
 * Local Storage Tests
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { createLocalStorage } = require("../../src/storage/local");

describe("Local Storage Provider", () => {
  let testDir;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-storage-test-"));
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test("createLocalStorage returns storage interface", () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
      STREAM_BASE_URL: "http://localhost:3000",
    });

    assert.strictEqual(storage.type, "local");
    assert.strictEqual(typeof storage.createPresignedUpload, "function");
    assert.strictEqual(typeof storage.createPresignedDownload, "function");
    assert.strictEqual(typeof storage.objectExists, "function");
    assert.strictEqual(typeof storage.downloadToFile, "function");
    assert.strictEqual(typeof storage.putFile, "function");
    assert.strictEqual(typeof storage.deleteObject, "function");
    assert.strictEqual(typeof storage.getPathEncryptionInfo, "function");
    assert.strictEqual(typeof storage.isEncryptionEnabled, "function");
  });

  test("isEncryptionEnabled returns false for local storage", () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
    });

    assert.strictEqual(storage.isEncryptionEnabled(), false);
  });

  test("getPathEncryptionInfo returns correct info for sensitive paths", () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
    });

    // Voice profile - sensitive
    const vpInfo = storage.getPathEncryptionInfo("voice_profiles/user123/profile456/embedding.bin");
    assert.strictEqual(vpInfo.sensitive, true);
    assert.strictEqual(vpInfo.type, "voice_profile");

    // Enrollment raw - sensitive
    const enrollInfo = storage.getPathEncryptionInfo("enrollment/raw/user123/session/chunk.wav");
    assert.strictEqual(enrollInfo.sensitive, true);

    // Track audio - not sensitive
    const trackInfo = storage.getPathEncryptionInfo("tracks/user123/track456/v1/master.aac");
    assert.strictEqual(trackInfo.sensitive, false);
  });

  test("putFile and objectExists work correctly", async () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
    });

    const testContent = "Hello, local storage!";
    const testKey = `test/local-${Date.now()}.txt`;
    const tempFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);

    // Create test file
    fs.writeFileSync(tempFile, testContent);

    // Put file
    await storage.putFile({
      key: testKey,
      filePath: tempFile,
    });

    // Verify exists
    const exists = await storage.objectExists({ key: testKey });
    assert.strictEqual(exists, true);

    // Verify content
    const storedContent = fs.readFileSync(path.join(testDir, testKey), "utf8");
    assert.strictEqual(storedContent, testContent);

    // Delete
    await storage.deleteObject({ key: testKey });

    // Verify deleted
    const existsAfterDelete = await storage.objectExists({ key: testKey });
    assert.strictEqual(existsAfterDelete, false);

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test("createPresignedUpload generates valid URL", () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
      STREAM_BASE_URL: "http://localhost:3000",
    });

    const result = storage.createPresignedUpload({
      key: "test/file.wav",
      contentType: "audio/wav",
      expiresInSec: 900,
    });

    assert.ok(result.url.includes("localhost:3000"));
    assert.ok(result.url.includes("test%2Ffile.wav") || result.url.includes("test/file.wav"));
    assert.ok(result.url.includes("sig="));
    assert.strictEqual(result.method, "PUT");
  });

  test("createPresignedDownload generates valid URL", () => {
    const storage = createLocalStorage({
      STORAGE_DIR: testDir,
      STREAM_BASE_URL: "http://localhost:3000",
    });

    const result = storage.createPresignedDownload({
      key: "tracks/user123/track456/v1/master.aac",
      expiresInSec: 3600,
    });

    assert.ok(result.url.includes("sig="));
    assert.strictEqual(result.method, "GET");
  });
});
