const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createSunoTaskOrchestrator,
} = require("../../src/workflows/suno-task-orchestrator");

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeProvenanceJson(existingJson, patch) {
  const base = parseJson(existingJson, {});
  const merged = {
    ...base,
    ...patch,
  };
  const baseTimeline = Array.isArray(base.timeline) ? base.timeline : [];
  const patchTimeline = Array.isArray(patch.timeline) ? patch.timeline : [];
  if (patchTimeline.length > 0) {
    merged.timeline = [...baseTimeline, ...patchTimeline];
  }
  return JSON.stringify(merged);
}

function createHarness(overrides = {}) {
  const calls = [];
  const defaults = {
    durabilityService: {
      executeWithDurability: async ({ provider, fn }) => {
        calls.push({ name: "executeWithDurability", provider });
        return fn();
      },
    },
    jobDurabilityRepository: {
      attachExternalTask: async (args) => {
        calls.push({ name: "attachExternalTask", args });
      },
      heartbeatOwnedJob: async (args) => {
        calls.push({ name: "heartbeatOwnedJob", args });
      },
    },
    runnerId: "runner_1",
    storageDir: "/tmp/porizo-storage",
    storageProvider: { name: "test-storage" },
    PROVIDERS: { SUNO: "suno" },
    sunoPollIntervalSec: 10,
    logProviderRejection: (args) => {
      calls.push({ name: "logProviderRejection", args });
    },
    lyricsHashSha256: () => "lyrics_hash",
    extractProviderAudioUrl: (raw) =>
      raw.provider_audio_url || raw.instrumental_url || null,
    mergeProvenanceJson,
    getProviderAudioUrl: () => "https://existing.test/audio.mp3",
    getProviderAudioKey: () => "existing/audio.mp3",
    nowIso: () => "2026-06-29T00:00:00.000Z",
    submitSunoTask: async (args) => {
      calls.push({ name: "submitSunoTask", args });
      return "task_1";
    },
    pollSunoTaskOnce: async (args) => {
      calls.push({ name: "pollSunoTaskOnce", args });
      if (typeof args.onHeartbeat === "function") {
        await args.onHeartbeat();
      }
      return { status: "SUCCESS", response: { data: {} } };
    },
    downloadSunoAudio: async (args) => {
      calls.push({ name: "downloadSunoAudio", args });
      return {
        raw: {
          instrumental_url: "https://provider.test/instrumental.mp3",
          guide_vocal_url: "https://provider.test/guide.mp3",
          provider_audio_key: "tracks/provider/instrumental.mp3",
        },
      };
    },
    logSunoCreditUsage: (taskId, response) => {
      calls.push({ name: "logSunoCreditUsage", taskId, response });
    },
    isSunoPolicyError: (message) => /policy/i.test(String(message || "")),
    classifySunoStatus: (status) =>
      status === "FAILED"
        ? { phase: "failed" }
        : { phase: "audio_success" },
    inspectSunoAudioReadiness: () => ({ ready: true }),
    sanitizeLyricsForProviderPolicy: ({ lyrics }) => ({
      lyrics,
      changed: false,
      change_count: 0,
    }),
  };
  const orchestrator = createSunoTaskOrchestrator({
    ...defaults,
    ...overrides,
  });
  return { ...orchestrator, calls };
}

function baseArgs(overrides = {}) {
  return {
    musicConfig: {
      provider: "suno",
      baseUrl: "https://suno.test",
      apiKey: "api_key",
      sunoModel: "chirp-v4",
      timeoutMs: 12345,
    },
    job: { id: "job_1", external_task_id: null, step_data: null },
    lyrics: { sections: [{ lines: ["happy birthday"] }] },
    musicPlan: { style: "pop" },
    track: { id: "track_1", recipient_name: "Bob" },
    trackVersion: {
      id: "version_1",
      provenance_json: JSON.stringify({
        music: { previous: true },
        timeline: [{ event: "previous" }],
      }),
    },
    kind: "preview",
    routingMetadata: { provider: "suno", reason: "supported" },
    ...overrides,
  };
}

describe("Suno task orchestrator", () => {
  test("submits sanitized lyrics, attaches external task, and returns pending state", async () => {
    const { pollOrSubmitSunoTask, calls } = createHarness({
      sanitizeLyricsForProviderPolicy: ({ lyrics, recipientName }) => ({
        lyrics: { ...lyrics, sanitized_for: recipientName },
        changed: true,
        change_count: 1,
      }),
    });

    const result = await pollOrSubmitSunoTask(
      baseArgs({ sunoPersona: { persona_id: "persona_1" } }),
    );

    assert.equal(result.pending, true);
    assert.equal(result.task_id, "task_1");
    assert.equal(result.retry_after_sec, 10);
    assert.equal(result.routing.reason, "supported");

    const submit = calls.find((call) => call.name === "submitSunoTask");
    assert.equal(submit.args.lyrics.sanitized_for, "Bob");
    assert.deepEqual(submit.args.sunoPersona, { persona_id: "persona_1" });

    const attach = calls.find((call) => call.name === "attachExternalTask");
    assert.equal(attach.args.jobId, "job_1");
    assert.equal(attach.args.runnerId, "runner_1");
    assert.equal(attach.args.externalTaskId, "task_1");
    assert.deepEqual(JSON.parse(attach.args.stepDataJson), {
      provider: "suno",
      task_id: "task_1",
      kind: "preview",
      suno_reconciling: false,
      routing: { provider: "suno", reason: "supported" },
    });
  });

  test("keeps provisional Suno success pending until audio is ready", async () => {
    const { pollOrSubmitSunoTask, calls } = createHarness({
      classifySunoStatus: () => ({ phase: "provisional_success" }),
      inspectSunoAudioReadiness: () => ({
        ready: false,
        reason: "missing_audio_url",
      }),
    });

    const result = await pollOrSubmitSunoTask(
      baseArgs({
        job: {
          id: "job_1",
          external_task_id: "task_1",
          step_data: JSON.stringify({ incomplete_success_polls: 5 }),
        },
      }),
    );

    assert.equal(result.pending, true);
    assert.equal(result.task_id, "task_1");
    assert.equal(result.suno_reconciling, true);
    assert.equal(result.incomplete_success_polls, 6);
    assert.equal(result.last_suno_status, "SUCCESS");
    assert.equal(result.last_incomplete_reason, "missing_audio_url");
    assert.equal(result.retry_after_sec, 12);
    assert.equal(
      calls.some((call) => call.name === "downloadSunoAudio"),
      false,
    );
    assert.equal(
      calls.some((call) => call.name === "heartbeatOwnedJob"),
      true,
    );
  });

  test("fails only after the incomplete success polling budget is exhausted", async () => {
    const { pollOrSubmitSunoTask } = createHarness({
      classifySunoStatus: () => ({ phase: "provisional_success" }),
      inspectSunoAudioReadiness: () => ({
        ready: false,
        reason: "missing_audio_url",
      }),
    });

    await assert.rejects(
      () =>
        pollOrSubmitSunoTask(
          baseArgs({
            job: {
              id: "job_1",
              external_task_id: "task_1",
              step_data: JSON.stringify({ incomplete_success_polls: 35 }),
            },
          }),
        ),
      /E302_SUNO_INCOMPLETE_OUTPUT/,
    );
  });

  test("downloads ready Suno audio and returns provider artifact metadata", async () => {
    const { pollOrSubmitSunoTask, calls } = createHarness();

    const result = await pollOrSubmitSunoTask(
      baseArgs({
        job: { id: "job_1", external_task_id: "task_1", step_data: null },
      }),
    );

    assert.deepEqual(result, {
      instrumental_url: "https://provider.test/instrumental.mp3",
      guide_vocal_url: "https://provider.test/guide.mp3",
      provider_audio_key: "tracks/provider/instrumental.mp3",
    });
    assert.equal(
      calls.some((call) => call.name === "heartbeatOwnedJob"),
      true,
    );
    assert.equal(
      calls.some((call) => call.name === "logSunoCreditUsage"),
      true,
    );
  });

  test("logs policy failures from existing Suno tasks before throwing", async () => {
    const { pollOrSubmitSunoTask, calls } = createHarness({
      pollSunoTaskOnce: async (args) => {
        calls.push({ name: "pollSunoTaskOnce", args });
        return {
          status: "FAILED",
          response: { data: { errorMessage: "provider policy violation" } },
        };
      },
      classifySunoStatus: () => ({ phase: "failed" }),
    });

    await assert.rejects(
      () =>
        pollOrSubmitSunoTask(
          baseArgs({
            job: { id: "job_1", external_task_id: "task_1", step_data: null },
            kind: "full",
          }),
        ),
      /E302_SUNO_POLICY_ERROR/,
    );

    const rejection = calls.find((call) => call.name === "logProviderRejection");
    assert.equal(rejection.args.provider, "suno");
    assert.equal(rejection.args.errorStatus, "poll_failed");
    assert.equal(rejection.args.step, "instrumental_full");
    assert.equal(rejection.args.lyricsHash, "lyrics_hash");
  });

  test("recovers ready Suno results with provenance and guide-vocal gating", async () => {
    const { recoverSunoResultFromExistingTask } = createHarness({
      downloadSunoAudio: async () => ({
        raw: {
          provider_audio_url: "https://provider.test/full.mp3",
          guide_vocal_url: "https://provider.test/guide.mp3",
          provider_audio_key: "tracks/provider/full.mp3",
        },
      }),
    });

    const result = await recoverSunoResultFromExistingTask({
      ...baseArgs({
        job: { id: "job_1", external_task_id: "task_1", step_data: null },
        kind: "full",
      }),
      renderContract: { pipeline: "guide_tts_and_voice_convert" },
      step: "instrumental_full",
    });

    assert.equal(result.instrumental_url, "https://provider.test/full.mp3");
    assert.equal(result.guide_vocal_url, "https://provider.test/guide.mp3");
    assert.equal(result.provider_audio_key, "tracks/provider/full.mp3");
    assert.deepEqual(result.provider_routing, {
      provider: "suno",
      reason: "supported",
    });
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.music.provider, "suno");
    assert.equal(provenance.music.render_contract.pipeline, "guide_tts_and_voice_convert");
    assert.equal(provenance.timeline.at(-1).event, "suno_result_reconciled");

    const previewResult = await recoverSunoResultFromExistingTask({
      ...baseArgs({
        job: { id: "job_1", external_task_id: "task_1", step_data: null },
      }),
      renderContract: { pipeline: "provider_complete_audio" },
      step: "instrumental",
    });
    assert.equal(previewResult.guide_vocal_url, null);
  });

  test("returns null when recovery probes are not ready or fail", async () => {
    const notReady = createHarness({
      inspectSunoAudioReadiness: () => ({
        ready: false,
        reason: "missing_audio_url",
      }),
    });
    assert.equal(
      await notReady.recoverSunoResultFromExistingTask({
        ...baseArgs({
          job: { id: "job_1", external_task_id: "task_1", step_data: null },
        }),
        renderContract: { pipeline: "provider_complete_audio" },
        step: "instrumental",
      }),
      null,
    );

    const failedProbe = createHarness({
      pollSunoTaskOnce: async () => {
        throw new Error("network unavailable");
      },
    });
    assert.equal(
      await failedProbe.recoverSunoResultFromExistingTask({
        ...baseArgs({
          job: { id: "job_1", external_task_id: "task_1", step_data: null },
        }),
        renderContract: { pipeline: "provider_complete_audio" },
        step: "instrumental",
      }),
      null,
    );
  });
});
