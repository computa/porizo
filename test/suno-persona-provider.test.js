const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  buildGeneratePersonaPayload,
  buildUploadCoverPayload,
  extractSunoAudioId,
  generatePersona,
  submitUploadCoverTask,
  uploadFileUrl,
} = require("../src/providers/suno-persona");

describe("Suno persona provider", () => {
  test("uploads a source URL through the Suno file upload service", async () => {
    let request;
    const result = await uploadFileUrl({
      uploadBaseUrl: "https://files.example",
      apiKey: "secret",
      fileUrl:
        "https://porizo.example/enrollment/sess/clean.wav?token=redacted",
      uploadPath: "porizo/voice-personas/user_1",
      fileName: "clean.wav",
      fetchJsonFn: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return {
          success: true,
          code: 200,
          data: {
            downloadUrl: "https://temp.example/clean.wav",
            fileName: "clean.wav",
            mimeType: "audio/wav",
          },
        };
      },
    });

    assert.equal(request.url, "https://files.example/api/file-url-upload");
    assert.equal(request.options.headers.authorization, "Bearer secret");
    assert.equal(request.body.fileName, "clean.wav");
    assert.equal(result.downloadUrl, "https://temp.example/clean.wav");
  });

  test("builds upload-cover payload for voice persona preparation", () => {
    const payload = buildUploadCoverPayload({
      uploadUrl: "https://temp.example/clean.wav",
      model: "v5.5",
      audioWeight: 0.897,
      style: "clean vocal",
      title: "Seed",
      prompt: "[Verse]\nSing clearly",
      callBackUrl: "https://porizo.test/internal/suno/callback",
    });

    assert.equal(payload.uploadUrl, "https://temp.example/clean.wav");
    assert.equal(payload.model, "V5_5");
    assert.equal(payload.customMode, true);
    assert.equal(payload.instrumental, false);
    assert.equal(payload.audioWeight, 0.9);
    assert.equal(
      payload.callBackUrl,
      "https://porizo.test/internal/suno/callback",
    );
  });

  test("U1: buildUploadCoverPayload throws when callBackUrl is missing (no httpbin default)", () => {
    assert.throws(
      () =>
        buildUploadCoverPayload({
          uploadUrl: "https://temp.example/clean.wav",
        }),
      /callBackUrl is required/i,
    );
  });

  test("submits upload-cover and parses task id", async () => {
    let body;
    const result = await submitUploadCoverTask({
      baseUrl: "https://api.sunoapi.org",
      apiKey: "secret",
      uploadUrl: "https://temp.example/clean.wav",
      callBackUrl: "https://porizo.test/internal/suno/callback",
      fetchJsonFn: async (_url, options) => {
        body = JSON.parse(options.body);
        return { code: 200, msg: "success", data: { taskId: "task_123" } };
      },
    });

    assert.equal(body.uploadUrl, "https://temp.example/clean.wav");
    assert.equal(
      body.callBackUrl,
      "https://porizo.test/internal/suno/callback",
    );
    assert.equal(result.taskId, "task_123");
  });

  test("U6: extracts audio id from sunoData[0] (canonical fixture path)", () => {
    assert.equal(
      extractSunoAudioId({
        data: {
          response: {
            sunoData: [
              { id: "audio_1", sourceAudioUrl: "https://cdn.example/a.mp3" },
            ],
          },
        },
      }),
      "audio_1",
    );
  });

  test("U6: extracts audio id from snake_case suno_data variant", () => {
    assert.equal(
      extractSunoAudioId({
        data: {
          response: {
            suno_data: [
              {
                audio_id: "audio_snake",
                audio_url: "https://cdn.example/x.mp3",
              },
            ],
          },
        },
      }),
      "audio_snake",
    );
  });

  test("U6: extracts audio id directly off response when sunoData is absent", () => {
    assert.equal(
      extractSunoAudioId({
        data: { response: { audioId: "audio_direct" } },
      }),
      "audio_direct",
    );
  });

  test("U6: extracts audio id from data.audioId when response is absent", () => {
    assert.equal(
      extractSunoAudioId({ data: { audioId: "audio_top" } }),
      "audio_top",
    );
  });

  test("U6: throws E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN on unrecognized shape (no silent fallback to garbage)", () => {
    assert.throws(
      () =>
        extractSunoAudioId({
          data: { data: { data: [{ audio_id: "audio_legacy" }] } },
        }),
      /E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN/,
      "Pre-U6 collectObjects walked nested data.data.data; U6 typed extractor refuses to find IDs in unknown locations",
    );
  });

  test("U6: throws on empty response (does not return null silently)", () => {
    assert.throws(
      () => extractSunoAudioId({ data: {} }),
      /E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN/,
    );
  });

  test("U6: matches the committed fixture shape (regression guard)", () => {
    const fixture = require("./fixtures/suno-upload-cover-response.json");
    const id = extractSunoAudioId(fixture);
    assert.match(
      id,
      /^audio_/,
      "fixture extraction should produce a string starting with 'audio_'",
    );
  });

  test("U16/U6: pre-deploy gate — fixture must be live-captured before persona feature flag is flipped", () => {
    // This test only fires when SUNO_PERSONA_PROBE_VERIFIED is set in CI/deploy.
    // Local dev intentionally uses the placeholder shape — that's the documented
    // R2 procedure (capture real shape via tools/suno-persona-probe.js, then
    // overwrite this fixture). When ops sets the env var pre-deploy, this test
    // hard-fails if the fixture is still the inferred placeholder.
    if (process.env.SUNO_PERSONA_PROBE_VERIFIED !== "true") {
      return;
    }
    const fixture = require("./fixtures/suno-upload-cover-response.json");
    const meta = fixture._fixture_metadata || {};
    const captured = String(meta.captured_from || "");
    const status = String(meta.status || "");
    assert.ok(
      !captured.includes("PLACEHOLDER"),
      `fixture captured_from is still a placeholder: ${captured}`,
    );
    assert.ok(
      !status.startsWith("PRELIMINARY"),
      `fixture status is still PRELIMINARY: ${status}`,
    );
    assert.ok(
      meta.capture_timestamp,
      "fixture capture_timestamp must be set when SUNO_PERSONA_PROBE_VERIFIED=true",
    );
  });

  test("generates a persona from a completed task and audio id", async () => {
    let body;
    const result = await generatePersona({
      baseUrl: "https://api.sunoapi.org",
      apiKey: "secret",
      taskId: "task_123",
      audioId: "audio_456",
      name: "Porizo Voice",
      description: "Consented voice persona",
      style: "pop vocal",
      fetchJsonFn: async (_url, options) => {
        body = JSON.parse(options.body);
        return {
          code: 200,
          msg: "success",
          data: { personaId: "persona_live_789" },
        };
      },
    });

    assert.equal(body.taskId, "task_123");
    assert.equal(body.audioId, "audio_456");
    assert.equal(result.personaId, "persona_live_789");
  });


  test("validates generate-persona time range and required fields", () => {
    const payload = buildGeneratePersonaPayload({
      taskId: "task_123",
      audioId: "audio_456",
      name: "A".repeat(120),
      description: "D".repeat(600),
      vocalStart: -10,
      vocalEnd: 30,
      style: "pop",
    });

    assert.equal(payload.name.length, 100);
    assert.equal(payload.description.length, 500);
    assert.equal(payload.vocalStart, 0);
    assert.equal(payload.vocalEnd, 30);
  });

  test("sanitizes provider messages before throwing", async () => {
    await assert.rejects(
      uploadFileUrl({
        uploadBaseUrl: "https://files.example",
        apiKey: "secret",
        fileUrl: "https://porizo.example/clean.wav?token=secret",
        uploadPath: "porizo/voice-personas",
        fetchJsonFn: async () => ({
          code: 400,
          msg: "failed https://porizo.example/clean.wav?token=secret persona_live_123 task_123 audio_456",
        }),
      }),
      (err) => {
        assert.match(err.message, /\[redacted_url\]/);
        assert.doesNotMatch(err.message, /token=secret/);
        assert.doesNotMatch(err.message, /persona_live_123/);
        assert.doesNotMatch(err.message, /task_123/);
        assert.doesNotMatch(err.message, /audio_456/);
        return true;
      },
    );
  });

  test("rejects generate-persona vocal windows outside 10 to 30 seconds", () => {
    assert.throws(
      () =>
        buildGeneratePersonaPayload({
          taskId: "task_123",
          audioId: "audio_456",
          name: "Voice",
          description: "Desc",
          vocalStart: 5,
          vocalEnd: 9,
          style: "pop",
        }),
      /between 10 and 30/,
    );
  });
});
