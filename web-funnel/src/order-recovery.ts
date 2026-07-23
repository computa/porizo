const RECOVERY_KEY = "porizo.web-funnel.order-recovery.v1";
const SESSION_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Gift order IDs are safe opaque references and remain useful after delivery:
// buyers return to this exact management page from email and other devices.
const ORDER_RECOVERY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface OrderRecoveryReference {
  kind: "session" | "order" | "etsy_unit";
  value: string;
}

interface StoredOrderRecovery extends OrderRecoveryReference {
  savedAt: number;
}

export function rememberOrderRecovery(
  reference: string | OrderRecoveryReference,
) {
  const normalized =
    typeof reference === "string"
      ? { kind: "session" as const, value: reference }
      : reference;
  const value: StoredOrderRecovery = {
    ...normalized,
    savedAt: Date.now(),
  };
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}

export function readOrderRecovery(now = Date.now()) {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredOrderRecovery> & {
      sessionId?: string;
    };
    const kind = value.kind ?? (value.sessionId ? "session" : undefined);
    const reference = value.value ?? value.sessionId;
    if (
      (kind !== "session" && kind !== "order" && kind !== "etsy_unit") ||
      typeof reference !== "string" ||
      !reference ||
      typeof value.savedAt !== "number" ||
      now - value.savedAt >
        (kind === "order" || kind === "etsy_unit"
          ? ORDER_RECOVERY_MAX_AGE_MS
          : SESSION_RECOVERY_MAX_AGE_MS)
    ) {
      clearOrderRecovery();
      return null;
    }
    return { kind, value: reference } satisfies OrderRecoveryReference;
  } catch {
    clearOrderRecovery();
    return null;
  }
}

export function clearOrderRecovery() {
  localStorage.removeItem(RECOVERY_KEY);
}
