process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, test } = require("node:test");

const {
  buildAccountDeletionStoragePrefixes,
  deleteAccountStorageArtifacts,
} = require("../src/services/account-deletion-storage-service");
const { createLocalStorage } = require("../src/storage/local");

let tmpDir;

function writeSourceFile(content = "test") {
  const sourcePath = path.join(tmpDir, `source-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(sourcePath, content);
  return sourcePath;
}

describe("account deletion storage cleanup", () => {
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  test("builds all user-owned durable storage prefixes", () => {
    assert.deepEqual(buildAccountDeletionStoragePrefixes("user_delete_storage"), [
      "tracks/user_delete_storage/",
      "poems/user_delete_storage/",
      "enrollment/raw/user_delete_storage/",
      "enrollment/clean/user_delete_storage/",
      "voice_profiles/user_delete_storage/",
    ]);
  });

  test("recursively deletes target-user local storage artifacts only", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-delete-storage-"));
    const storage = createLocalStorage({ STORAGE_DIR: tmpDir });
    const sourcePath = writeSourceFile("artifact");

    const targetKeys = [
      "tracks/user_delete_storage/track_1/v1/preview.m4a",
      "tracks/user_delete_storage/track_1/v1/master.aac",
      "tracks/user_delete_storage/track_1/v1/hls/segment_000.ts",
      "tracks/user_delete_storage/track_1/v1/provider/suno-preview.mp3",
      "tracks/user_delete_storage/track_1/artwork.jpg",
      "poems/user_delete_storage/poem_1/og_1200x630_v1_default.png",
      "enrollment/raw/user_delete_storage/session_1/p1.wav",
      "enrollment/clean/user_delete_storage/session_1/clean.wav",
      "enrollment/clean/user_delete_storage/session_1/suno-persona.wav",
      "voice_profiles/user_delete_storage/profile_1/embedding.bin",
    ];
    const retainedKey = "tracks/other_user/track_1/v1/preview.m4a";

    for (const key of [...targetKeys, retainedKey]) {
      await storage.putFile({ key, filePath: sourcePath });
    }

    const result = await deleteAccountStorageArtifacts({
      storageProvider: storage,
      userId: "user_delete_storage",
      logger: null,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.deletedKeys.length, targetKeys.length);
    assert.deepEqual([...result.deletedKeys].sort(), [...targetKeys].sort());

    for (const key of targetKeys) {
      assert.equal(await storage.objectExists({ key }), false, `${key} deleted`);
    }
    assert.equal(await storage.objectExists({ key: retainedKey }), true);
  });

  test("uses listKeys fallback when listObjects is not available", async () => {
    const deleted = [];
    const storageProvider = {
      deleteObject: async ({ key }) => {
        deleted.push(key);
      },
      listKeys: async ({ prefix }) =>
        prefix === "tracks/user_delete_storage/"
          ? [
              "tracks/user_delete_storage/track_1/v1/preview.m4a",
              "tracks/user_delete_storage/track_2/v1/master.aac",
            ]
          : [],
    };

    const result = await deleteAccountStorageArtifacts({
      storageProvider,
      userId: "user_delete_storage",
      logger: null,
    });

    assert.deepEqual(deleted, [
      "tracks/user_delete_storage/track_1/v1/preview.m4a",
      "tracks/user_delete_storage/track_2/v1/master.aac",
    ]);
    assert.equal(result.deletedKeys.length, 2);
  });

  test("prefers listObjects over listKeys when both are available", async () => {
    const deleted = [];
    const listKeysCalls = [];
    const storageProvider = {
      deleteObject: async ({ key }) => {
        deleted.push(key);
      },
      listObjects: async ({ prefix }) =>
        prefix === "tracks/user_delete_storage/"
          ? {
              keys: ["tracks/user_delete_storage/track_1/v1/preview.m4a"],
              prefixes: ["tracks/user_delete_storage/track_1/v1/hls/"],
            }
          : prefix === "tracks/user_delete_storage/track_1/v1/hls/"
            ? {
                keys: ["tracks/user_delete_storage/track_1/v1/hls/segment_000.ts"],
                prefixes: [],
              }
            : { keys: [], prefixes: [] },
      listKeys: async ({ prefix }) => {
        listKeysCalls.push(prefix);
        return [];
      },
    };

    const result = await deleteAccountStorageArtifacts({
      storageProvider,
      userId: "user_delete_storage",
      logger: null,
    });

    assert.deepEqual(listKeysCalls, []);
    assert.deepEqual(deleted, [
      "tracks/user_delete_storage/track_1/v1/preview.m4a",
      "tracks/user_delete_storage/track_1/v1/hls/segment_000.ts",
    ]);
    assert.equal(result.deletedKeys.length, 2);
  });

  test("walks every paginated listObjects page before deleting", async () => {
    const listCalls = [];
    const deleted = [];
    const storageProvider = {
      deleteObject: async ({ key }) => {
        deleted.push(key);
      },
      listObjects: async ({ prefix, continuationToken }) => {
        listCalls.push({ prefix, continuationToken });
        if (prefix !== "tracks/user_delete_storage/") {
          return { keys: [], prefixes: [] };
        }
        if (!continuationToken) {
          return {
            keys: ["tracks/user_delete_storage/track_1/v1/segment_000.ts"],
            prefixes: [],
            nextContinuationToken: "page_2",
          };
        }
        return {
          keys: ["tracks/user_delete_storage/track_1/v1/segment_001.ts"],
          prefixes: [],
          nextContinuationToken: null,
        };
      },
    };

    const result = await deleteAccountStorageArtifacts({
      storageProvider,
      userId: "user_delete_storage",
      logger: null,
    });

    assert.deepEqual(
      listCalls.filter((call) => call.prefix === "tracks/user_delete_storage/"),
      [
        { prefix: "tracks/user_delete_storage/", continuationToken: null },
        { prefix: "tracks/user_delete_storage/", continuationToken: "page_2" },
      ],
    );
    assert.deepEqual(deleted, [
      "tracks/user_delete_storage/track_1/v1/segment_000.ts",
      "tracks/user_delete_storage/track_1/v1/segment_001.ts",
    ]);
    assert.equal(result.deletedKeys.length, 2);
  });

  test("fails closed when a truncated listing has no continuation token", async () => {
    const storageProvider = {
      deleteObject: async () => {
        throw new Error("deleteObject should not run before a complete listing");
      },
      listObjects: async ({ prefix }) =>
        prefix === "tracks/user_delete_storage/"
          ? {
              keys: ["tracks/user_delete_storage/track_1/v1/segment_000.ts"],
              prefixes: [],
              isTruncated: true,
              nextContinuationToken: null,
            }
          : { keys: [], prefixes: [] },
    };

    await assert.rejects(
      () =>
        deleteAccountStorageArtifacts({
          storageProvider,
          userId: "user_delete_storage",
          logger: null,
        }),
      /truncated account deletion listing without continuation token/,
    );
  });
});
