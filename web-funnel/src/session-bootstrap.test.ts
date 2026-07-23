import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./turnstile", () => ({
  acquireTurnstileToken: vi.fn(async () => "turnstile-token"),
}));

import { acquireTurnstileToken } from "./turnstile";
import {
  TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  createGuestSession,
  exchangeWebSession,
  refreshExistingSession,
} from "./session-bootstrap";

const originalFetch = globalThis.fetch;

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => value,
    set: () => undefined,
  });
}

function jwt(exp: number) {
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

beforeEach(() => {
  localStorage.clear();
  setCookie("");
  vi.mocked(acquireTurnstileToken).mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createGuestSession", () => {
  it("mints a fresh guest session via Turnstile and stores both tokens", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "guest-jwt",
            refresh_token: "guest-refresh",
          }),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetcher;

    await expect(createGuestSession()).resolves.toBe("guest-jwt");
    expect(acquireTurnstileToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/web/session",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(localStorage.getItem(TOKEN_KEY)).toBe("guest-jwt");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("guest-refresh");
  });

  it("reuses an already-stored guest token without hitting the network", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    localStorage.setItem(TOKEN_KEY, token);
    const fetcher = vi.fn<typeof fetch>();
    globalThis.fetch = fetcher;

    await expect(createGuestSession()).resolves.toBe(token);
    expect(fetcher).not.toHaveBeenCalled();
    expect(acquireTurnstileToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired stored token instead of returning it blindly", async () => {
    localStorage.setItem(TOKEN_KEY, jwt(Math.floor(Date.now() / 1000) - 60));
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-one");
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-two",
        }),
        { status: 200 },
      ),
    );

    await expect(createGuestSession()).resolves.toBe("fresh-access");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-two");
    expect(acquireTurnstileToken).not.toHaveBeenCalled();
  });

  it("bridges a signed-in web session ahead of minting a guest one", async () => {
    setCookie("__Host-porizo_web_csrf=csrf-token");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "member-jwt" }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetcher;

    await expect(createGuestSession()).resolves.toBe("member-jwt");
    expect(fetcher).toHaveBeenCalledWith(
      "/auth/web/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(acquireTurnstileToken).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("member-jwt");
  });

  it("surfaces a failed session mint as an ApiError with the server code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "WEB_SESSION_LIMIT_REACHED" }), {
        status: 429,
      }),
    );
    globalThis.fetch = fetcher;

    await expect(createGuestSession()).rejects.toMatchObject({
      status: 429,
      code: "WEB_SESSION_LIMIT_REACHED",
    });
  });
});

describe("refreshExistingSession", () => {
  it("keeps a refresh token on temporary server failure", async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, "keep-me");
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(refreshExistingSession()).resolves.toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("keep-me");
  });

  it("single-flights concurrent refreshes so token rotation cannot race", async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-one");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-two",
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetcher;

    await expect(
      Promise.all([refreshExistingSession(), refreshExistingSession()]),
    ).resolves.toEqual(["fresh-access", "fresh-access"]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-two");
  });
});

describe("exchangeWebSession", () => {
  it("returns null when no CSRF cookie is present", async () => {
    const fetcher = vi.fn<typeof fetch>();
    globalThis.fetch = fetcher;
    await expect(exchangeWebSession()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when the bridge is unauthorized", async () => {
    setCookie("__Host-porizo_web_csrf=csrf-token");
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(exchangeWebSession()).resolves.toBeNull();
  });
});
