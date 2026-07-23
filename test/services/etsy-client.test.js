"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createEtsyClient } = require("../../src/services/etsy-client");

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe("Etsy API client", () => {
  it("refreshes once on 401, persists rotation, and retries with the new token", async () => {
    const calls = [];
    let updated;
    const client = createEtsyClient({
      keystring: "etsy-key",
      sharedSecret: "etsy-secret",
      shopId: "shop-1",
      tokenProvider: async () => ({
        accessToken: "expired-token",
        refreshToken: "refresh-token",
      }),
      tokenUpdater: async (tokens) => {
        updated = tokens;
      },
      fetcher: async (url, options) => {
        calls.push({ url, options });
        if (url.includes("/oauth/token")) {
          return response(200, {
            access_token: "fresh-token",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          });
        }
        if (options.headers.authorization === "Bearer expired-token") {
          return response(401, {});
        }
        return response(200, { receipt_id: "123" });
      },
    });

    const receipt = await client.getReceipt("123");
    assert.equal(receipt.receipt_id, "123");
    assert.equal(calls.length, 3);
    assert.equal(
      calls.find((call) => !call.url.includes("/oauth/token")).options.headers[
        "x-api-key"
      ],
      "etsy-key:etsy-secret",
    );
    assert.equal(
      calls
        .find((call) => call.url.includes("/oauth/token"))
        .options.body.get("client_id"),
      "etsy-key",
    );
    assert.equal(updated.accessToken, "fresh-token");
    assert.equal(updated.refreshToken, "rotated-refresh");
  });

  it("single-flights concurrent token refreshes", async () => {
    let refreshCalls = 0;
    const client = createEtsyClient({
      keystring: "etsy-key",
      sharedSecret: "etsy-secret",
      shopId: "shop-1",
      tokenProvider: async () => ({
        accessToken: "expired-token",
        refreshToken: "refresh-token",
      }),
      tokenUpdater: async () => {},
      fetcher: async (url, options) => {
        if (url.includes("/oauth/token")) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return response(200, {
            access_token: "fresh-token",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          });
        }
        return response(
          options.headers.authorization === "Bearer expired-token" ? 401 : 200,
          { receipt_id: url.split("/").at(-1) },
        );
      },
    });

    await Promise.all([client.getReceipt("1"), client.getReceipt("2")]);
    assert.equal(refreshCalls, 1);
  });

  it("allows a distributed coordinator to reuse a token rotated by another replica", async () => {
    let oauthCalls = 0;
    let coordinatorCalls = 0;
    const client = createEtsyClient({
      keystring: "etsy-key",
      sharedSecret: "etsy-secret",
      shopId: "shop-1",
      tokenProvider: async () => ({
        accessToken: "expired-token",
        refreshToken: "stale-refresh",
        tokenVersion: 4,
      }),
      refreshCoordinator: async ({ tokens }) => {
        coordinatorCalls += 1;
        assert.equal(tokens.tokenVersion, 4);
        return {
          accessToken: "replica-rotated-token",
          refreshToken: "replica-rotated-refresh",
          tokenVersion: 5,
        };
      },
      fetcher: async (url, options) => {
        if (url.includes("/oauth/token")) {
          oauthCalls += 1;
          return response(500, {});
        }
        return response(
          options.headers.authorization === "Bearer expired-token" ? 401 : 200,
          { receipt_id: "123" },
        );
      },
    });

    const receipt = await client.getReceipt("123");
    assert.equal(receipt.receipt_id, "123");
    assert.equal(coordinatorCalls, 1);
    assert.equal(oauthCalls, 0);
  });

  it("distinguishes invalid_grant from a transient OAuth failure", async () => {
    async function failingClient(refreshResponse) {
      return createEtsyClient({
        keystring: "etsy-key",
        sharedSecret: "etsy-secret",
        shopId: "shop-1",
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        fetcher: async (url) =>
          url.includes("/oauth/token")
            ? refreshResponse
            : response(401, {}),
      }).getReceipt("123");
    }

    await assert.rejects(
      failingClient(response(400, { error: "invalid_grant" })),
      (error) =>
        error.code === "ETSY_RECONNECT_REQUIRED" && error.retryable === false,
    );
    await assert.rejects(
      failingClient(
        response(503, { error: "temporarily_unavailable" }, { "retry-after": "30" }),
      ),
      (error) =>
        error.code === "ETSY_OAUTH_TEMPORARY" &&
        error.retryable === true &&
        error.retryAfter === "30",
    );
  });

  it("exposes a bounded, cursor-friendly shop receipts page", async () => {
    let requestedUrl;
    const client = createEtsyClient({
      keystring: "etsy-key",
      sharedSecret: "etsy-secret",
      accessToken: "token",
      shopId: "shop/1",
      fetcher: async (url) => {
        requestedUrl = url;
        return response(200, { count: 0, results: [] });
      },
    });

    await client.listShopReceipts({
      minLastModified: 1_800_000_000,
      limit: 500,
      offset: 200,
    });
    assert.match(requestedUrl, /shops\/shop%2F1\/receipts\?/);
    assert.match(requestedUrl, /min_last_modified=1800000000/);
    assert.match(requestedUrl, /limit=100/);
    assert.match(requestedUrl, /offset=200/);
  });
});
