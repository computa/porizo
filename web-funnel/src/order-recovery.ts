const RECOVERY_KEY = "porizo.web-funnel.order-recovery.v1";
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredOrderRecovery {
  sessionId: string;
  savedAt: number;
}

export function rememberOrderRecovery(sessionId: string) {
  const value: StoredOrderRecovery = {
    sessionId,
    savedAt: Date.now(),
  };
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}

export function readOrderRecovery(now = Date.now()) {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredOrderRecovery>;
    if (
      typeof value.sessionId !== "string" ||
      !value.sessionId ||
      typeof value.savedAt !== "number" ||
      now - value.savedAt > RECOVERY_MAX_AGE_MS
    ) {
      clearOrderRecovery();
      return null;
    }
    return value.sessionId;
  } catch {
    clearOrderRecovery();
    return null;
  }
}

export function clearOrderRecovery() {
  localStorage.removeItem(RECOVERY_KEY);
}
