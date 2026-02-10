"use strict";

const crypto = require("crypto");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toStatusSet(expectedStatus) {
  if (Array.isArray(expectedStatus)) {
    return new Set(expectedStatus.filter((item) => Number.isInteger(item)));
  }
  if (Number.isInteger(expectedStatus)) {
    return new Set([expectedStatus]);
  }
  return new Set([200]);
}

function readJsonPath(payload, path) {
  if (!path) return undefined;
  return path.split(".").reduce((cursor, key) => {
    if (cursor === null || cursor === undefined) return undefined;
    return cursor[key];
  }, payload);
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function runSingleCheck({ baseUrl, check, fetchImpl, timeoutMs, defaultHeaders }) {
  const runAt = new Date().toISOString();
  const method = typeof check.method === "string" ? check.method.toUpperCase() : "GET";
  const path = typeof check.path === "string" ? check.path : "/";
  const url = `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const statusSet = toStatusSet(check.expectedStatus);
  const headers = { ...defaultHeaders, ...(isObject(check.headers) ? check.headers : {}) };

  const requestInit = { method, headers };
  if (check.body !== undefined) {
    requestInit.body = typeof check.body === "string" ? check.body : JSON.stringify(check.body);
    if (!requestInit.headers["content-type"] && !requestInit.headers["Content-Type"]) {
      requestInit.headers["content-type"] = "application/json";
    }
  }

  const timeout = createTimeoutSignal(timeoutMs);
  requestInit.signal = timeout.signal;

  try {
    const response = await fetchImpl(url, requestInit);
    timeout.clear();

    const rawBody = await response.text();
    let jsonBody = null;
    try {
      jsonBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      jsonBody = null;
    }

    const passStatus = statusSet.has(response.status);
    const expectedJson = isObject(check.expectJson) ? check.expectJson : {};
    const jsonMismatches = [];

    if (jsonBody && Object.keys(expectedJson).length > 0) {
      for (const [pathKey, expectedValue] of Object.entries(expectedJson)) {
        const actualValue = readJsonPath(jsonBody, pathKey);
        if (actualValue !== expectedValue) {
          jsonMismatches.push({
            path: pathKey,
            expected: expectedValue,
            actual: actualValue,
          });
        }
      }
    } else if (Object.keys(expectedJson).length > 0) {
      jsonMismatches.push({
        path: "<root>",
        expected: "JSON body",
        actual: rawBody || null,
      });
    }

    const textIncludes = Array.isArray(check.expectTextIncludes) ? check.expectTextIncludes : [];
    const missingText = textIncludes.filter((snippet) =>
      typeof snippet === "string" && !rawBody.includes(snippet)
    );

    const passed = passStatus && jsonMismatches.length === 0 && missingText.length === 0;

    return {
      name: check.name || `${method} ${path}`,
      passed,
      run_at: runAt,
      request: { method, path },
      expected_status: [...statusSet],
      actual_status: response.status,
      expected_json: expectedJson,
      json_mismatches: jsonMismatches,
      missing_text: missingText,
      response_body: rawBody,
      response_json: jsonBody,
      error: null,
    };
  } catch (error) {
    timeout.clear();
    return {
      name: check.name || `${method} ${path}`,
      passed: false,
      run_at: runAt,
      request: { method, path },
      expected_status: [...statusSet],
      actual_status: null,
      expected_json: isObject(check.expectJson) ? check.expectJson : {},
      json_mismatches: [],
      missing_text: [],
      response_body: null,
      response_json: null,
      error: error?.message || String(error),
    };
  }
}

async function runHttpChecks({
  baseUrl,
  checks,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  defaultHeaders = {},
}) {
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new Error("[V3 Orchestration] runHttpChecks requires baseUrl.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("[V3 Orchestration] runHttpChecks requires a fetch implementation.");
  }
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("[V3 Orchestration] runHttpChecks requires at least one check.");
  }

  const reportChecks = [];
  for (const check of checks) {
    reportChecks.push(
      await runSingleCheck({
        baseUrl,
        check,
        fetchImpl,
        timeoutMs,
        defaultHeaders,
      })
    );
  }

  const failures = reportChecks.filter((check) => !check.passed);
  return {
    run_id: crypto.randomUUID(),
    run_at: new Date().toISOString(),
    passed: failures.length === 0,
    checks: reportChecks,
    failures,
    totals: {
      checks: reportChecks.length,
      passed: reportChecks.length - failures.length,
      failed: failures.length,
    },
  };
}

module.exports = {
  runHttpChecks,
  readJsonPath,
};
