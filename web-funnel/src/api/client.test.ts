import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

describe("API client", () => {
  it("refreshes a rejected session and retries exactly once", async () => {
    let token = "expired";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const refreshSession = vi.fn(async () => {
      token = "fresh";
      return token;
    });
    const client = createApiClient({ getToken: () => token, refreshSession, fetcher });

    await expect(client.get("/example")).resolves.toEqual({ ok: true });
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer fresh" });
  });

  it("does not loop when the retried request is also unauthorized", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }),
    );
    const refreshSession = vi.fn(async () => "still-bad");
    const client = createApiClient({ getToken: () => "bad", refreshSession, fetcher });

    await expect(client.get("/example")).rejects.toMatchObject({ status: 401 });
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not replay an authenticated request when refresh cannot recover", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 }),
    );
    const refreshSession = vi.fn(async () => null);
    const client = createApiClient({
      getToken: () => "expired",
      refreshSession,
      fetcher,
    });

    await expect(client.get("/web/orders/cs_paid")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("forwards checkout cancellation and idempotency options", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ checkout_url: "https://checkout.stripe.test" }), { status: 200 }),
    );
    const controller = new AbortController();
    const client = createApiClient({ getToken: () => "guest", fetcher });

    await client.post(
      "/web/checkout",
      { track_id: "track-1" },
      { signal: controller.signal, headers: { "Idempotency-Key": "checkout-1" } },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/web/checkout",
      expect.objectContaining({
        signal: controller.signal,
        headers: expect.objectContaining({ "Idempotency-Key": "checkout-1" }),
      }),
    );
  });
});
