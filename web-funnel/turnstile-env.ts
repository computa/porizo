export const TURNSTILE_ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";

export const TURNSTILE_TEST_SITE_KEYS = [
  TURNSTILE_ALWAYS_PASS_SITE_KEY,
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
] as const;

const TEST_SITE_KEYS = new Set<string>(TURNSTILE_TEST_SITE_KEYS);
const LOCAL_MODES = new Set(["development", "preview", "test"]);

export function resolveTurnstileSiteKey(
  mode: string,
  configuredSiteKey?: string,
): string {
  const siteKey = configuredSiteKey?.trim();

  if (LOCAL_MODES.has(mode)) return siteKey || TURNSTILE_ALWAYS_PASS_SITE_KEY;

  if (!siteKey) {
    // Deploy-before-setup must not be build-fatal: this gate took the whole
    // site's Railway deploy down (2026-07-16) while the funnel itself was
    // flag-dark. Missing key = "not configured yet" — the bundle ships with an
    // empty key and the runtime shows the honest configuration error
    // (src/turnstile.ts throws TurnstileError("configuration") on empty key).
    // Only an actively WRONG config (test key in production, below) stays fatal.
    console.warn(
      `[web-funnel] VITE_TURNSTILE_SITE_KEY is not set for ${mode}; ` +
        "building with the funnel security check unconfigured (guest sessions will not start).",
    );
    return "";
  }
  if (TEST_SITE_KEYS.has(siteKey)) {
    throw new Error(
      `Cloudflare Turnstile test site keys are forbidden in ${mode} builds.`,
    );
  }

  return siteKey;
}
