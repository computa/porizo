import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOrderRecovery,
  readOrderRecovery,
  rememberOrderRecovery,
} from "./order-recovery";

describe("paid-order recovery reference", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("survives the magic-link redirect without storing payment details", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    rememberOrderRecovery("cs_paid_phone");

    expect(readOrderRecovery(1_001)).toEqual({
      kind: "session",
      value: "cs_paid_phone",
    });
    expect(
      JSON.parse(
        localStorage.getItem("porizo.web-funnel.order-recovery.v1") ?? "{}",
      ),
    ).toEqual({ kind: "session", value: "cs_paid_phone", savedAt: 1_000 });
  });

  it("stores an exact order ID separately from a Stripe session", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    rememberOrderRecovery({ kind: "order", value: "worder_42" });

    expect(readOrderRecovery(2_001)).toEqual({
      kind: "order",
      value: "worder_42",
    });
  });

  it("expires after one day and can be explicitly cleared", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    rememberOrderRecovery("cs_paid_phone");

    expect(readOrderRecovery(1_000 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    rememberOrderRecovery("cs_second");
    clearOrderRecovery();
    expect(readOrderRecovery()).toBeNull();
  });

  it("keeps exact gift order recovery available for ninety days", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    rememberOrderRecovery({ kind: "order", value: "worder_gift" });

    expect(readOrderRecovery(1_000 + 30 * 24 * 60 * 60 * 1000)).toEqual({
      kind: "order",
      value: "worder_gift",
    });
    expect(
      readOrderRecovery(1_000 + 90 * 24 * 60 * 60 * 1000 + 1),
    ).toBeNull();
  });
});
