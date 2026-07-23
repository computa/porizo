"use strict";

const crypto = require("node:crypto");
const { nowIso } = require("../utils/common");
const { decryptValue, encryptValue } = require("./etsy-secrets");

function changes(result) {
  return result?.rowCount ?? result?.changes ?? 0;
}

function oauthError(code, retryable) {
  return Object.assign(new Error(code), { code, retryable });
}

async function bootstrapEtsyConnection({
  db,
  shopId,
  accessToken,
  refreshToken,
  bootstrapGeneration,
}) {
  if (!shopId || !accessToken || !refreshToken) return { configured: false };
  const generation = Number(bootstrapGeneration);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw oauthError("ETSY_TOKEN_GENERATION_REQUIRED", false);
  }
  const now = nowIso();
  const tokenFingerprint = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const result = await db
    .prepare(
      `INSERT INTO etsy_connections
        (shop_id, access_token_encrypted, refresh_token_encrypted,
         scopes, status, token_version, bootstrap_token_fingerprint,
         bootstrap_generation, created_at, updated_at)
       VALUES (?, ?, ?, 'transactions_r', 'connected', 1, ?, ?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET
         access_token_encrypted = excluded.access_token_encrypted,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         status = 'connected',
         token_version = etsy_connections.token_version + 1,
         bootstrap_token_fingerprint = excluded.bootstrap_token_fingerprint,
         bootstrap_generation = excluded.bootstrap_generation,
         refresh_lease_until = NULL,
         last_error = NULL,
         updated_at = excluded.updated_at
       WHERE etsy_connections.status = 'reconnect_required'
         AND excluded.bootstrap_generation >
             COALESCE(etsy_connections.bootstrap_generation, 0)
         AND COALESCE(etsy_connections.bootstrap_token_fingerprint, '')
             != excluded.bootstrap_token_fingerprint`,
    )
    .run(
      shopId,
      encryptValue(accessToken),
      encryptValue(refreshToken),
      tokenFingerprint,
      generation,
      now,
      now,
    );
  return { configured: true, changed: changes(result) === 1 };
}

function createEtsyOAuthCoordinator({
  db,
  shopId,
  leaseMs = 30_000,
  pollMs = 100,
  maxPolls = 30,
}) {
  async function coordinate({ tokens, performRefresh, signal }) {
    const now = nowIso();
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    const claimed = await db
      .prepare(
        `UPDATE etsy_connections
            SET refresh_lease_until = ?, updated_at = ?
          WHERE shop_id = ? AND status = 'connected'
            AND token_version = ?
            AND (refresh_lease_until IS NULL OR refresh_lease_until < ?)`,
      )
      .run(
        leaseUntil,
        now,
        shopId,
        Number(tokens?.tokenVersion || 0),
        now,
      );
    if (changes(claimed) === 1) {
      try {
        return await performRefresh();
      } finally {
        await db
          .prepare(
            `UPDATE etsy_connections
                SET refresh_lease_until = NULL, updated_at = ?
              WHERE shop_id = ? AND refresh_lease_until = ?`,
          )
          .run(nowIso(), shopId, leaseUntil);
      }
    }

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (signal?.aborted) throw oauthError("ETSY_REQUEST_ABORTED", true);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const connection = await db
        .prepare(
          `SELECT access_token_encrypted, refresh_token_encrypted,
                  token_version, status
             FROM etsy_connections WHERE shop_id = ?`,
        )
        .get(shopId);
      if (connection?.status === "reconnect_required") {
        throw oauthError("ETSY_RECONNECT_REQUIRED", false);
      }
      if (
        connection?.status === "connected" &&
        Number(connection.token_version || 0) >
          Number(tokens?.tokenVersion || 0)
      ) {
        return {
          accessToken: decryptValue(connection.access_token_encrypted),
          refreshToken: decryptValue(connection.refresh_token_encrypted),
          tokenVersion: Number(connection.token_version),
        };
      }
    }
    throw oauthError("ETSY_OAUTH_REFRESH_BUSY", true);
  }

  async function markReconnectRequired({ tokens } = {}) {
    return db
      .prepare(
        `UPDATE etsy_connections
            SET status = 'reconnect_required',
                refresh_lease_until = NULL,
                last_error = 'ETSY_RECONNECT_REQUIRED', updated_at = ?
          WHERE shop_id = ? AND token_version = ?`,
      )
      .run(nowIso(), shopId, Number(tokens?.tokenVersion || 0));
  }

  return { coordinate, markReconnectRequired };
}

module.exports = {
  bootstrapEtsyConnection,
  createEtsyOAuthCoordinator,
};
