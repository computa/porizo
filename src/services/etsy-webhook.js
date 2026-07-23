"use strict";

const crypto = require("node:crypto");

function configurationError(code) {
  return Object.assign(new Error(code), { code });
}

function signingKey(secret) {
  const raw = String(secret || "");
  if (!raw) throw configurationError("ETSY_WEBHOOK_SECRET_REQUIRED");
  const encoded = raw.startsWith("whsec_") ? raw.slice(6) : raw;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw configurationError("ETSY_WEBHOOK_SECRET_INVALID");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length < 32 || decoded.toString("base64") !== encoded) {
    throw configurationError("ETSY_WEBHOOK_SECRET_INVALID");
  }
  return decoded;
}

function signatureCandidates(header) {
  return String(header || "")
    .split(/[\s,]+/)
    .map((part) => part.replace(/^v1[=:]?/, ""))
    .filter((part) => /^[A-Za-z0-9+/=_-]{20,}$/.test(part))
    .map((part) => {
      try {
        return Buffer.from(part, "base64");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function verifyEtsyWebhook({
  rawBody,
  webhookId,
  webhookTimestamp,
  webhookSignature,
  secret = process.env.ETSY_WEBHOOK_SECRET,
  nowMs = Date.now(),
  toleranceSeconds = 300,
}) {
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw configurationError("ETSY_WEBHOOK_HEADERS_REQUIRED");
  }
  const timestampSeconds = Number(webhookTimestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowMs / 1000 - timestampSeconds) > toleranceSeconds
  ) {
    throw configurationError("ETSY_WEBHOOK_TIMESTAMP_INVALID");
  }
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody || ""), "utf8");
  const content = Buffer.concat([
    Buffer.from(`${webhookId}.${webhookTimestamp}.`, "utf8"),
    body,
  ]);
  const expected = crypto
    .createHmac("sha256", signingKey(secret))
    .update(content)
    .digest();
  const valid = signatureCandidates(webhookSignature).some(
    (candidate) =>
      candidate.length === expected.length &&
      crypto.timingSafeEqual(candidate, expected),
  );
  if (!valid) throw configurationError("ETSY_WEBHOOK_SIGNATURE_INVALID");
  return {
    bodySha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

module.exports = { verifyEtsyWebhook };
