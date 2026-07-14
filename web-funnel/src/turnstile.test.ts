import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireTurnstileToken } from "./turnstile";

describe("Turnstile", () => {
  beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key"));

  afterEach(() => {
    window.turnstile = undefined;
    window.turnstileToken = undefined;
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
});
