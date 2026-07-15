import { TurnstileError } from "./turnstile";
import { ApiError } from "./api/client";

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
  if (caught instanceof ApiError) {
    if (caught.code === "TURNSTILE_INVALID") {
      return "We couldn't verify this request. Please try again.";
    }
    if (caught.code === "TURNSTILE_UNAVAILABLE") {
      return "The security check is temporarily unavailable. Please try again.";
    }
    if (caught.code === "WEB_SESSION_LIMIT_REACHED") {
      return "Too many song sessions were started from this connection. Please try again later.";
    }
    if (caught.code?.startsWith("FUNNEL_")) {
      return "Song creation is temporarily unavailable. Please try again later.";
    }
    if (caught.status >= 500) {
      return "We couldn't start your song right now. Please try again.";
    }
  }
  return "We couldn't save your place. Check your connection and try again.";
}
