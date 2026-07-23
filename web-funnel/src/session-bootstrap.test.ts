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
} from "./session-bootstrap";

const originalFetch = globalThis.fetch;

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => value,
    set: () => undefined,
  });
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
    localStorage.setItem(TOKEN_KEY, "existing-jwt");
    const fetcher = vi.fn<typeof fetch>();
    globalThis.fetch = fetcher;

    await expect(createGuestSession()).resolves.toBe("existing-jwt");
    expect(fetcher).not.toHaveBeenCalled();
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
