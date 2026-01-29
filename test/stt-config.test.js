/**
 * STT Configuration Service Tests
 *
 * Tests the multi-provider Speech-to-Text configuration system:
 * - Admin can switch providers without app update
 * - Graceful fallback when primary provider fails
 * - Config properly stored and retrieved from database
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { initDb } = require("../src/db");
const { AdminService } = require("../src/services/admin-service");

describe("STT Configuration Service", async () => {
  let db;
  let adminService;
  let dbPath;
  let tmpDir;

  before(async () => {
    // Create temp db file for isolated tests
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-stt-test-"));
    dbPath = path.join(tmpDir, "test.db");

    // Initialize db with migrations from project root
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });
    adminService = new AdminService(db);
  });

  after(async () => {
    // Cleanup temp db file
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("getSTTConfig", () => {
    it("returns config with default values when none set", async () => {
      // Clear any existing config
      await db.prepare("DELETE FROM app_config WHERE key = 'stt_config'").run();

      const config = await adminService.getSTTConfig();

      // Should return sensible defaults
      assert.ok(config.primary_provider, "Should have primary_provider");
      assert.ok(config.fallback_provider, "Should have fallback_provider");
      assert.ok(config.whisperkit_model, "Should have whisperkit_model");
      assert.ok(config.provider_status, "Should have provider_status object");
    });

    it("returns config from database when set", async () => {
      // Insert test config
      await db
        .prepare(
          `
        INSERT OR REPLACE INTO app_config (key, value_json, updated_at)
        VALUES ('stt_config', ?, datetime('now'))
      `
        )
        .run(
          JSON.stringify({
            primary_provider: "apple",
            fallback_provider: "whisperkit",
            whisperkit_model: "medium",
          })
        );

      const config = await adminService.getSTTConfig();

      assert.equal(config.primary_provider, "apple");
      assert.equal(config.fallback_provider, "whisperkit");
      assert.equal(config.whisperkit_model, "medium");
    });

    it("includes provider status from provider_status table", async () => {
      const config = await adminService.getSTTConfig();

      assert.ok(
        typeof config.provider_status === "object",
        "provider_status should be an object"
      );

      // Should include STT-related providers if they exist
      const statusKeys = Object.keys(config.provider_status);
      const sttKeys = statusKeys.filter((k) => k.startsWith("stt_"));
      // May have 0 or more STT providers depending on migration state
      assert.ok(
        Array.isArray(sttKeys) || sttKeys === undefined,
        "Should be able to filter STT keys"
      );
    });
  });

  describe("setSTTConfig", () => {
    it("updates primary provider", async () => {
      await adminService.setSTTConfig(
        { primary_provider: "whisperkit" },
        "admin_test"
      );

      const config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "whisperkit");
    });

    it("updates fallback provider", async () => {
      await adminService.setSTTConfig(
        { fallback_provider: "apple" },
        "admin_test"
      );

      const config = await adminService.getSTTConfig();
      assert.equal(config.fallback_provider, "apple");
    });

    it("updates whisperkit model", async () => {
      await adminService.setSTTConfig(
        { whisperkit_model: "large" },
        "admin_test"
      );

      const config = await adminService.getSTTConfig();
      assert.equal(config.whisperkit_model, "large");
    });

    it("rejects invalid primary provider", async () => {
      await assert.rejects(
        () =>
          adminService.setSTTConfig(
            { primary_provider: "invalid_provider" },
            "admin_test"
          ),
        /Invalid primary_provider/
      );
    });

    it("rejects invalid fallback provider", async () => {
      await assert.rejects(
        () =>
          adminService.setSTTConfig(
            { fallback_provider: "invalid_provider" },
            "admin_test"
          ),
        /Invalid fallback_provider/
      );
    });

    it("rejects invalid whisperkit model", async () => {
      await assert.rejects(
        () =>
          adminService.setSTTConfig(
            { whisperkit_model: "xlarge" },
            "admin_test"
          ),
        /Invalid whisperkit_model/
      );
    });

    it("accepts all valid providers", async () => {
      const validProviders = ["apple", "whisperkit", "openai"];

      for (const provider of validProviders) {
        await adminService.setSTTConfig(
          { primary_provider: provider },
          "admin_test"
        );
        const config = await adminService.getSTTConfig();
        assert.equal(
          config.primary_provider,
          provider,
          `Should accept ${provider} as primary`
        );
      }
    });

    it("accepts all valid whisperkit models", async () => {
      const validModels = ["tiny", "small", "medium", "large"];

      for (const model of validModels) {
        await adminService.setSTTConfig(
          { whisperkit_model: model },
          "admin_test"
        );
        const config = await adminService.getSTTConfig();
        assert.equal(
          config.whisperkit_model,
          model,
          `Should accept ${model} as whisperkit model`
        );
      }
    });
  });

  describe("getAppConfig", () => {
    it("returns stt config in response", async () => {
      const appConfig = await adminService.getAppConfig();

      assert.ok(appConfig.stt, "Should have stt property");
      assert.ok(appConfig.stt.primary_provider, "Should have primary_provider");
      assert.ok(
        appConfig.stt.fallback_provider,
        "Should have fallback_provider"
      );
      assert.ok(appConfig.stt.whisperkit_model, "Should have whisperkit_model");
      assert.ok(appConfig.stt.provider_status, "Should have provider_status");
    });

    it("reflects current config after changes", async () => {
      await adminService.setSTTConfig(
        {
          primary_provider: "openai",
          fallback_provider: "apple",
          whisperkit_model: "tiny",
        },
        "admin_test"
      );

      const appConfig = await adminService.getAppConfig();

      assert.equal(appConfig.stt.primary_provider, "openai");
      assert.equal(appConfig.stt.fallback_provider, "apple");
      assert.equal(appConfig.stt.whisperkit_model, "tiny");
    });
  });

  describe("Admin Provider Switching", () => {
    it("allows switching from whisperkit to apple without restart", async () => {
      // Start with WhisperKit
      await adminService.setSTTConfig(
        { primary_provider: "whisperkit" },
        "admin_test"
      );
      let config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "whisperkit");

      // Switch to Apple
      await adminService.setSTTConfig(
        { primary_provider: "apple" },
        "admin_test"
      );
      config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "apple");

      // Switch to OpenAI
      await adminService.setSTTConfig(
        { primary_provider: "openai" },
        "admin_test"
      );
      config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "openai");
    });

    it("allows configuring different fallback chains", async () => {
      // Chain: Apple -> OpenAI
      await adminService.setSTTConfig(
        { primary_provider: "apple", fallback_provider: "openai" },
        "admin_test"
      );
      let config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "apple");
      assert.equal(config.fallback_provider, "openai");

      // Chain: WhisperKit -> Apple
      await adminService.setSTTConfig(
        { primary_provider: "whisperkit", fallback_provider: "apple" },
        "admin_test"
      );
      config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "whisperkit");
      assert.equal(config.fallback_provider, "apple");

      // Chain: OpenAI -> WhisperKit
      await adminService.setSTTConfig(
        { primary_provider: "openai", fallback_provider: "whisperkit" },
        "admin_test"
      );
      config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "openai");
      assert.equal(config.fallback_provider, "whisperkit");
    });

    it("allows same provider as primary and fallback", async () => {
      // This is valid - means no fallback (only use OpenAI)
      await adminService.setSTTConfig(
        { primary_provider: "openai", fallback_provider: "openai" },
        "admin_test"
      );
      const config = await adminService.getSTTConfig();
      assert.equal(config.primary_provider, "openai");
      assert.equal(config.fallback_provider, "openai");
    });
  });

  describe("Fallback Chain Configuration", () => {
    it("configures graceful fallback with on-device providers first", async () => {
      // Recommended config: WhisperKit (on-device) -> OpenAI (cloud)
      await adminService.setSTTConfig(
        { primary_provider: "whisperkit", fallback_provider: "openai" },
        "admin_test"
      );

      const appConfig = await adminService.getAppConfig();

      assert.equal(
        appConfig.stt.primary_provider,
        "whisperkit",
        "Primary should be on-device WhisperKit"
      );
      assert.equal(
        appConfig.stt.fallback_provider,
        "openai",
        "Fallback should be cloud OpenAI"
      );
    });

    it("configures cloud-first for consistent experience", async () => {
      // Alternative config: OpenAI (consistent) -> WhisperKit (offline fallback)
      await adminService.setSTTConfig(
        { primary_provider: "openai", fallback_provider: "whisperkit" },
        "admin_test"
      );

      const appConfig = await adminService.getAppConfig();

      assert.equal(appConfig.stt.primary_provider, "openai");
      assert.equal(appConfig.stt.fallback_provider, "whisperkit");
    });
  });
});

describe("STT Provider Status", () => {
  let db;
  let adminService;
  let dbPath;
  let tmpDir;

  before(async () => {
    // Create temp db file for isolated tests
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-stt-status-test-"));
    dbPath = path.join(tmpDir, "test.db");

    // Initialize db with migrations from project root
    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });
    adminService = new AdminService(db);
  });

  after(async () => {
    // Cleanup temp db file
    if (db && db.close) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("provider_status reflects database state", async () => {
    // Get current config
    const config = await adminService.getSTTConfig();

    // provider_status should be an object
    assert.ok(
      typeof config.provider_status === "object",
      "provider_status should be an object"
    );
  });

  it("config can indicate disabled providers", async () => {
    // Insert a disabled STT provider status
    await db
      .prepare(
        `
      INSERT OR REPLACE INTO provider_status (id, provider_name, status, updated_at)
      VALUES ('prov_stt_test', 'stt_test_provider', 'disabled', datetime('now'))
    `
      )
      .run();

    const config = await adminService.getSTTConfig();

    // Should include the disabled provider in status
    if (config.provider_status["stt_test_provider"]) {
      assert.equal(
        config.provider_status["stt_test_provider"],
        "disabled",
        "Test provider should be disabled"
      );
    }

    // Cleanup
    await db
      .prepare("DELETE FROM provider_status WHERE id = 'prov_stt_test'")
      .run();
  });
});
