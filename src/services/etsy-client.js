"use strict";

class EtsyConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class EtsyProviderError extends Error {
  constructor(code, { status = null, retryAfter = null, retryable = false } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryable = retryable;
  }
}

function createEtsyClient({
  keystring = process.env.ETSY_KEYSTRING,
  sharedSecret = process.env.ETSY_SHARED_SECRET,
  accessToken = process.env.ETSY_ACCESS_TOKEN,
  refreshToken = process.env.ETSY_REFRESH_TOKEN,
  shopId = process.env.ETSY_SHOP_ID,
  tokenProvider = null,
  tokenUpdater = null,
  refreshCoordinator = null,
  onReconnectRequired = null,
  fetcher = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  let refreshInFlight = null;

  function configured() {
    return Boolean(
      keystring &&
        sharedSecret &&
        (accessToken || tokenProvider) &&
        shopId,
    );
  }

  async function resolveTokens() {
    const stored = tokenProvider ? await tokenProvider() : null;
    return {
      accessToken: stored?.accessToken || accessToken,
      refreshToken: stored?.refreshToken || refreshToken,
      tokenVersion: Number(stored?.tokenVersion || 0),
    };
  }

  async function performRefresh(tokens, signal) {
    if (!tokens.refreshToken) {
      throw new EtsyConfigurationError("ETSY_RECONNECT_REQUIRED");
    }
    const response = await fetcher("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: keystring,
        refresh_token: tokens.refreshToken,
      }),
      signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload?.error === "invalid_grant") {
        throw new EtsyProviderError("ETSY_RECONNECT_REQUIRED", {
          status: response.status,
          retryable: false,
        });
      }
      throw new EtsyProviderError("ETSY_OAUTH_TEMPORARY", {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const payload = await response.json();
    const updated = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || tokens.refreshToken,
      sourceTokenVersion: Number(tokens.tokenVersion || 0),
      tokenVersion: Number(tokens.tokenVersion || 0) + 1,
      expiresAt: new Date(
        Date.now() + Number(payload.expires_in || 3600) * 1000,
      ).toISOString(),
    };
    if (tokenUpdater) await tokenUpdater(updated);
    accessToken = updated.accessToken;
    refreshToken = updated.refreshToken;
    return updated;
  }

  async function refresh(tokens, signal) {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          return refreshCoordinator
            ? await refreshCoordinator({
                tokens,
                signal,
                performRefresh: () => performRefresh(tokens, signal),
              })
            : await performRefresh(tokens, signal);
        } catch (error) {
          if (error?.code === "ETSY_RECONNECT_REQUIRED") {
            await onReconnectRequired?.({ tokens, error });
          }
          throw error;
        }
      })().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function request(path, { signal } = {}) {
    if (!configured()) throw new EtsyConfigurationError("ETSY_API_UNCONFIGURED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const combinedSignal = controller.signal;
    try {
      let tokens = await resolveTokens();
      const perform = (token) =>
        fetcher(`https://openapi.etsy.com/v3/application${path}`, {
          headers: {
            "x-api-key": `${keystring}:${sharedSecret}`,
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
          signal: combinedSignal,
        });
      let response = await perform(tokens.accessToken);
      if (response.status === 401) {
        tokens = await refresh(tokens, combinedSignal);
        response = await perform(tokens.accessToken);
      }
      if (response.status === 429) {
        throw new EtsyProviderError("ETSY_RATE_LIMITED", {
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          retryable: true,
        });
      }
      if (!response.ok) {
        throw new EtsyProviderError(
          response.status === 401
            ? "ETSY_RECONNECT_REQUIRED"
            : "ETSY_API_FAILED",
          {
            status: response.status,
            retryable: response.status >= 500,
          },
        );
      }
      return response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  async function getReceipt(receiptId) {
    return request(
      `/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}`,
    );
  }

  async function getPaymentByReceiptId(receiptId) {
    return request(
      `/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}/payments`,
    );
  }

  async function listShopReceipts({
    minLastModified,
    limit = 100,
    offset = 0,
  } = {}) {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)),
      offset: String(Math.max(Number(offset) || 0, 0)),
    });
    if (minLastModified != null) {
      params.set(
        "min_last_modified",
        String(Math.max(Math.floor(Number(minLastModified) || 0), 0)),
      );
    }
    params.set("sort_on", "updated");
    params.set("sort_order", "asc");
    return request(
      `/shops/${encodeURIComponent(shopId)}/receipts?${params.toString()}`,
    );
  }

  return {
    configured,
    getReceipt,
    getPaymentByReceiptId,
    listShopReceipts,
    request,
  };
}

module.exports = {
  createEtsyClient,
  EtsyConfigurationError,
  EtsyProviderError,
};
