const assert = require("node:assert/strict");
const { afterEach, describe, test } = require("node:test");
const { fetchResponse } = require("../src/providers/http");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("provider HTTP helper", () => {
  test("retries retryable provider responses before returning success", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporary", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const response = await fetchResponse(
      "https://provider.example/retry",
      { method: "POST" },
      { timeoutMs: 1000, retries: 1, retryDelayMs: 0, label: "test" },
    );

    assert.equal(calls, 2);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  test("aborts timed-out attempts and does not retry timeouts by default", async () => {
    let calls = 0;
    let aborts = 0;

    global.fetch = async (_url, options) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborts += 1;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    };

    await assert.rejects(
      fetchResponse(
        "https://provider.example/timeout",
        { method: "POST" },
        { timeoutMs: 10, retries: 2, retryDelayMs: 0, label: "test" },
      ),
      /request_timeout/,
    );

    assert.equal(calls, 1);
    assert.equal(aborts, 1);
  });
});
