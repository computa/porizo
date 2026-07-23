// An Etsy buyer redeems on the clean /etsy page, then hands off to /create via a
// full-page navigation. That nav loses in-memory state, so the "this session is
// already-paid Etsy fulfilment" signal has to survive it. sessionStorage is the
// right store: it persists across a same-tab full-page navigation yet is scoped
// to the tab and cleared when it closes — so the stripped, commerce-free chrome
// never leaks into an unrelated fresh visit in a different tab.
const FULFILMENT_KEY = "porizo.etsy-fulfilment";

export function markEtsyFulfilment() {
  sessionStorage.setItem(FULFILMENT_KEY, "1");
}

export function isEtsyFulfilment() {
  return sessionStorage.getItem(FULFILMENT_KEY) === "1";
}

// Sets the fulfilment flag, then triggers the /create hand-off — in that order,
// so /create reads the flag on mount after the navigation.
export function beginEtsyFulfilmentHandoff(navigate: (path: string) => void) {
  markEtsyFulfilment();
  navigate("/create");
}
