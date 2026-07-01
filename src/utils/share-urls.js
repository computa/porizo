function deriveSharePublicBaseUrl(publicBaseUrl) {
  try {
    const parsed = new URL(publicBaseUrl);
    if (parsed.hostname === "api.porizo.co") {
      parsed.hostname = "porizo.co";
      return parsed.origin;
    }
  } catch (_) {
    // Fall through to the configured base URL for local/dev values.
  }
  return publicBaseUrl;
}

function buildShareAppDownloadUrl({ publicBaseUrl, kind = "song" }) {
  const query = new URLSearchParams({
    channel: "appstore",
    utm_source: "share_player",
    utm_medium: "recipient_loop",
    utm_campaign: "shared_song_recipient",
    utm_content: `${kind}_generic_install`,
  });
  return `${publicBaseUrl}/download?${query.toString()}`;
}

function buildPlayShareUrl(
  { sharePublicBaseUrl, shareCoverVersion },
  shareId,
  { versioned = true, socialCacheToken = null } = {},
) {
  const params = new URLSearchParams();
  if (versioned && shareCoverVersion) {
    params.set("sv", String(shareCoverVersion));
  }
  if (socialCacheToken) {
    params.set("smv", String(socialCacheToken).slice(0, 64));
  }
  const query = params.toString();
  return `${sharePublicBaseUrl}/play/${shareId}${query ? `?${query}` : ""}`;
}

function buildPoemShareUrl(
  { sharePublicBaseUrl, shareCoverVersion },
  shareId,
  { versioned = true } = {},
) {
  if (!versioned || !shareCoverVersion) {
    return `${sharePublicBaseUrl}/poem/${shareId}`;
  }
  return `${sharePublicBaseUrl}/poem/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
}

function buildGiftShareUrl(
  { sharePublicBaseUrl, shareCoverVersion },
  shareId,
  { versioned = true } = {},
) {
  if (!versioned || !shareCoverVersion) {
    return `${sharePublicBaseUrl}/g/${shareId}`;
  }
  return `${sharePublicBaseUrl}/g/${shareId}?sv=${encodeURIComponent(String(shareCoverVersion))}`;
}

function buildRequestedShareUrl(
  { sharePublicBaseUrl },
  request,
  expectedPath,
  fallbackUrl,
) {
  const rawUrl = request?.raw?.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return fallbackUrl;
  }
  try {
    const parsed = new URL(rawUrl, sharePublicBaseUrl);
    if (parsed.pathname !== expectedPath) {
      return fallbackUrl;
    }
    return parsed.toString();
  } catch (_) {
    return fallbackUrl;
  }
}

function extractSocialCacheToken({ publicBaseUrl }, request) {
  const rawUrl = request?.raw?.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }
  try {
    const parsed = new URL(rawUrl, publicBaseUrl);
    const tokenKeys = ["smv", "fbv", "xv", "igv", "ttv", "pv"];
    for (const key of tokenKeys) {
      const value = parsed.searchParams.get(key);
      if (value && String(value).trim()) {
        return String(value).slice(0, 64);
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

function buildShareCoverUrl(
  { sharePublicBaseUrl, shareCoverVersion },
  shareId,
  { socialCacheToken, artworkVersion, variant } = {},
) {
  const params = new URLSearchParams();
  if (shareCoverVersion) {
    params.set("v", String(shareCoverVersion));
  }
  if (socialCacheToken) {
    params.set("smv", String(socialCacheToken));
  }
  if (artworkVersion) {
    params.set("av", String(artworkVersion));
  }
  if (variant) {
    params.set("variant", String(variant));
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return `${sharePublicBaseUrl}/share/${shareId}/cover.jpg${suffix}`;
}

function buildPoemOgImageUrl(
  { sharePublicBaseUrl, shareCoverVersion },
  shareId,
  { socialCacheToken } = {},
) {
  const params = new URLSearchParams();
  if (shareCoverVersion) {
    params.set("v", String(shareCoverVersion));
  }
  if (socialCacheToken) {
    params.set("smv", String(socialCacheToken));
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return `${sharePublicBaseUrl}/poem/${shareId}/og-image.png${suffix}`;
}

function buildShareUrlHelpers({
  publicBaseUrl,
  sharePublicBaseUrl,
  shareCoverVersion,
  now = Date.now,
}) {
  const options = {
    publicBaseUrl,
    sharePublicBaseUrl,
    shareCoverVersion,
  };

  function scopedBuildPlayShareUrl(shareId, params) {
    return buildPlayShareUrl(options, shareId, params);
  }

  function scopedBuildPoemShareUrl(shareId, params) {
    return buildPoemShareUrl(options, shareId, params);
  }

  return {
    buildShareAppDownloadUrl: ({ shareId: _shareId, kind = "song" } = {}) =>
      buildShareAppDownloadUrl({ publicBaseUrl, kind }),
    buildPlayShareUrl: scopedBuildPlayShareUrl,
    buildFreshPlayShareUrl: (shareId) =>
      scopedBuildPlayShareUrl(shareId, { socialCacheToken: now() }),
    buildPoemShareUrl: scopedBuildPoemShareUrl,
    buildGiftShareUrl: (shareId, params) =>
      buildGiftShareUrl(options, shareId, params),
    buildRequestedPlayShareUrl: (request, shareId) =>
      buildRequestedShareUrl(
        options,
        request,
        `/play/${shareId}`,
        scopedBuildPlayShareUrl(shareId),
      ),
    buildRequestedPoemShareUrl: (request, shareId) =>
      buildRequestedShareUrl(
        options,
        request,
        `/poem/${shareId}`,
        scopedBuildPoemShareUrl(shareId),
      ),
    extractSocialCacheToken: (request) =>
      extractSocialCacheToken(options, request),
    buildShareCoverUrl: (shareId, params) =>
      buildShareCoverUrl(options, shareId, params),
    buildPoemOgImageUrl: (shareId, params) =>
      buildPoemOgImageUrl(options, shareId, params),
  };
}

module.exports = {
  buildShareUrlHelpers,
  deriveSharePublicBaseUrl,
  buildShareAppDownloadUrl,
  buildPlayShareUrl,
  buildPoemShareUrl,
  buildGiftShareUrl,
  buildRequestedShareUrl,
  extractSocialCacheToken,
  buildShareCoverUrl,
  buildPoemOgImageUrl,
};
