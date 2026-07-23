// An Etsy buyer redeems on the clean /etsy page, then hands off to /create via a
// full-page navigation. That nav loses in-memory state, so the "this session is
// already-paid Etsy fulfilment" signal has to survive it. sessionStorage is the
// right store: it persists across a same-tab full-page navigation yet is scoped
// to the tab and cleared when it closes — so the stripped, commerce-free chrome
// never leaks into an unrelated fresh visit in a different tab.
const FULFILMENT_KEY = "porizo.etsy-fulfilment";
const PENDING_RECEIPT_KEY = "porizo.etsy-pending-receipt";
const ORDER_RECOVERY_KEY = "porizo.web-funnel.order-recovery.v1";
const FUNNEL_STATE_KEY = "porizo.web-funnel.v1";

export function markEtsyFulfilment() {
  const flowId = crypto.randomUUID();
  sessionStorage.setItem(FULFILMENT_KEY, flowId);
  return flowId;
}

export function isEtsyFulfilment() {
  return Boolean(sessionStorage.getItem(FULFILMENT_KEY));
}

export function rememberPendingEtsyReceipt(receiptId: string) {
  localStorage.setItem(PENDING_RECEIPT_KEY, receiptId);
}

export function readPendingEtsyReceipt() {
  return localStorage.getItem(PENDING_RECEIPT_KEY) ?? "";
}

export function clearPendingEtsyReceipt() {
  localStorage.removeItem(PENDING_RECEIPT_KEY);
}

// Sets the fulfilment flag, then triggers the /create hand-off — in that order,
// so /create reads the flag on mount after the navigation.
export function beginEtsyFulfilmentHandoff(navigate: (path: string) => void) {
  markEtsyFulfilment();
  localStorage.removeItem(ORDER_RECOVERY_KEY);
  localStorage.removeItem(FUNNEL_STATE_KEY);
  navigate("/create");
}
