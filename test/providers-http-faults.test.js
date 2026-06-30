/**
 * Gate 3 — provider HTTP failure-path verification.
 *
 * Root 4 rerouted Whisper / ElevenLabs / Suno through the shared
 * src/providers/http.js `fetchResponse` retry/timeout/abort helper. The
 * existing tests cover the happy retry path; these exercise the production
 * failure modes against a REAL local http.Server (no mocks), so we know the
 * retry/backoff/exhaustion logic behaves when a provider actually misbehaves.
 */

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { fetchResponse } = require("../src/providers/http.js");

// A controllable fault server: each route programs a specific failure.
let server;
let baseUrl;
const hits = {}; // path -> attempt count

function reset(path) {
  hits[path] = 0;
}

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url;
    hits[path] = (hits[path] || 0) + 1;
    const n = hits[path];

    if (path === "/always-503") {
      res.writeHead(503);
      res.end("overloaded");
      return;
    }
    if (path === "/503-then-200") {
      if (n < 3) {
        res.writeHead(503);
        res.end("overloaded");
      } else {
        res.writeHead(200);
        res.end("ok");
      }
      return;
    }
    if (path === "/429") {
      res.writeHead(429);
      res.end("rate limited");
      return;
    }
    if (path === "/drop") {
      // Hard-destroy the socket — a connection reset, not a clean response.
      req.destroy();
      return;
    }
    if (path === "/hang") {
      // Never respond — forces the abort timeout.
      return;
    }
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("provider HTTP failure paths", () => {
  test("exhausts retries on persistent 503 and returns the final 503 (no hang, no infinite retry)", async () => {
    reset("/always-503");
    const res = await fetchResponse(
      `${baseUrl}/always-503`,
      {},
      { retries: 2, retryDelayMs: 0, timeoutMs: 1000, label: "fault" },
    );
    // After exhausting retries, fetchResponse returns the last response (not throw) for HTTP errors.
    assert.equal(res.status, 503);
    // retries=2 means 1 initial + 2 retries = 3 attempts total.
    assert.equal(
      hits["/always-503"],
      3,
      "should attempt exactly retries+1 times",
    );
  });

  test("recovers when a transient 503 clears within the retry budget", async () => {
    reset("/503-then-200");
    const res = await fetchResponse(
      `${baseUrl}/503-then-200`,
      {},
      { retries: 3, retryDelayMs: 0, timeoutMs: 1000, label: "fault" },
    );
    assert.equal(res.status, 200);
    assert.equal(
      hits["/503-then-200"],
      3,
      "should retry until the 3rd attempt succeeds",
    );
  });

  test("429 is NOT retried by default (documents current behavior — providers that 429 need explicit retryStatuses)", async () => {
    reset("/429");
    const res = await fetchResponse(
      `${baseUrl}/429`,
      {},
      { retries: 2, retryDelayMs: 0, timeoutMs: 1000, label: "fault" },
    );
    assert.equal(res.status, 429);
    assert.equal(
      hits["/429"],
      1,
      "429 not in default retryStatuses, so only one attempt",
    );
  });

  test("429 IS retried when caller opts in via retryStatuses", async () => {
    reset("/429");
    const res = await fetchResponse(
      `${baseUrl}/429`,
      {},
      {
        retries: 2,
        retryDelayMs: 0,
        timeoutMs: 1000,
        retryStatuses: [429, 503],
        label: "fault",
      },
    );
    assert.equal(res.status, 429);
    assert.equal(
      hits["/429"],
      3,
      "opt-in retryStatuses should retry 429 retries+1 times",
    );
  });

  test("connection reset (network error) is retried, then throws a normalized provider error", async () => {
    reset("/drop");
    await assert.rejects(
      () =>
        fetchResponse(
          `${baseUrl}/drop`,
          {},
          { retries: 2, retryDelayMs: 0, timeoutMs: 1000, label: "fault" },
        ),
      (err) => {
        assert.match(err.message, /provider_error:network:/);
        return true;
      },
    );
    assert.equal(
      hits["/drop"],
      3,
      "network errors are retried retries+1 times",
    );
  });

  test("timeout aborts and is NOT retried by default", async () => {
    reset("/hang");
    const start = Date.now();
    await assert.rejects(
      () =>
        fetchResponse(
          `${baseUrl}/hang`,
          {},
          { retries: 2, retryDelayMs: 0, timeoutMs: 200, label: "fault" },
        ),
      (err) => {
        assert.equal(err.message, "request_timeout");
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.equal(
      hits["/hang"],
      1,
      "timeout not retried by default → single attempt",
    );
    assert.ok(elapsed < 1500, `should abort near timeoutMs, took ${elapsed}ms`);
  });

  test("timeout IS retried when retryTimeouts=true", async () => {
    reset("/hang");
    await assert.rejects(
      () =>
        fetchResponse(
          `${baseUrl}/hang`,
          {},
          {
            retries: 2,
            retryDelayMs: 0,
            timeoutMs: 150,
            retryTimeouts: true,
            label: "fault",
          },
        ),
      (err) => {
        assert.equal(err.message, "request_timeout");
        return true;
      },
    );
    assert.equal(
      hits["/hang"],
      3,
      "retryTimeouts=true → timeout retried retries+1 times",
    );
  });
});
