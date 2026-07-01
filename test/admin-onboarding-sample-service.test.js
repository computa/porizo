const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminOnboardingSampleService,
} = require("../src/services/admin/onboarding-sample-service");

function createOnboardingSampleFixture({
  appConfigRepository = {},
  samples = [],
} = {}) {
  const calls = [];
  const audits = [];
  const sampleRows = new Map(samples.map((sample) => [sample.id, { ...sample }]));

  const onboardingSampleRepository = {
    listAll: async () => {
      calls.push({ name: "listAll" });
      return [...sampleRows.values()];
    },
    findById: async (id) => {
      calls.push({ name: "findById", id });
      const row = sampleRows.get(id);
      return row ? { ...row } : undefined;
    },
    createSample: async ({ id, label, audioUrl, now, updatedBy }) => {
      calls.push({
        name: "createSample",
        id,
        label,
        audioUrl,
        now,
        updatedBy,
      });
      sampleRows.set(id, {
        id,
        label,
        audio_url: audioUrl,
        is_active: 0,
        created_at: now,
        updated_at: now,
        updated_by: updatedBy,
      });
    },
    updateSample: async ({ id, fields, now, updatedBy }) => {
      calls.push({ name: "updateSample", id, fields, now, updatedBy });
      const current = sampleRows.get(id);
      sampleRows.set(id, {
        ...current,
        ...fields,
        updated_at: now,
        updated_by: updatedBy,
      });
    },
    deleteSample: async (id) => {
      calls.push({ name: "deleteSample", id });
      sampleRows.delete(id);
    },
    activateSample: async ({ id, now, updatedBy }) => {
      calls.push({ name: "activateSample", id, now, updatedBy });
      for (const sample of sampleRows.values()) {
        sample.is_active = sample.id === id ? 1 : 0;
        sample.updated_at = now;
        sample.updated_by = updatedBy;
      }
    },
  };

  const service = createAdminOnboardingSampleService({
    onboardingSampleRepository,
    appConfigRepository: {
      findActiveOnboardingSample: async () => null,
      ...appConfigRepository,
    },
    audit: async (...args) => audits.push(args),
    now: () => "2026-06-29T10:00:00.000Z",
    createId: () => "os_fixed123456",
  });

  return { audits, calls, sampleRows, service };
}

describe("AdminOnboardingSampleService", () => {
  test("creates samples with trimmed persistence and raw audit metadata", async () => {
    const { audits, calls, service } = createOnboardingSampleFixture();

    const sample = await service.createOnboardingSample(
      { label: "  Drive Home  ", audio_url: "/audio/drive-home.mp3  " },
      "admin_audio",
    );

    assert.deepEqual(
      calls.filter((call) => call.name === "createSample"),
      [
        {
          name: "createSample",
          id: "os_fixed123456",
          label: "Drive Home",
          audioUrl: "/audio/drive-home.mp3",
          now: "2026-06-29T10:00:00.000Z",
          updatedBy: "admin_audio",
        },
      ],
    );
    assert.equal(sample.id, "os_fixed123456");
    assert.equal(sample.label, "Drive Home");
    assert.equal(sample.audio_url, "/audio/drive-home.mp3");
    assert.deepEqual(audits, [
      [
        "admin_audio",
        "admin_create_onboarding_sample",
        "onboarding_sample",
        "os_fixed123456",
        { label: "  Drive Home  ", audio_url: "/audio/drive-home.mp3  " },
      ],
    ]);
  });

  test("preserves create validation errors", async () => {
    const { service } = createOnboardingSampleFixture();

    await assert.rejects(
      () =>
        service.createOnboardingSample(
          { label: "", audio_url: "/audio/sample.mp3" },
          "admin_audio",
        ),
      /label is required/,
    );
    await assert.rejects(
      () =>
        service.createOnboardingSample(
          { label: "Sample", audio_url: "" },
          "admin_audio",
        ),
      /audio_url is required/,
    );
    await assert.rejects(
      () =>
        service.createOnboardingSample(
          { label: "Sample", audio_url: "http://example.com/sample.mp3" },
          "admin_audio",
        ),
      /audio_url must start with \/audio\/ or be an HTTPS URL/,
    );
    await assert.rejects(
      () =>
        service.createOnboardingSample(
          { label: "a".repeat(201), audio_url: "/audio/sample.mp3" },
          "admin_audio",
        ),
      /label must be 200 characters or fewer/,
    );
    await assert.rejects(
      () =>
        service.createOnboardingSample(
          { label: "Sample", audio_url: `https://${"a".repeat(500)}` },
          "admin_audio",
        ),
      /audio_url must be 500 characters or fewer/,
    );
  });

  test("updates only allowlisted fields and audits the previous values", async () => {
    const { audits, calls, service } = createOnboardingSampleFixture({
      samples: [
        {
          id: "sample_update",
          label: "Before",
          audio_url: "/audio/before.mp3",
          is_active: 0,
          created_at: "2026-06-29T09:00:00.000Z",
          updated_at: "2026-06-29T09:00:00.000Z",
          updated_by: "admin_seed",
        },
      ],
    });

    const sample = await service.updateOnboardingSample(
      "sample_update",
      { label: "After", ignored: "drop" },
      "admin_audio",
    );

    assert.equal(sample.label, "After");
    assert.equal(sample.audio_url, "/audio/before.mp3");
    assert.deepEqual(
      calls.filter((call) => call.name === "updateSample"),
      [
        {
          name: "updateSample",
          id: "sample_update",
          fields: { label: "After" },
          now: "2026-06-29T10:00:00.000Z",
          updatedBy: "admin_audio",
        },
      ],
    );
    assert.deepEqual(audits, [
      [
        "admin_audio",
        "admin_update_onboarding_sample",
        "onboarding_sample",
        "sample_update",
        {
          previous: { label: "Before", audio_url: "/audio/before.mp3" },
          updated: { label: "After" },
        },
      ],
    ]);
  });

  test("preserves update and missing-sample errors", async () => {
    const { service } = createOnboardingSampleFixture();

    await assert.rejects(
      () =>
        service.updateOnboardingSample(
          "sample_missing",
          { ignored: "drop" },
          "admin_audio",
        ),
      /No valid fields to update/,
    );
    await assert.rejects(
      () =>
        service.updateOnboardingSample(
          "sample_missing",
          { audio_url: "http://example.com/sample.mp3" },
          "admin_audio",
        ),
      /audio_url must start with \/audio\/ or be an HTTPS URL/,
    );
    await assert.rejects(
      () =>
        service.updateOnboardingSample(
          "sample_missing",
          { label: "a".repeat(201) },
          "admin_audio",
        ),
      /label must be 200 characters or fewer/,
    );
    await assert.rejects(
      () =>
        service.updateOnboardingSample(
          "sample_missing",
          { label: "After" },
          "admin_audio",
        ),
      /Onboarding sample not found/,
    );
  });

  test("deletes and activates samples with existing audit contracts", async () => {
    const { audits, service } = createOnboardingSampleFixture({
      samples: [
        {
          id: "sample_old",
          label: "Old",
          audio_url: "/audio/old.mp3",
          is_active: 1,
        },
        {
          id: "sample_new",
          label: "New",
          audio_url: "/audio/new.mp3",
          is_active: 0,
        },
      ],
    });

    const activated = await service.activateOnboardingSample(
      "sample_new",
      "admin_audio",
    );
    const deleted = await service.deleteOnboardingSample(
      "sample_old",
      "admin_audio",
    );

    assert.equal(activated.is_active, 1);
    assert.deepEqual(deleted, { success: true });
    assert.deepEqual(audits, [
      [
        "admin_audio",
        "admin_activate_onboarding_sample",
        "onboarding_sample",
        "sample_new",
        { label: "New" },
      ],
      [
        "admin_audio",
        "admin_delete_onboarding_sample",
        "onboarding_sample",
        "sample_old",
        { label: "Old", audio_url: "/audio/old.mp3" },
      ],
    ]);
  });

  test("returns null when active onboarding lookup is unavailable", async () => {
    const { service } = createOnboardingSampleFixture({
      appConfigRepository: {
        findActiveOnboardingSample: async () => {
          throw new Error("missing migration");
        },
      },
    });

    assert.equal(await service.getActiveOnboardingSample(), null);
  });
});
