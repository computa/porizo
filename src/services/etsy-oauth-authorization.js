"use strict";

const crypto = require("node:crypto");
const { encryptValue, decryptValue } = require("./etsy-secrets");

const REQUIRED_SCOPES = ["shops_r", "transactions_r"];
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

function failure(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function validState(value) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(String(value || ""));
}

function parseScopes(value) {
  if (Array.isArray(value)) return value.map(String);
  return String(value || "").split(/\s+/).filter(Boolean);
}

function hasRequiredScopes(scopes) {
  return REQUIRED_SCOPES.every((scope) => scopes.includes(scope));
}

function createEtsyOAuthAuthorization({ db, shopId, keystring, redirectUri, fetcher = fetch, now = () => new Date(), timeoutMs = 10_000 }) {
  if (!db) throw failure("ETSY_OAUTH_DB_REQUIRED");

  function assertConfigured() {
    if (!shopId || !keystring || !redirectUri) throw failure("ETSY_OAUTH_UNCONFIGURED");
    if (!redirectUri.startsWith("https://")) throw failure("ETSY_OAUTH_REDIRECT_URI_INVALID");
  }

  async function start({ adminId }) {
    assertConfigured();
    if (!adminId) throw failure("ETSY_OAUTH_ADMIN_REQUIRED");
    const state = crypto.randomBytes(48).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + AUTHORIZATION_TTL_MS);
    await db.prepare(
      `INSERT INTO etsy_oauth_authorizations
       (state_hash, verifier_encrypted, admin_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sha256(state), encryptValue(verifier), adminId, expiresAt.toISOString(), createdAt.toISOString());
    const params = new URLSearchParams({
      response_type: "code",
      client_id: keystring,
      redirect_uri: redirectUri,
      scope: REQUIRED_SCOPES.join(" "),
      state,
      code_challenge: sha256(verifier),
      code_challenge_method: "S256",
    });
    return { authorizationUrl: `https://www.etsy.com/oauth/connect?${params.toString()}` };
  }

  async function consume(state) {
    if (!validState(state)) throw failure("ETSY_OAUTH_STATE_INVALID");
    const stateHash = sha256(state);
    const record = await db.prepare(
      `SELECT verifier_encrypted, expires_at FROM etsy_oauth_authorizations WHERE state_hash = ?`,
    ).get(stateHash);
    if (!record) throw failure("ETSY_OAUTH_STATE_INVALID");
    const claimed = await db.prepare(
      `UPDATE etsy_oauth_authorizations SET consumed_at = ?
        WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    ).run(now().toISOString(), stateHash, now().toISOString());
    if ((claimed?.changes ?? claimed?.rowCount ?? 0) !== 1) throw failure("ETSY_OAUTH_STATE_EXPIRED");
    return decryptValue(record.verifier_encrypted);
  }

  async function complete({ state, code }) {
    assertConfigured();
    const authorizationCode = String(code || "");
    if (authorizationCode.length < 8 || authorizationCode.length > 4096) throw failure("ETSY_OAUTH_CODE_INVALID");
    const verifier = await consume(state);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetcher("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: keystring, redirect_uri: redirectUri, code: authorizationCode, code_verifier: verifier }).toString(),
        signal: controller.signal,
      });
    } catch {
      throw failure("ETSY_OAUTH_EXCHANGE_FAILED");
    } finally {
      clearTimeout(timer);
    }
    let payload;
    try { payload = await response.json(); } catch { throw failure("ETSY_OAUTH_EXCHANGE_FAILED"); }
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) throw failure("ETSY_OAUTH_EXCHANGE_FAILED");
    const scopes = parseScopes(payload.scope);
    if (!hasRequiredScopes(scopes)) throw failure("ETSY_OAUTH_SCOPE_INSUFFICIENT");
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + Math.max(60, Number(payload.expires_in || 3600)) * 1000);
    await db.prepare(
      `INSERT INTO etsy_connections
       (shop_id, access_token_encrypted, refresh_token_encrypted, access_expires_at, scopes, status, token_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', 1, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET
         access_token_encrypted = excluded.access_token_encrypted,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         access_expires_at = excluded.access_expires_at,
         scopes = excluded.scopes,
         status = 'connected', token_version = etsy_connections.token_version + 1,
         refresh_lease_until = NULL, last_error = NULL, updated_at = excluded.updated_at`,
    ).run(shopId, encryptValue(payload.access_token), encryptValue(payload.refresh_token), expiresAt.toISOString(), REQUIRED_SCOPES.join(" "), issuedAt.toISOString(), issuedAt.toISOString());
    return { scopes: REQUIRED_SCOPES };
  }

  return { start, complete };
}

module.exports = { AUTHORIZATION_TTL_MS, REQUIRED_SCOPES, createEtsyOAuthAuthorization };
