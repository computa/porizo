process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, test } = require("node:test");

const { cleanupExpiredSessions } = require("../src/jobs/cleanup");
const { enrollmentChunkKey, enrollmentCleanKey } = require("../src/storage");

describe("Enrollment cleanup job", () => {
  test("deletes prompt chunk objects, clean artifact, and repository row", async () => {
    const calls = [];
    const session = {
      id: "enroll_old",
      user_id: "user_cleanup",
      prompts_json: JSON.stringify([{ id: "p-a" }, { id: "p-b" }, {}]),
      chunk_count: 4,
    };
    const enrollmentCleanupRepository = {
      listSessionsStartedBefore: async (cutoffIso) => {
        calls.push(["list", cutoffIso]);
        assert.match(cutoffIso, /^\d{4}-\d{2}-\d{2}T/);
        return [session];
      },
      deleteSessionById: async (sessionId) => {
        calls.push(["delete", sessionId]);
        return { changes: 1 };
      },
    };
    const storageProvider = {
      type: "s3",
      deleteObject: async ({ key }) => {
        calls.push(["storage", key]);
      },
    };

    const result = await cleanupExpiredSessions({
      enrollmentCleanupRepository,
      storageProvider,
      retentionDays: 7,
    });

    assert.deepEqual(result, { deletedCount: 1, errors: [] });
    assert.deepEqual(calls.slice(1), [
      [
        "storage",
        enrollmentChunkKey({
          userId: session.user_id,
          sessionId: session.id,
          chunkId: "p-a",
        }),
      ],
      [
        "storage",
        enrollmentChunkKey({
          userId: session.user_id,
          sessionId: session.id,
          chunkId: "p-b",
        }),
      ],
      [
        "storage",
        enrollmentCleanKey({ userId: session.user_id, sessionId: session.id }),
      ],
      ["delete", session.id],
    ]);
  });

  test("falls back to chunk_count ids and removes local raw and clean directories", async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-cleanup-"));
    const session = {
      id: "enroll_malformed_prompts",
      user_id: "user_cleanup",
      prompts_json: "{",
      chunk_count: 2,
    };
    const deletedKeys = [];
    const enrollmentCleanupRepository = {
      listSessionsStartedBefore: async () => [session],
      deleteSessionById: async () => ({ changes: 1 }),
    };
    const storageProvider = {
      type: "local",
      deleteObject: async ({ key }) => {
        deletedKeys.push(key);
      },
    };

    const rawDir = path.join(
      storageDir,
      "enrollment",
      "raw",
      session.user_id,
      session.id,
    );
    const cleanDir = path.join(
      storageDir,
      "enrollment",
      "clean",
      session.user_id,
      session.id,
    );
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, "p1.wav"), "raw");
    fs.mkdirSync(cleanDir, { recursive: true });
    fs.writeFileSync(path.join(cleanDir, "clean.wav"), "clean");

    try {
      const result = await cleanupExpiredSessions({
        enrollmentCleanupRepository,
        storageProvider,
        storageDir,
        retentionDays: 7,
      });

      assert.deepEqual(result, { deletedCount: 1, errors: [] });
      assert.deepEqual(deletedKeys, [
        enrollmentChunkKey({
          userId: session.user_id,
          sessionId: session.id,
          chunkId: "p1",
        }),
        enrollmentChunkKey({
          userId: session.user_id,
          sessionId: session.id,
          chunkId: "p2",
        }),
        enrollmentCleanKey({ userId: session.user_id, sessionId: session.id }),
      ]);
      assert.equal(fs.existsSync(rawDir), false);
      assert.equal(fs.existsSync(cleanDir), false);
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  test("reports repository query failures with the existing cleanup error envelope", async () => {
    const result = await cleanupExpiredSessions({
      enrollmentCleanupRepository: {
        listSessionsStartedBefore: async () => {
          throw new Error("database unavailable");
        },
      },
      retentionDays: 7,
    });

    assert.deepEqual(result, {
      deletedCount: 0,
      errors: ["Cleanup query failed: database unavailable"],
    });
  });
});
