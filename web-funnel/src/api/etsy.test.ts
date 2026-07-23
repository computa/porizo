import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  landingStateForCode,
  landingStateForError,
  normalizeCode,
  redeemLandingState,
  type EtsyCodeStatus,
} from "./etsy";

describe("normalizeCode", () => {
  it("uppercases, trims, and collapses whitespace", () => {
    expect(normalizeCode("  pz-abcd-2345 ")).toBe("PZ-ABCD-2345");
  });

  it("returns an empty string for nullish input", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
  });
});

describe("landingStateForCode (pre-check GET response)", () => {
  const cases: Array<[EtsyCodeStatus, boolean, string]> = [
    ["unredeemed", true, "ready"],
    ["unredeemed", false, "ready"],
    ["redeemed", false, "redeemed"],
    ["void", false, "void"],
    ["not_found", false, "invalid"],
  ];

  it.each(cases)(
    "maps status=%s valid=%s to the %s landing state",
    (status, valid, expected) => {
      expect(landingStateForCode({ status, valid })).toBe(expected);
    },
  );

  it("treats an unknown status as invalid rather than throwing", () => {
    expect(
      landingStateForCode({
        status: "mystery" as EtsyCodeStatus,
        valid: false,
      }),
    ).toBe("invalid");
  });
});

describe("landingStateForError (redeem failure mapping)", () => {
  it("maps 404 to invalid", () => {
    expect(
      landingStateForError(new ApiError("no", 404, "CODE_NOT_FOUND")),
    ).toBe("invalid");
  });

  it("maps 409 (redeemed by another buyer) to redeemed", () => {
    expect(
      landingStateForError(new ApiError("used", 409, "CODE_ALREADY_REDEEMED")),
    ).toBe("redeemed");
  });

  it("maps 410 to void", () => {
    expect(landingStateForError(new ApiError("gone", 410, "CODE_VOID"))).toBe(
      "void",
    );
  });

  it("maps 429 to rate-limited", () => {
    expect(
      landingStateForError(
        new ApiError("slow down", 429, "ETSY_REDEEM_LIMIT_REACHED"),
      ),
    ).toBe("rate_limited");
  });

  it("maps a disabled funnel (404 NOT_FOUND) to unavailable, not invalid", () => {
    expect(landingStateForError(new ApiError("nope", 404, "NOT_FOUND"))).toBe(
      "unavailable",
    );
  });

  it("maps an explicitly disabled Etsy entry to unavailable", () => {
    expect(
      landingStateForError(
        new ApiError("Not found", 404, "ETSY_ENTRY_DISABLED"),
      ),
    ).toBe("unavailable");
  });

  it("maps any other failure to a generic error", () => {
    expect(
      landingStateForError(new ApiError("boom", 500, "ETSY_REDEEM_FAILED")),
    ).toBe("error");
    expect(landingStateForError(new Error("network"))).toBe("error");
  });
});

describe("redeemLandingState (client integration)", () => {
  function client(fetcher: typeof fetch) {
    return {
      get: <T>(path: string) =>
        fetcher(path, {}).then((r) => r.json() as Promise<T>),
      post: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
        fetcher(path, {
          ...init,
          method: "POST",
          body: JSON.stringify(body),
        }).then(async (r) => {
          if (!r.ok) {
            const b = (await r.json().catch(() => ({}))) as {
              error?: string;
              code?: string;
              message?: string;
            };
            throw new ApiError(
              b.message ?? "failed",
              r.status,
              b.error ?? b.code,
            );
          }
          return r.json() as Promise<T>;
        }),
      put: <T>() => Promise.reject<T>(new Error("unused")),
    };
  }

  it("returns state 'ready' and the balance on a fresh redemption", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            redeemed: true,
            idempotent: false,
            balance_after: 1,
          }),
          { status: 200 },
        ),
      );
    const result = await redeemLandingState(client(fetcher), "PZ-ABCD-2345");
    expect(result).toEqual({ state: "ready", balanceAfter: 1 });
  });

  it("forwards state 'ready' for an idempotent re-redemption by the same buyer", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            redeemed: true,
            idempotent: true,
            balance_after: 1,
          }),
          { status: 200 },
        ),
      );
    const result = await redeemLandingState(client(fetcher), "PZ-ABCD-2345");
    expect(result).toEqual({ state: "ready", balanceAfter: 1 });
  });

  it("maps a 409 into the redeemed landing state without throwing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "CODE_ALREADY_REDEEMED" }), {
        status: 409,
      }),
    );
    const result = await redeemLandingState(client(fetcher), "PZ-ABCD-2345");
    expect(result).toEqual({ state: "redeemed" });
  });
});
