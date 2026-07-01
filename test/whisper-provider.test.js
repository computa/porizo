const assert = require("node:assert/strict");
const { afterEach, describe, test } = require("node:test");
const { transcribeAudio } = require("../src/providers/whisper");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Whisper provider", () => {
  test("uses shared provider HTTP retries for transient transcription failures", async () => {
    let calls = 0;
    let authHeader;
    global.fetch = async (_url, options) => {
      calls += 1;
      authHeader = options.headers.Authorization;
      if (calls === 1) {
        return new Response("overloaded", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          text: " hello world ",
          language: "en",
          duration: 1.25,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await transcribeAudio(Buffer.from("fake wav"), {
      apiKey: "openai_test_key",
      filename: "sample.wav",
      timeoutMs: 1000,
      retries: 1,
      retryDelayMs: 0,
    });

    assert.equal(calls, 2);
    assert.equal(authHeader, "Bearer openai_test_key");
    assert.deepEqual(result, {
      text: "hello world",
      language: "en",
      duration: 1.25,
    });
  });
});
