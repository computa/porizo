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

export type FunnelAction =
  | "write"
  | "approve"
  | "regenerate"
  | "checkout";

export interface ActionErrorCopy {
  message: string;
  destination?: "offer" | "lyrics" | "sound";
  capacity?: boolean;
  retryable?: boolean;
}

const ACTION_ERRORS: Record<string, ActionErrorCopy> = {
  INSUFFICIENT_CREDITS: {
    message: "Your free preview is used up. Unlock the gift bundle to finish this song.",
    destination: "offer",
  },
  WEB_PREVIEW_LIMIT_REACHED: {
    message: "You've used the free previews for this song. Unlock it to keep going.",
    destination: "offer",
  },
  WEB_LYRICS_LIMIT_REACHED: {
    message: "You've used the lyric changes for this song. Your latest version is still saved.",
    destination: "lyrics",
  },
  WEB_PREVIEW_IP_LIMIT_REACHED: {
    message: "Too many previews were started from this connection. Try again tomorrow.",
  },
  WEB_LYRICS_IP_LIMIT_REACHED: {
    message: "Too many lyric drafts were started from this connection. Try again tomorrow.",
  },
  FULL_RENDERS_DISABLED: {
    message: "Purchases are paused right now. Your song is saved.",
  },
  CHECKOUT_UNAVAILABLE: {
    message: "Secure checkout is temporarily unavailable. Your song is saved—please try again soon.",
    retryable: true,
  },
  TURNSTILE_INVALID: {
    message: "We couldn't verify this preview request. Please try again.",
    retryable: true,
  },
  TURNSTILE_UNAVAILABLE: {
    message: "The security check is temporarily unavailable. Please try again.",
    retryable: true,
  },
  FUNNEL_PAUSED: {
    message: "Song creation is at capacity right now. Your answers are saved.",
    capacity: true,
  },
  FUNNEL_GUARD_UNAVAILABLE: {
    message: "Song creation is temporarily unavailable. Your answers are saved.",
    capacity: true,
  },
};

export function actionErrorCopy(caught: unknown, action: FunnelAction): ActionErrorCopy {
  if (caught instanceof TurnstileError) {
    return {
      message: sessionStartErrorCopy(caught),
      retryable: caught.code !== "configuration",
    };
  }
  if (caught instanceof ApiError && caught.code && ACTION_ERRORS[caught.code]) {
    return ACTION_ERRORS[caught.code];
  }
  if (caught instanceof ApiError && caught.status === 429) {
    return {
      message: "That action has been tried too many times. Please wait and try again.",
    };
  }
  const fallbacks: Record<FunnelAction, string> = {
    write: "We couldn't start the song. Check your connection and try again.",
    approve: "We couldn't make the preview. Please try again.",
    regenerate: "We couldn't rewrite the lyrics. Your current version is still saved.",
    checkout: "Secure checkout didn't open. Your song is saved—please try again.",
  };
  return { message: fallbacks[action], retryable: true };
}
