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

  it("rejects a missing site key in production", () => {
    expect(() => resolveTurnstileSiteKey("production")).toThrow(
      "VITE_TURNSTILE_SITE_KEY is required",
    );
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
