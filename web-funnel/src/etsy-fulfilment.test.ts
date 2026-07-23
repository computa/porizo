import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginEtsyFulfilmentHandoff,
  isEtsyFulfilment,
  markEtsyFulfilment,
} from "./etsy-fulfilment";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("etsy fulfilment session flag", () => {
  it("is off by default", () => {
    expect(isEtsyFulfilment()).toBe(false);
  });

  it("persists a fulfilment session after it is marked", () => {
    markEtsyFulfilment();

    expect(isEtsyFulfilment()).toBe(true);
  });
});

describe("beginEtsyFulfilmentHandoff", () => {
  it("marks the fulfilment session before navigating to /create", () => {
    localStorage.setItem(
      "porizo.web-funnel.order-recovery.v1",
      JSON.stringify({ kind: "order", value: "stale" }),
    );
    localStorage.setItem("porizo.web-funnel.v1", "stale-song");
    const navigate = vi.fn(() => {
      // The flag must already be set by the time the full-page nav fires,
      // because /create reads it once on mount after the hand-off.
      expect(isEtsyFulfilment()).toBe(true);
    });

    beginEtsyFulfilmentHandoff(navigate);

    expect(navigate).toHaveBeenCalledWith("/create");
    expect(
      localStorage.getItem("porizo.web-funnel.order-recovery.v1"),
    ).toBeNull();
    expect(localStorage.getItem("porizo.web-funnel.v1")).toBeNull();
  });
});
