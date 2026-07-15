import { TurnstileError } from "./turnstile";

export function sessionStartErrorCopy(caught: unknown) {
  if (caught instanceof TurnstileError) {
    if (caught.code === "configuration") {
      return "This page isn't configured to start a song. Please try again later.";
    }
    if (caught.code === "network") {
      return "We couldn't connect to the security check. Check your connection and try again.";
    }
    return "We couldn't verify this request. Please try again.";
  }
  return "We couldn't save your place. Check your connection and try again.";
}
