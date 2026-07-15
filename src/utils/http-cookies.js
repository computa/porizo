"use strict";

function parseCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!key || !rawValue) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookie values instead of failing the entire request.
    }
  }
  return cookies;
}

module.exports = { parseCookieHeader };
