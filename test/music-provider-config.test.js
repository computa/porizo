const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initDb } = require("../src/db");
const { AdminService } = require("../src/services/admin-service");

describe("Music Provider Config", () => {
  let db;
  let adminService;
  let tmpDir;
  let dbPath;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-music-config-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = await initDb({
      dbPath,
      migrationsDir: path.join(__dirname, "..", "migrations"),
    });
    adminService = new AdminService(db);
  });

  after(async () => {
    if (db) db.close();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns defaults with fidelity fields", async () => {
    await db.prepare("DELETE FROM app_config WHERE key = 'music_provider_config'").run();
    const config = await adminService.getMusicProviderConfig();
    assert.equal(config.default_provider, "elevenlabs");
    assert.equal(config.auto_style_routing, true);
    assert.equal(config.elevenlabs_generation_mode, "composition_plan");
    assert.equal(config.auto_reroll_enabled, true);
    assert.equal(config.quality_threshold, 72);
    assert.equal(config.max_rerolls, 1);
    assert.deepEqual(config.style_overrides, {});
  });

  it("supports fidelity updates and sanitizes overrides", async () => {
    await adminService.setMusicProviderConfig(
      {
        default_provider: "suno",
        auto_style_routing: false,
        elevenlabs_generation_mode: "compose_detailed",
        auto_reroll_enabled: true,
        quality_threshold: 81,
        max_rerolls: 2,
        style_overrides: {
          Ogene: {
            elevenlabs: {
              support: "strong",
              instruction_override: "  lock to ogene bells and slit drums  ",
              negative_constraints: ["avoid afropop synth topline", "", null],
            },
          },
        },
      },
      "admin_test"
    );

    const config = await adminService.getMusicProviderConfig();
    assert.equal(config.default_provider, "suno");
    assert.equal(config.auto_style_routing, false);
    assert.equal(config.elevenlabs_generation_mode, "compose_detailed");
    assert.equal(config.quality_threshold, 81);
    assert.equal(config.max_rerolls, 2);
    assert.equal(config.style_overrides.ogene.elevenlabs.support, "strong");
    assert.equal(
      config.style_overrides.ogene.elevenlabs.instruction_override,
      "lock to ogene bells and slit drums"
    );
    assert.deepEqual(config.style_overrides.ogene.elevenlabs.negative_constraints, [
      "avoid afropop synth topline",
    ]);
  });

  it("rejects invalid generation mode", async () => {
    await assert.rejects(
      () =>
        adminService.setMusicProviderConfig(
          {
            elevenlabs_generation_mode: "legacy_prompt",
          },
          "admin_test"
        ),
      /elevenlabs_generation_mode must be one of: composition_plan, compose_detailed/
    );
  });
});

