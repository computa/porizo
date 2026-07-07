"use strict";

const APP_LINK_INTENTS = Object.freeze({
  CREATE_SONG: "create_song",
  CREATE_POEM: "create_poem",
  OPEN_SHARE: "open_share",
  RECEIVER_HANDOFF: "receiver_handoff",
  VERIFY_EMAIL: "verify_email",
});

const DOWNLOAD_INTENT_PARAM_KEYS = Object.freeze([
  "type",
  "kind",
  "occasion",
  "recipient",
  "recipient_name",
  "name",
  "share_id",
  "content_kind",
  "receiver_handoff_id",
  "token",
]);

function normalizeBaseUrl(publicBaseUrl) {
  const raw = String(publicBaseUrl || "https://porizo.co").trim();
  return raw.replace(/\/+$/, "") || "https://porizo.co";
}

function firstString(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) {
      const found = value.find((entry) => typeof entry === "string" && entry.trim());
      if (found) return found.trim();
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function safeTextParam(value, maxLength = 160) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

function safeIdentifier(value) {
  const trimmed = safeTextParam(value, 180);
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "";
  return trimmed;
}

function normalizedKind(value) {
  return String(value || "").toLowerCase() === "poem" ? "poem" : "song";
}

function appendQuery(url, entries) {
  for (const [key, value] of Object.entries(entries || {})) {
    const safeValue = safeTextParam(String(value ?? ""), 240);
    if (safeValue) url.searchParams.set(key, safeValue);
  }
}

function buildCreateDeepLink(params = {}) {
  const type = normalizedKind(firstString(params, "type", "kind"));
  const url = new URL("porizo://create");
  url.searchParams.set("type", type);
  const occasion = safeTextParam(firstString(params, "occasion"), 80);
  const recipient = safeTextParam(
    firstString(params, "recipient", "recipient_name", "name"),
    120,
  );
  if (occasion) url.searchParams.set("occasion", occasion);
  if (recipient) url.searchParams.set("recipient", recipient);
  return url.toString();
}

function buildShareDeepLink(params = {}) {
  const shareId = safeIdentifier(firstString(params, "share_id", "shareId"));
  if (!shareId) return null;
  const kind = normalizedKind(firstString(params, "content_kind", "kind", "type"));
  const path = kind === "poem" ? "poem" : "play";
  return `porizo:///${path}/${encodeURIComponent(shareId)}`;
}

function buildReceiverHandoffDeepLink(params = {}) {
  const handoffId = safeIdentifier(
    firstString(params, "receiver_handoff_id", "receiverHandoffId"),
  );
  if (!/^rh_[a-f0-9]{24}$/.test(handoffId)) return null;
  return `porizo:///receiver-handoff/${handoffId}`;
}

function buildVerifyEmailDeepLink(params = {}) {
  const token = safeTextParam(firstString(params, "token"), 2048);
  if (!token) return null;
  const url = new URL("porizo://verify-email");
  url.searchParams.set("token", token);
  return url.toString();
}

function buildPorizoDeepLink(intent, params = {}) {
  switch (String(intent || "").toLowerCase()) {
    case APP_LINK_INTENTS.CREATE_SONG:
      return buildCreateDeepLink({ ...params, type: "song" });
    case APP_LINK_INTENTS.CREATE_POEM:
      return buildCreateDeepLink({ ...params, type: "poem" });
    case "create":
      return buildCreateDeepLink(params);
    case APP_LINK_INTENTS.OPEN_SHARE:
      return buildShareDeepLink(params);
    case APP_LINK_INTENTS.RECEIVER_HANDOFF:
      return buildReceiverHandoffDeepLink(params);
    case APP_LINK_INTENTS.VERIFY_EMAIL:
      return buildVerifyEmailDeepLink(params);
    default:
      return null;
  }
}

function buildDeepLinkFromDownloadIntent(query = {}) {
  const intent = firstString(query, "intent");
  return buildPorizoDeepLink(intent, query);
}

function buildAppOpenUrl({
  publicBaseUrl,
  intent,
  params = {},
  utm = {},
  extraParams = {},
} = {}) {
  const deepLink = buildPorizoDeepLink(intent, params);
  if (!deepLink) {
    throw new Error(`Unsupported or incomplete app link intent: ${intent}`);
  }

  const url = new URL("/download", normalizeBaseUrl(publicBaseUrl));
  url.searchParams.set("intent", intent);
  for (const key of DOWNLOAD_INTENT_PARAM_KEYS) {
    const value = firstString(params, key);
    if (value) url.searchParams.set(key, safeTextParam(value, 240));
  }
  appendQuery(url, extraParams);
  appendQuery(url, utm);
  return url.toString();
}

function extractShareTarget(shareUrl, fallbackKind = "song") {
  if (!shareUrl || typeof shareUrl !== "string") return null;
  let parsed;
  try {
    parsed = new URL(shareUrl, "https://porizo.co");
  } catch (_err) {
    return null;
  }

  const components = parsed.pathname.split("/").filter(Boolean);
  const prefix = components[0] || "";
  const shareId = components[1] || "";
  if (!shareId) return null;

  if (prefix === "play" || prefix === "s") {
    return { shareId, contentKind: "song" };
  }
  if (prefix === "poem" || prefix === "p" || prefix === "poem-share") {
    return { shareId, contentKind: "poem" };
  }
  if (prefix === "g") {
    return { shareId, contentKind: normalizedKind(fallbackKind) };
  }
  return null;
}

function buildOpenShareUrlFromShareUrl({
  publicBaseUrl,
  shareUrl,
  contentKind = "song",
  utm = {},
  extraParams = {},
} = {}) {
  const target = extractShareTarget(shareUrl, contentKind);
  if (!target) return null;
  return buildAppOpenUrl({
    publicBaseUrl,
    intent: APP_LINK_INTENTS.OPEN_SHARE,
    params: {
      share_id: target.shareId,
      content_kind: target.contentKind,
    },
    utm,
    extraParams,
  });
}

module.exports = {
  APP_LINK_INTENTS,
  buildAppOpenUrl,
  buildDeepLinkFromDownloadIntent,
  buildOpenShareUrlFromShareUrl,
  buildPorizoDeepLink,
  extractShareTarget,
  normalizeBaseUrl,
};
