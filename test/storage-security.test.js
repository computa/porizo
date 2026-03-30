/**
 * Storage Security Tests
 *
 * Validates path traversal protection in local storage and
 * ID format validation in getVersionDir.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { createLocalStorage } = require("../src/storage/local");
const { getVersionDir } = require("../src/utils/common");

describe("Storage Security: Path Traversal Protection", () => {
  let testDir;
  let storage;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-security-test-"));
    storage = createLocalStorage({
      STORAGE_DIR: testDir,
      STREAM_BASE_URL: "http://localhost:3000",
    });
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // --- resolveLocalPath ---

  test("resolveLocalPath: normal key resolves correctly", () => {
    const resolved = storage.resolveLocalPath("tracks/user1/song.mp3");
    assert.strictEqual(resolved, path.resolve(testDir, "tracks/user1/song.mp3"));
  });

  test("resolveLocalPath: key with ../ returns null", () => {
    const resolved = storage.resolveLocalPath("../../../etc/passwd");
    assert.strictEqual(resolved, null);
  });

  test("resolveLocalPath: key with mid-path ../ that escapes returns null", () => {
    const resolved = storage.resolveLocalPath("tracks/../../etc/passwd");
    assert.strictEqual(resolved, null);
  });

  test("resolveLocalPath: absolute path returns null", () => {
    const resolved = storage.resolveLocalPath("/etc/passwd");
    assert.strictEqual(resolved, null);
  });

  test("resolveLocalPath: key that stays within storage after ../ resolves", () => {
    // "tracks/user1/../user2/file.mp3" resolves to "tracks/user2/file.mp3" -- still inside storageDir
    const resolved = storage.resolveLocalPath("tracks/user1/../user2/file.mp3");
    assert.ok(resolved !== null, "Should resolve when path stays within storage root");
    assert.ok(resolved.startsWith(path.resolve(testDir) + path.sep));
  });

  // --- putFile with traversal ---

  test("putFile: traversal key throws descriptive error", async () => {
    // Create a temp source file
    const srcFile = path.join(testDir, "src-temp.wav");
    fs.writeFileSync(srcFile, "test data");

    await assert.rejects(
      () => storage.putFile({ key: "../../../tmp/evil.wav", filePath: srcFile }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  // --- downloadToFile with traversal ---

  test("downloadToFile: traversal key throws descriptive error", async () => {
    const destFile = path.join(testDir, "dest-temp.wav");

    await assert.rejects(
      () => storage.downloadToFile({ key: "../../etc/shadow", filePath: destFile }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  // --- objectExists with traversal ---

  test("objectExists: traversal key throws", async () => {
    await assert.rejects(
      () => storage.objectExists({ key: "../../../etc/passwd" }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  // --- deleteObject with traversal ---

  test("deleteObject: traversal key throws", async () => {
    await assert.rejects(
      () => storage.deleteObject({ key: "../../important-file" }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  // --- listKeys with traversal ---

  test("listKeys: traversal prefix throws", async () => {
    await assert.rejects(
      () => storage.listKeys({ prefix: "../../../etc" }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  // --- listObjects with traversal ---

  test("listObjects: traversal prefix throws", async () => {
    await assert.rejects(
      () => storage.listObjects({ prefix: "../../etc" }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });
});

describe("Storage Security: getVersionDir ID Validation", () => {
  const storageDir = "/tmp/test-storage";

  test("getVersionDir: valid UUIDs work", () => {
    const result = getVersionDir(
      storageDir,
      { user_id: "abc-123-def", id: "track-456-ghi" },
      { version_num: 1 }
    );
    assert.strictEqual(
      result,
      path.join(storageDir, "tracks", "abc-123-def", "track-456-ghi", "v1")
    );
  });

  test("getVersionDir: valid dotted IDs work", () => {
    const result = getVersionDir(
      storageDir,
      { user_id: "user.123", id: "track.456" },
      { version_num: 2 }
    );
    assert.strictEqual(
      result,
      path.join(storageDir, "tracks", "user.123", "track.456", "v2")
    );
  });

  test("getVersionDir: user_id with ../ rejects", () => {
    assert.throws(
      () => getVersionDir(storageDir, { user_id: "../../../etc", id: "track1" }, { version_num: 1 }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  test("getVersionDir: track id with ../ rejects", () => {
    assert.throws(
      () => getVersionDir(storageDir, { user_id: "user1", id: "../../etc/passwd" }, { version_num: 1 }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  test("getVersionDir: user_id with null bytes rejects", () => {
    assert.throws(
      () => getVersionDir(storageDir, { user_id: "user\x00evil", id: "track1" }, { version_num: 1 }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  test("getVersionDir: id with spaces rejects", () => {
    assert.throws(
      () => getVersionDir(storageDir, { user_id: "user1", id: "track 1" }, { version_num: 1 }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });

  test("getVersionDir: id with slashes rejects", () => {
    assert.throws(
      () => getVersionDir(storageDir, { user_id: "user1", id: "tracks/evil" }, { version_num: 1 }),
      (err) => {
        assert.ok(err.message.includes("[SecurityGuard:PathTraversal]"));
        return true;
      }
    );
  });
});
