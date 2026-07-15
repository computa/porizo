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

export function resolveTurnstileSiteKey(mode: string, configuredSiteKey?: string): string {
  const siteKey = configuredSiteKey?.trim();

  if (LOCAL_MODES.has(mode)) return siteKey || TURNSTILE_ALWAYS_PASS_SITE_KEY;

  if (!siteKey) {
    throw new Error(`VITE_TURNSTILE_SITE_KEY is required for ${mode} builds.`);
  }
  if (TEST_SITE_KEYS.has(siteKey)) {
    throw new Error(`Cloudflare Turnstile test site keys are forbidden in ${mode} builds.`);
  }

  return siteKey;
}
