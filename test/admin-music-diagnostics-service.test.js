const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminMusicDiagnosticsService,
  parseJsonObject,
} = require("../src/services/admin/music-diagnostics-service");

function makeTrackVersion(overrides = {}) {
  return {
    id: "version_suno",
    track_id: "track_suno",
    version_num: 2,
    user_id: "user_suno",
    title: "Suno Diagnostic",
    style: "bright pop",
    voice_mode: "clone",
    status: "ready",
    created_at: "2026-06-27T08:00:00.000Z",
    completed_at: "2026-06-27T09:00:00.000Z",
    music_plan_json: JSON.stringify({
      provider_resolved: "suno",
      provider_support: "strong",
      provider_support_score: 0.92,
      provider_resolution_reason: "best_style_match",
      generation_mode: "full",
      plan_schema_version: "music-plan-v3",
      style_prompt_compact: "bright emotional pop",
      provider_style_hint: "warm vocal",
      style_negative_constraints: ["no EDM"],
      style_intent: { mood: "warm" },
    }),
    provenance_json: JSON.stringify({
      music: { provider: "elevenlabs" },
      quality: {
        last_evaluation: { passed: true, score: 0.86 },
        reroll_count: 2,
      },
    }),
    ...overrides,
  };
}

function createFixture({ rows, jobRows } = {}) {
  const calls = [];
  const service = createAdminMusicDiagnosticsService({
    adminMusicDiagnosticsRepository: {
      listRecentTrackVersions: async (limit) => {
        calls.push({ name: "listRecentTrackVersions", limit });
        return rows ?? [makeTrackVersion()];
      },
      listLatestJobsForTrackVersions: async (trackVersionIds) => {
        calls.push({ name: "listLatestJobsForTrackVersions", trackVersionIds });
        return (
          jobRows ?? [
            {
              track_version_id: "version_suno",
              error_code: "LATEST_PROVIDER_ERROR",
              error_message: "latest failure",
              updated_at: "2026-06-27T09:35:00.000Z",
            },
          ]
        );
      },
    },
  });
  return { calls, service };
}

describe("AdminMusicDiagnosticsService", () => {
  test("parses only JSON objects", () => {
    assert.deepEqual(parseJsonObject('{"provider":"suno"}'), {
      provider: "suno",
    });
    assert.deepEqual(parseJsonObject("{bad-json"), {});
    assert.deepEqual(parseJsonObject("null"), {});
    assert.deepEqual(parseJsonObject("[1,2]"), {});
  });

  test("builds diagnostics with bounded limit, provider precedence, and latest job errors", async () => {
    const { calls, service } = createFixture();

    const result = await service.getRecentMusicDiagnostics({
      limit: 500,
      provider: "suno",
      status: "ready",
    });

    assert.deepEqual(calls, [
      { name: "listRecentTrackVersions", limit: 100 },
      {
        name: "listLatestJobsForTrackVersions",
        trackVersionIds: ["version_suno"],
      },
    ]);
    assert.deepEqual(result, {
      diagnostics: [
        {
          track_version_id: "version_suno",
          track_id: "track_suno",
          version_num: 2,
          user_id: "user_suno",
          title: "Suno Diagnostic",
          style: "bright pop",
          voice_mode: "clone",
          status: "ready",
          created_at: "2026-06-27T08:00:00.000Z",
          completed_at: "2026-06-27T09:00:00.000Z",
          provider: "suno",
          provider_support: "strong",
          provider_support_score: 0.92,
          provider_resolution_reason: "best_style_match",
          generation_mode: "full",
          plan_schema_version: "music-plan-v3",
          style_prompt_compact: "bright emotional pop",
          provider_style_hint: "warm vocal",
          style_negative_constraints: ["no EDM"],
          style_intent: { mood: "warm" },
          quality_gate: { passed: true, score: 0.86 },
          reroll_count: 2,
          last_error_code: "LATEST_PROVIDER_ERROR",
          last_error_message: "latest failure",
          last_error_at: "2026-06-27T09:35:00.000Z",
        },
      ],
    });
  });

  test("falls back to provenance render provider and defaults malformed JSON fields", async () => {
    const { service } = createFixture({
      rows: [
        makeTrackVersion({
          id: "version_render_provider",
          music_plan_json: "{bad-json",
          provenance_json: JSON.stringify({
            render: { provider: "elevenlabs" },
          }),
        }),
        makeTrackVersion({
          id: "version_malformed",
          music_plan_json: "null",
          provenance_json: "[1,2]",
        }),
      ],
      jobRows: [],
    });

    const result = await service.getRecentMusicDiagnostics({
      provider: null,
      status: null,
    });

    assert.equal(result.diagnostics[0].provider, "elevenlabs");
    assert.equal(result.diagnostics[0].quality_gate, null);
    assert.equal(result.diagnostics[0].reroll_count, 0);
    assert.equal(result.diagnostics[1].provider, null);
    assert.equal(result.diagnostics[1].provider_support, null);
    assert.equal(result.diagnostics[1].last_error_code, null);
  });

  test("filters by status and provider after diagnostic shaping", async () => {
    const { service } = createFixture({
      rows: [
        makeTrackVersion({ id: "ready_suno" }),
        makeTrackVersion({
          id: "failed_eleven",
          status: "failed",
          music_plan_json: null,
          provenance_json: JSON.stringify({ music: { provider: "elevenlabs" } }),
        }),
      ],
      jobRows: [],
    });

    const result = await service.getRecentMusicDiagnostics({
      provider: "elevenlabs",
      status: "failed",
    });

    assert.deepEqual(
      result.diagnostics.map((row) => row.track_version_id),
      ["failed_eleven"],
    );
  });

  test("handles empty repository results", async () => {
    const { calls, service } = createFixture({ rows: [], jobRows: [] });

    assert.deepEqual(await service.getRecentMusicDiagnostics({}), {
      diagnostics: [],
    });
    assert.deepEqual(calls, [
      { name: "listRecentTrackVersions", limit: 30 },
      { name: "listLatestJobsForTrackVersions", trackVersionIds: [] },
    ]);
  });
});
