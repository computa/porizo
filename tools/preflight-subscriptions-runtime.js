#!/usr/bin/env node
/**
 * Runtime billing preflight checker for TestFlight/App Store readiness.
 *
 * Validates deployed API runtime state using admin auth:
 * - APPLE_BUNDLE_ID correctness
 * - Apple receipt validator configuration status
 * - Apple plan-product mappings required by active paid plans
 *
 * Required environment variables:
 * - API_BASE_URL
 * - ADMIN_EMAIL
 * - ADMIN_PASSWORD
 *
 * Optional:
 * - EXPECTED_APPLE_BUNDLE_ID
 * - VERIFY_APPLE_AUTH (default: true)
 * - REQUEST_TIMEOUT_MS (default: 20000)
 *
 * Usage:
 *   API_BASE_URL=https://api.porizo.co \
 *   ADMIN_EMAIL=admin@porizo.co \
 *   ADMIN_PASSWORD=... \
 *   EXPECTED_APPLE_BUNDLE_ID=porizo.ios.app.PorizoApp \
 *   node tools/preflight-subscriptions-runtime.js
 */

const DEFAULT_TIMEOUT_MS = 20_000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function printIssues(issues, warnings) {
  if (issues.length === 0) {
    console.log("✅ No blocking issues found.");
  } else {
    console.log(`❌ Blocking issues (${issues.length}):`);
    for (const issue of issues) {
      console.log(`- [${issue.code}] ${issue.message}`);
      if (issue.details) {
        console.log(`  details: ${JSON.stringify(issue.details)}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log(`⚠️ Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`- [${warning.code}] ${warning.message}`);
    }
  }
}

function isValidPreflightPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  if (!("ok" in payload)) return false;
  if (!Array.isArray(payload.issues)) return false;
  if (!Array.isArray(payload.warnings)) return false;
  if (!payload.checks || typeof payload.checks !== "object") return false;
  if (!payload.checks.apple_bundle_id || typeof payload.checks.apple_bundle_id !== "object") {
    return false;
  }
  if (!payload.checks.apple_products || typeof payload.checks.apple_products !== "object") {
    return false;
  }
  return true;
}

async function main() {
  const apiBaseUrl = requireEnv("API_BASE_URL").replace(/\/+$/, "");
  const adminEmail = requireEnv("ADMIN_EMAIL");
  const adminPassword = requireEnv("ADMIN_PASSWORD");
  const expectedBundleId = (process.env.EXPECTED_APPLE_BUNDLE_ID || "").trim();
  const verifyAppleAuth = !["0", "false", "no", "off"].includes(
    (process.env.VERIFY_APPLE_AUTH || "true").trim().toLowerCase()
  );
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  const loginResult = await requestJson(`${apiBaseUrl}/admin/auth/login`, {
    method: "POST",
    timeoutMs,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  if (!loginResult.ok || !loginResult.payload?.token) {
    console.error("Failed to authenticate admin session.");
    console.error(JSON.stringify(loginResult.payload, null, 2));
    process.exit(1);
  }

  const queryParams = new URLSearchParams();
  if (expectedBundleId) {
    queryParams.set("expected_bundle_id", expectedBundleId);
  }
  if (verifyAppleAuth) {
    queryParams.set("verify_apple_auth", "1");
  }
  const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
  const preflightResult = await requestJson(
    `${apiBaseUrl}/admin/billing/preflight${query}`,
    {
      timeoutMs,
      headers: {
        authorization: `Bearer ${loginResult.payload.token}`,
      },
    }
  );

  if (!preflightResult.ok) {
    console.error(`Billing preflight endpoint failed with HTTP ${preflightResult.status}.`);
    console.error(JSON.stringify(preflightResult.payload, null, 2));
    process.exit(1);
  }

  const payload = preflightResult.payload || {};
  if (!isValidPreflightPayload(payload)) {
    const raw = typeof payload?.raw === "string" ? payload.raw.slice(0, 300) : null;
    console.error(
      "Invalid /admin/billing/preflight response shape. This usually means backend is not deployed with the new route."
    );
    if (raw) {
      console.error(`Response preview: ${raw}`);
    } else {
      console.error(JSON.stringify(payload, null, 2));
    }
    process.exit(1);
  }

  const issues = Array.isArray(payload.issues) ? payload.issues : [];
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const bundleCheck = payload.checks?.apple_bundle_id || {};
  const productCheck = payload.checks?.apple_products || {};
  const authCheck = payload.checks?.apple_auth || {};

  console.log("=== Billing Runtime Preflight ===");
  console.log(`API: ${apiBaseUrl}`);
  console.log(`Checked at: ${payload.checked_at || "unknown"}`);
  console.log(`Configured APPLE_BUNDLE_ID: ${bundleCheck.configured || "(missing)"}`);
  console.log(`Expected APPLE_BUNDLE_ID: ${bundleCheck.expected || "(not provided)"}`);
  console.log(`Bundle match: ${bundleCheck.matches_expected}`);
  console.log(`Apple validator configured: ${bundleCheck.validator_configured}`);
  console.log(`Apple auth probe requested: ${authCheck.requested === true}`);
  if (authCheck.probe) {
    console.log(`Apple auth probe ok: ${authCheck.probe.ok}`);
    if (Array.isArray(authCheck.probe.attempts)) {
      for (const attempt of authCheck.probe.attempts) {
        console.log(
          `- auth probe ${attempt.environment}: ok=${attempt.ok} status=${attempt.status} errorCode=${attempt.errorCode || "none"}`
        );
      }
    }
  }
  console.log(`Active paid plans: ${productCheck.active_paid_plan_count ?? "unknown"}`);
  console.log(`Apple mappings: ${productCheck.apple_mapping_count ?? "unknown"}`);
  console.log(
    `Unique Apple product IDs: ${productCheck.unique_apple_product_id_count ?? "unknown"}`
  );

  if (Array.isArray(productCheck.required_by_plan)) {
    console.log("Per-plan mapping status:");
    for (const plan of productCheck.required_by_plan) {
      console.log(
        `- ${plan.plan_id} (${plan.tier}): monthly=${plan.found?.monthly || "MISSING"}, annual=${plan.found?.annual || "MISSING"}`
      );
    }
  }

  printIssues(issues, warnings);
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Runtime billing preflight failed:", err.message);
  process.exit(1);
});
