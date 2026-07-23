import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EtsyEntry from "./EtsyEntry";

function modeResponse(mode: "off" | "code" | "api") {
  return new Response(JSON.stringify({ mode }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("EtsyEntry mode routing", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/etsy");
    vi.restoreAllMocks();
  });

  it("renders code entry in code mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modeResponse("code")));
    render(<EtsyEntry />);
    expect(await screen.findByLabelText("Redemption code")).toBeVisible();
  });

  it("renders receipt entry in api mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modeResponse("api")));
    render(<EtsyEntry />);
    expect(await screen.findByLabelText(/receipt number/i)).toBeVisible();
  });

  it("keeps legacy code entry available at /etsy/code in api mode", async () => {
    history.replaceState({}, "", "/etsy/code");
    vi.stubGlobal("fetch", vi.fn(async () => modeResponse("api")));
    render(<EtsyEntry />);
    expect(await screen.findByLabelText("Redemption code")).toBeVisible();
  });

  it("fails closed when mode cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    render(<EtsyEntry />);
    expect(
      await screen.findByText(/temporarily unavailable/i),
    ).toBeVisible();
  });
});
