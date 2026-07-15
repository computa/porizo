import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireTurnstileToken,
  resetTurnstileForTests,
  TurnstileError,
} from "./turnstile";

describe("Turnstile", () => {
  beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key"));

  afterEach(() => {
    vi.useRealTimers();
    window.turnstile = undefined;
    window.turnstileToken = undefined;
    resetTurnstileForTests();
    vi.unstubAllEnvs();
  });

  it("consumes a host-provided token exactly once", async () => {
    window.turnstileToken = "verified-token";

    await expect(acquireTurnstileToken()).resolves.toBe("verified-token");
    expect(window.turnstileToken).toBeUndefined();
  });

  it("executes the invisible widget and removes it after verification", async () => {
    const remove = vi.fn();
    const execute = vi.fn((widgetId: string) => {
      expect(widgetId).toBe("widget-1");
    });
    const render = vi.fn((_container: HTMLElement, options: Record<string, unknown>) => {
      queueMicrotask(() => (options.callback as (token: string) => void)("fresh-token"));
      return "widget-1";
    });
    window.turnstile = { execute, remove, render };

    await expect(acquireTurnstileToken()).resolves.toBe("fresh-token");
    expect(render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ execution: "execute", sitekey: "site-key" }),
    );
    expect(execute).toHaveBeenCalledWith("widget-1");
    expect(remove).toHaveBeenCalledWith("widget-1");
  });

  it("returns a typed configuration error when no site key is configured", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");

    await expect(acquireTurnstileToken()).rejects.toMatchObject({
      code: "configuration",
      name: "TurnstileError",
    });
  });

  it("removes a failed script and can retry loading", async () => {
    const firstAttempt = acquireTurnstileToken();
    const firstScript = document.getElementById("porizo-turnstile-script")!;
    firstScript.dispatchEvent(new Event("error"));

    await expect(firstAttempt).rejects.toMatchObject({ code: "network" });
    expect(firstScript.isConnected).toBe(false);

    const remove = vi.fn();
    const render = vi.fn((_container: HTMLElement, options: Record<string, unknown>) => {
      queueMicrotask(() => (options.callback as (token: string) => void)("retry-token"));
      return "widget-retry";
    });
    const retryAttempt = acquireTurnstileToken();
    const retryScript = document.getElementById("porizo-turnstile-script")!;
    expect(retryScript).not.toBe(firstScript);
    window.turnstile = { execute: vi.fn(), remove, render };
    retryScript.dispatchEvent(new Event("load"));

    await expect(retryAttempt).resolves.toBe("retry-token");
    expect(remove).toHaveBeenCalledWith("widget-retry");
  });

  it("times out a stalled script and allows a later retry", async () => {
    vi.useFakeTimers();
    const stalled = acquireTurnstileToken();
    const stalledExpectation = expect(stalled).rejects.toMatchObject({ code: "network" });
    const firstScript = document.getElementById("porizo-turnstile-script")!;
    await vi.advanceTimersByTimeAsync(10000);
    await stalledExpectation;
    expect(firstScript.isConnected).toBe(false);

    const retry = acquireTurnstileToken();
    const retryScript = document.getElementById("porizo-turnstile-script")!;
    window.turnstile = {
      execute: vi.fn(),
      remove: vi.fn(),
      render: vi.fn((_container, options) => {
        queueMicrotask(() => (options.callback as (token: string) => void)("retry-token"));
        return "widget-retry";
      }),
    };
    retryScript.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe("retry-token");
    vi.useRealTimers();
  });

  it("returns a typed verification error and cleans up the widget", async () => {
    let renderedContainer: HTMLElement | undefined;
    const remove = vi.fn();
    const render = vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
      renderedContainer = container;
      queueMicrotask(() => (options["error-callback"] as () => void)());
      return "widget-error";
    });
    window.turnstile = { execute: vi.fn(), remove, render };

    const error = await acquireTurnstileToken().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TurnstileError);
    expect(error).toMatchObject({ code: "verification" });
    expect(remove).toHaveBeenCalledWith("widget-error");
    expect(renderedContainer?.isConnected).toBe(false);
  });
});
