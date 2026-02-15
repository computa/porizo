const {
  getProviderStyleCapability,
  normalizeProvider,
  normalizeStyle,
  getSupportScore,
} = require("./style-registry");

const DEFAULT_PROVIDER_ORDER = Object.freeze(["suno", "elevenlabs"]);
const LOW_SUPPORT_THRESHOLD = getSupportScore("medium");

function listAvailableProviders(providerConfig = {}) {
  return DEFAULT_PROVIDER_ORDER.filter((provider) => providerConfig?.[provider]?.live);
}

function rankProviderForStyle(style, provider, styleOverrides = null) {
  const capability = getProviderStyleCapability({ style, provider, styleOverrides });
  return {
    provider,
    support: capability.support,
    supportScore: capability.support_score,
    capability,
  };
}

function pickBestProviderForStyle(style, providers, styleOverrides = null) {
  if (!providers || providers.length === 0) {
    return null;
  }

  const ranked = providers.map((provider) => rankProviderForStyle(style, provider, styleOverrides));
  ranked.sort((a, b) => {
    if (b.supportScore !== a.supportScore) {
      return b.supportScore - a.supportScore;
    }
    return DEFAULT_PROVIDER_ORDER.indexOf(a.provider) - DEFAULT_PROVIDER_ORDER.indexOf(b.provider);
  });

  return ranked[0];
}

function resolveMusicProvider({
  requestedStyle,
  defaultProvider,
  providerConfig,
  autoStyleRouting = true,
  styleOverrides = null,
}) {
  const style = normalizeStyle(requestedStyle) || "pop";
  const availableProviders = listAvailableProviders(providerConfig);

  if (availableProviders.length === 0) {
    return {
      style,
      requested_provider: normalizeProvider(defaultProvider),
      provider: null,
      support: "unknown",
      support_score: getSupportScore("unknown"),
      switched: false,
      degraded: true,
      reason: "no_live_music_providers",
      available_providers: [],
    };
  }

  const requestedProvider = normalizeProvider(defaultProvider) || availableProviders[0];
  const preferredProvider = availableProviders.includes(requestedProvider)
    ? requestedProvider
    : availableProviders[0];

  const preferred = rankProviderForStyle(style, preferredProvider, styleOverrides);
  let resolved = preferred;
  let reason = preferredProvider === requestedProvider
    ? "default_provider"
    : "default_unavailable_fallback";

  if (autoStyleRouting && preferred.supportScore < LOW_SUPPORT_THRESHOLD) {
    const best = pickBestProviderForStyle(style, availableProviders, styleOverrides);
    if (best && best.provider !== preferredProvider && best.supportScore > preferred.supportScore) {
      resolved = best;
      reason = "auto_switch_style_support";
    } else if (preferred.supportScore < getSupportScore("medium")) {
      reason = "degraded_style_support";
    }
  }

  const degraded = resolved.supportScore < LOW_SUPPORT_THRESHOLD;
  return {
    style,
    requested_provider: requestedProvider,
    provider: resolved.provider,
    support: resolved.support,
    support_score: resolved.supportScore,
    switched: resolved.provider !== preferredProvider,
    degraded,
    reason,
    available_providers: availableProviders,
    capability: resolved.capability,
  };
}

module.exports = {
  DEFAULT_PROVIDER_ORDER,
  LOW_SUPPORT_THRESHOLD,
  listAvailableProviders,
  resolveMusicProvider,
};
