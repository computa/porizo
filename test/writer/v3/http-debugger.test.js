const { describe, it } = require("node:test");
const assert = require("node:assert");

const { runHttpChecks, readJsonPath } = require("../../../src/writer/v3/orchestration/http-debugger");

describe("V3 Orchestration HTTP Debugger", () => {
  it("reads nested JSON paths", () => {
    const value = readJsonPath({ a: { b: { c: 42 } } }, "a.b.c");
    assert.strictEqual(value, 42);
  });

  it("passes checks when status and JSON expectations match", async () => {
    const fetchMock = async () => ({
      status: 200,
      text: async () => JSON.stringify({ ok: true, data: { step: "ready" } }),
    });

    const report = await runHttpChecks({
      baseUrl: "http://localhost:3000",
      checks: [
        {
          name: "health",
          method: "GET",
          path: "/health",
          expectedStatus: 200,
          expectJson: { "data.step": "ready" },
        },
      ],
      fetchImpl: fetchMock,
    });

    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.failures.length, 0);
  });

  it("fails checks when status mismatches", async () => {
    const fetchMock = async () => ({
      status: 500,
      text: async () => JSON.stringify({ error: "bad" }),
    });

    const report = await runHttpChecks({
      baseUrl: "http://localhost:3000",
      checks: [{ method: "GET", path: "/health", expectedStatus: 200 }],
      fetchImpl: fetchMock,
    });

    assert.strictEqual(report.passed, false);
    assert.strictEqual(report.failures.length, 1);
    assert.strictEqual(report.failures[0].actual_status, 500);
  });
});
