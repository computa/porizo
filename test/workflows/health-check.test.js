/**
 * Provider Health Check Tests
 *
 * Tests the health check functionality for external providers.
 */

const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert");

const { createHealthCheckService } = require("../../src/workflows/health-check");

describe("Provider Health Checks", () => {
  let healthCheck;
  let mockFetch;

  beforeEach(() => {
    // Reset mock
    mockFetch = mock.fn();
  });

  test("checkElevenLabsHealth returns healthy when API responds 200", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ xi_api_key: "valid" }),
      })
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
    });

    const result = await healthCheck.checkElevenLabsHealth();

    assert.strictEqual(result.healthy, true);
    assert.strictEqual(result.provider, "elevenlabs");
    assert.ok(result.latencyMs >= 0);
    assert.strictEqual(result.error, null);
  });

  test("checkElevenLabsHealth returns unhealthy when API returns error", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "invalid-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
    });

    const result = await healthCheck.checkElevenLabsHealth();

    assert.strictEqual(result.healthy, false);
    assert.strictEqual(result.provider, "elevenlabs");
    assert.ok(result.error.includes("401"));
  });

  test("checkElevenLabsHealth returns unhealthy when network fails", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.reject(new Error("Network error"))
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
    });

    const result = await healthCheck.checkElevenLabsHealth();

    assert.strictEqual(result.healthy, false);
    assert.strictEqual(result.provider, "elevenlabs");
    assert.ok(result.error.includes("Network error"));
  });

  test("checkReplicateHealth returns healthy when API responds 200", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [] }),
      })
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      replicateToken: "test-token",
      replicateBaseUrl: "https://api.replicate.com",
    });

    const result = await healthCheck.checkReplicateHealth();

    assert.strictEqual(result.healthy, true);
    assert.strictEqual(result.provider, "replicate");
    assert.ok(result.latencyMs >= 0);
    assert.strictEqual(result.error, null);
  });

  test("checkReplicateHealth returns unhealthy when API returns error", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      replicateToken: "invalid-token",
      replicateBaseUrl: "https://api.replicate.com",
    });

    const result = await healthCheck.checkReplicateHealth();

    assert.strictEqual(result.healthy, false);
    assert.strictEqual(result.provider, "replicate");
    assert.ok(result.error.includes("403"));
  });

  test("checkAllProviders returns health status for all providers", async () => {
    mockFetch.mock.mockImplementation((url) => {
      if (url.includes("elevenlabs")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ xi_api_key: "valid" }),
        });
      }
      if (url.includes("replicate")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
      replicateToken: "test-token",
      replicateBaseUrl: "https://api.replicate.com",
    });

    const results = await healthCheck.checkAllProviders();

    assert.strictEqual(results.elevenlabs.healthy, true);
    assert.strictEqual(results.replicate.healthy, false);
    assert.ok(results.replicate.error.includes("503"));
    assert.ok(results.checkedAt);
  });

  test("checkAllProviders returns unhealthy when no providers configured", async () => {
    healthCheck = createHealthCheckService({
      fetch: mockFetch,
    });

    const results = await healthCheck.checkAllProviders();

    // Both should be unhealthy due to missing config
    assert.strictEqual(results.elevenlabs.healthy, false);
    assert.ok(results.elevenlabs.error.includes("not configured"));
    assert.strictEqual(results.replicate.healthy, false);
    assert.ok(results.replicate.error.includes("not configured"));
  });

  test("getOverallHealth returns healthy when all providers healthy", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      })
    );

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
      replicateToken: "test-token",
      replicateBaseUrl: "https://api.replicate.com",
    });

    const overall = await healthCheck.getOverallHealth();

    assert.strictEqual(overall.healthy, true);
    assert.strictEqual(overall.healthyCount, 2);
    assert.strictEqual(overall.totalCount, 2);
  });

  test("getOverallHealth returns unhealthy when any provider unhealthy", async () => {
    mockFetch.mock.mockImplementation((url) => {
      if (url.includes("elevenlabs")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });
    });

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
      replicateToken: "test-token",
      replicateBaseUrl: "https://api.replicate.com",
    });

    const overall = await healthCheck.getOverallHealth();

    assert.strictEqual(overall.healthy, false);
    assert.strictEqual(overall.healthyCount, 1);
    assert.strictEqual(overall.totalCount, 2);
    assert.ok(overall.unhealthyProviders.includes("replicate"));
  });

  test("health check respects timeout", async () => {
    // Mock that simulates a slow response by checking the abort signal
    mockFetch.mock.mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }, 5000);

        // Listen for abort signal
        if (options && options.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    });

    healthCheck = createHealthCheckService({
      fetch: mockFetch,
      elevenlabsApiKey: "test-api-key",
      elevenlabsBaseUrl: "https://api.elevenlabs.io",
      timeoutMs: 100,
    });

    const result = await healthCheck.checkElevenLabsHealth();

    assert.strictEqual(result.healthy, false);
    assert.ok(result.error.includes("timeout") || result.error.includes("aborted"));
  });
});
