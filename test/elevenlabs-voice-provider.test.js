const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, test } = require("node:test");
const {
  convertVoice,
  createVoiceClone,
} = require("../src/providers/elevenlabs-voice");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("ElevenLabs voice provider", () => {
  test("uses shared provider HTTP retries and writes converted audio", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-11labs-"));
    const sourceAudioPath = path.join(tmpDir, "source.wav");
    const outputPath = path.join(tmpDir, "converted.mp3");
    fs.writeFileSync(sourceAudioPath, Buffer.from("fake wav"));

    let calls = 0;
    let apiKeyHeader;
    global.fetch = async (_url, options) => {
      calls += 1;
      apiKeyHeader = options.headers["xi-api-key"];
      if (calls === 1) {
        return new Response("overloaded", { status: 503 });
      }
      return new Response(Buffer.from("converted audio"), { status: 200 });
    };

    try {
      const result = await convertVoice({
        apiKey: "elevenlabs_test_key",
        voiceId: "voice_123",
        sourceAudioPath,
        outputPath,
        timeoutMs: 1000,
        retries: 1,
        retryDelayMs: 0,
      });

      assert.equal(calls, 2);
      assert.equal(apiKeyHeader, "elevenlabs_test_key");
      assert.equal(result.output_path, outputPath);
      assert.equal(result.file, "converted.mp3");
      assert.equal(fs.readFileSync(outputPath).toString(), "converted audio");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not retry voice clone creation by default", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-11labs-"));
    const sourceAudioPath = path.join(tmpDir, "source.wav");
    fs.writeFileSync(sourceAudioPath, Buffer.from("fake wav"));

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return new Response("gateway timeout", { status: 503 });
    };

    try {
      await assert.rejects(
        createVoiceClone({
          apiKey: "elevenlabs_test_key",
          audioPath: sourceAudioPath,
          name: "Test Voice",
          timeoutMs: 1000,
          retryDelayMs: 0,
        }),
        /E305_ELEVENLABS_VOICE_ERROR: Failed to create voice clone: 503/,
      );
      assert.equal(calls, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
