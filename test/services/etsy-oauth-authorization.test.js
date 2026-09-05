"use strict";

process.env.NODE_ENV = "test";
process.env.ETSY_DATA_ENCRYPTION_KEY = "test-etsy-oauth-encryption-key-at-least-32-bytes";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");
const { initDb } = require("../../src/db");
const { decryptValue } = require("../../src/services/etsy-secrets");
const { createEtsyOAuthAuthorization } = require("../../src/services/etsy-oauth-authorization");

const databases = new Set();

async function database() {
  const db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
  databases.add(db);
  return db;
}

function providerResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(async () => {
  for (const db of databases) await db.close();
  databases.clear();
});

describe("Etsy OAuth authorization", () => {
  it("uses a single-use PKCE state and persists only encrypted tokens", async () => {
    const db = await database();
    const calls = [];
    const oauth = createEtsyOAuthAuthorization({
      db,
      shopId: "67327622",
      keystring: "etsy-keystring",
      redirectUri: "https://porizo.co/integrations/etsy/callback",
      fetcher: async (...args) => {
        calls.push(args);
        return providerResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "shops_r transactions_r" });
      },
    });

    const { authorizationUrl } = await oauth.start({ adminId: "adm_initial" });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get("state");
    assert.match(state, /^[A-Za-z0-9_-]{43,}$/);
    assert.equal(url.searchParams.get("redirect_uri"), "https://porizo.co/integrations/etsy/callback");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");

    await oauth.complete({ state, code: "etsy-grant-code" });
    assert.equal(calls.length, 1);
    assert.match(calls[0][1].body, /code_verifier=/);
    const connection = await db.prepare("SELECT * FROM etsy_connections WHERE shop_id = ?").get("67327622");
    assert.equal(connection.access_token_encrypted.includes("access"), false);
    assert.equal(decryptValue(connection.access_token_encrypted), "access");
    assert.equal(connection.scopes, "shops_r transactions_r");
    await assert.rejects(() => oauth.complete({ state, code: "etsy-grant-code" }), { code: "ETSY_OAUTH_STATE_EXPIRED" });
  });

  it("rejects a token exchange that omits the receipt-read scope", async () => {
    const db = await database();
    const oauth = createEtsyOAuthAuthorization({
      db, shopId: "67327622", keystring: "etsy-keystring", redirectUri: "https://porizo.co/integrations/etsy/callback",
      fetcher: async () => providerResponse({ access_token: "access", refresh_token: "refresh", scope: "shops_r" }),
    });
    const state = new URL((await oauth.start({ adminId: "adm_initial" })).authorizationUrl).searchParams.get("state");
    await assert.rejects(() => oauth.complete({ state, code: "etsy-grant-code" }), { code: "ETSY_OAUTH_SCOPE_INSUFFICIENT" });
  });
});
