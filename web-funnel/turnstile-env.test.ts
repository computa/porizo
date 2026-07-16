import { describe, expect, it } from "vitest";
import {
  resolveTurnstileSiteKey,
  TURNSTILE_ALWAYS_PASS_SITE_KEY,
  TURNSTILE_TEST_SITE_KEYS,
} from "./turnstile-env";

describe("Turnstile build environment", () => {
  it("defaults local development and preview builds to the always-pass key", () => {
    expect(resolveTurnstileSiteKey("development")).toBe(TURNSTILE_ALWAYS_PASS_SITE_KEY);
    expect(resolveTurnstileSiteKey("preview")).toBe(TURNSTILE_ALWAYS_PASS_SITE_KEY);
  });

  it("allows the always-pass key in preview builds", () => {
    expect(resolveTurnstileSiteKey("preview", TURNSTILE_ALWAYS_PASS_SITE_KEY)).toBe(
      TURNSTILE_ALWAYS_PASS_SITE_KEY,
    );
  });

  it("builds with an empty key when production has none configured (deploy-before-setup)", () => {
    // Not build-fatal: a missing key must never block the whole site deploy
    // (2026-07-16 Railway outage). Runtime surfaces the configuration error.
    expect(resolveTurnstileSiteKey("production")).toBe("");
  });

  it.each(TURNSTILE_TEST_SITE_KEYS)("rejects documented test site key %s in production", (key) => {
    expect(() => resolveTurnstileSiteKey("production", key)).toThrow(
      "Cloudflare Turnstile test site keys are forbidden",
    );
  });

  it("accepts a configured non-test site key in production", () => {
    expect(resolveTurnstileSiteKey("production", "real-site-key")).toBe("real-site-key");
  });
});
