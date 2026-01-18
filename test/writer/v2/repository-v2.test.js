/**
 * Story Repository V2 Tests
 * Tests for engine_version and v2_state_json column support
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { initDb } = require("../../../src/db");
const { createStoryRepository } = require("../../../src/database/story-repository");

describe("Story Repository V2 Support", () => {
  let db, tmpDir, storyRepo;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-repo-v2-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = await initDb({
      dbPath,
      migrationsDir: path.join(__dirname, "../../../migrations"),
    });
    storyRepo = createStoryRepository(db);
  });

  after(async () => {
    if (db && db.close) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createSession with V2 support", () => {
    it("should create session with engine_version v2", () => {
      const session = storyRepo.createSession("test-user-v2-1", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story about twins",
        engineVersion: "v2",
      });

      assert.strictEqual(session.engineVersion, "v2");
    });

    it("should store and retrieve v2State", () => {
      const v2State = {
        event: { title: "Birth of twins", type: "birth", confidence: 0.9 },
        narrative: "Test narrative about the twins.",
        beats: [{ id: "discovery", status: "missing" }],
        facts: [{ id: "f1", text: "twins born", beat: "birth" }],
        user_model: { style: "verbose", fatigue_signals: 0 },
      };

      const session = storyRepo.createSession("test-user-v2-2", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        engineVersion: "v2",
        v2State,
      });

      // Retrieve and verify
      const retrieved = storyRepo.getSession(session.id);
      assert.deepStrictEqual(retrieved.v2State, v2State);
      assert.strictEqual(retrieved.engineVersion, "v2");
    });

    it("should default engine_version to v1 for existing code paths", () => {
      const session = storyRepo.createSession("test-user-v1-default", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        // No engineVersion specified - should default to v1
      });

      assert.strictEqual(session.engineVersion, "v1");
      assert.strictEqual(session.v2State, null);
    });
  });

  describe("updateSession with V2 support", () => {
    it("should update v2State on session update", () => {
      const session = storyRepo.createSession("test-user-v2-update", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        engineVersion: "v2",
        v2State: { narrative: "Initial narrative" },
      });

      const updatedState = {
        narrative: "Updated narrative with more detail.",
        beats: [{ id: "discovery", status: "covered" }],
        facts: [{ id: "f1", text: "new fact" }],
      };

      const updated = storyRepo.updateSession(session.id, { v2State: updatedState });

      assert.strictEqual(updated.v2State.narrative, "Updated narrative with more detail.");
      assert.strictEqual(updated.v2State.beats[0].status, "covered");
    });

    it("should allow updating engine_version", () => {
      const session = storyRepo.createSession("test-user-upgrade", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        // Starts as v1
      });

      assert.strictEqual(session.engineVersion, "v1");

      // Upgrade to v2
      const updated = storyRepo.updateSession(session.id, {
        engineVersion: "v2",
        v2State: { narrative: "Migrated narrative" },
      });

      assert.strictEqual(updated.engineVersion, "v2");
      assert.strictEqual(updated.v2State.narrative, "Migrated narrative");
    });

    it("should preserve v2State when updating other fields", () => {
      const v2State = {
        narrative: "Important narrative",
        beats: [{ id: "test", status: "covered" }],
      };

      const session = storyRepo.createSession("test-user-preserve", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        engineVersion: "v2",
        v2State,
      });

      // Update only status, not v2State
      const updated = storyRepo.updateSession(session.id, {
        status: "ready_for_confirm",
      });

      // v2State should be preserved
      assert.strictEqual(updated.v2State.narrative, "Important narrative");
      assert.strictEqual(updated.status, "ready_for_confirm");
    });

    it("should extend expires_at on updates", async () => {
      const session = storyRepo.createSession("test-user-expiry", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        engineVersion: "v2",
        v2State: { narrative: "Initial narrative" },
      });

      const originalExpiresAt = new Date(session.expiresAt).getTime();
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = storyRepo.updateSession(session.id, {
        status: "active",
      });

      const updatedExpiresAt = new Date(updated.expiresAt).getTime();
      assert.ok(updatedExpiresAt >= originalExpiresAt, "expires_at should be extended on update");
    });
  });

  describe("getSession with V2 support", () => {
    it("should return v2State and engineVersion in hydrated session", () => {
      const v2State = {
        event: { type: "birthday" },
        narrative: "Test",
        beats: [],
        facts: [],
        user_model: { style: "brief" },
      };

      const session = storyRepo.createSession("test-user-get", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        engineVersion: "v2",
        v2State,
      });

      const retrieved = storyRepo.getSession(session.id);

      assert.ok(retrieved.engineVersion, "Should have engineVersion field");
      assert.ok(retrieved.v2State !== undefined, "Should have v2State field");
      assert.strictEqual(retrieved.engineVersion, "v2");
      assert.strictEqual(retrieved.v2State.event.type, "birthday");
    });

    it("should return null v2State for v1 sessions", () => {
      const session = storyRepo.createSession("test-user-v1-get", {
        arc: "celebration",
        recipientName: "Test Recipient",
        initialPrompt: "Test story",
        // v1 session
      });

      const retrieved = storyRepo.getSession(session.id);

      assert.strictEqual(retrieved.engineVersion, "v1");
      assert.strictEqual(retrieved.v2State, null);
    });
  });
});
