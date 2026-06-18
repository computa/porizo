/**
 * Canonical client-IP extractor.
 *
 * Behind Cloudflare (→ Railway → origin), `request.ip` resolves to the
 * Cloudflare edge address, not the real client. Cloudflare passes the true
 * client IP in the `CF-Connecting-IP` header. We trust that header only when
 * it parses as a valid IP (`net.isIP`), so a malformed/garbage value can't
 * poison IP-keyed rate limits or audit logs. When it's absent or invalid we
 * fall back to Fastify's `request.ip`, and finally to the literal "unknown".
 *
 * Spoof-resistance of `CF-Connecting-IP` depends on the origin only accepting
 * Cloudflare traffic (Authenticated Origin Pulls / ingress restricted to CF
 * ranges) — an infra concern documented in the hardening plan, not enforceable
 * here.
 *
 * @param {{ headers?: Record<string, unknown>, ip?: string }} request
 * @returns {string} a valid IP, or "unknown"
 */
const { isIP } = require("net");

function getClientIp(request) {
  const headers = request && request.headers ? request.headers : {};
  const cfIp = headers["cf-connecting-ip"];

  if (typeof cfIp === "string" && isIP(cfIp)) {
    return cfIp;
  }

  return (request && request.ip) || "unknown";
}

module.exports = { getClientIp };
