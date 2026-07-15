const SCRIPT_ID = "porizo-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_TIMEOUT_MS = 10000;

interface TurnstileApi {
  execute(widgetId: string): void;
  remove(widgetId: string): void;
  render(container: HTMLElement, options: Record<string, unknown>): string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    turnstileToken?: string;
  }
}

let scriptPromise: Promise<void> | undefined;

export type TurnstileErrorCode = "configuration" | "network" | "verification";

export class TurnstileError extends Error {
  readonly code: TurnstileErrorCode;

  constructor(code: TurnstileErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TurnstileError";
    this.code = code;
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause });
  }
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const cleanupListeners = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = (message: string) => {
      cleanupListeners();
      script.remove();
      reject(new TurnstileError("network", message));
    };
    const onLoad = () => {
      cleanupListeners();
      if (window.turnstile) resolve();
      else fail("Turnstile loaded without exposing its verification API.");
    };
    const onError = () => fail("Turnstile could not load.");
    const timeout = window.setTimeout(
      () => fail("Turnstile took too long to load."),
      TURNSTILE_TIMEOUT_MS,
    );
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  scriptPromise = pending;
  return pending;
}

export async function acquireTurnstileToken(): Promise<string> {
  if (window.turnstileToken) {
    const token = window.turnstileToken;
    window.turnstileToken = undefined;
    return token;
  }

  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (!sitekey) {
    throw new TurnstileError("configuration", "VITE_TURNSTILE_SITE_KEY is not configured.");
  }
  await loadTurnstile();

  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.dataset.turnstileContainer = "true";
    document.body.append(container);
    let widgetId = "";
    let settled = false;
    const finish = (result: { token?: string; error?: TurnstileError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (widgetId) window.turnstile?.remove(widgetId);
      container.remove();
      if (result.token) resolve(result.token);
      else {
        reject(
          result.error ?? new TurnstileError("verification", "Turnstile verification failed."),
        );
      }
    };
    const timeout = window.setTimeout(
      () => finish({
        error: new TurnstileError("verification", "Turnstile verification timed out."),
      }),
      TURNSTILE_TIMEOUT_MS,
    );
    try {
      widgetId = window.turnstile!.render(container, {
        sitekey,
        action: "web_session",
        execution: "execute",
        callback: (token: string) => finish({ token }),
        "error-callback": () =>
          finish({ error: new TurnstileError("verification", "Turnstile verification failed.") }),
        "expired-callback": () =>
          finish({ error: new TurnstileError("verification", "Turnstile verification expired.") }),
        "timeout-callback": () =>
          finish({ error: new TurnstileError("verification", "Turnstile verification timed out.") }),
      });
      if (settled) window.turnstile?.remove(widgetId);
      else window.turnstile!.execute(widgetId);
    } catch (error) {
      finish({
        error: new TurnstileError("verification", "Turnstile verification could not start.", error),
      });
    }
  });
}

export function resetTurnstileForTests(): void {
  scriptPromise = undefined;
  document.getElementById(SCRIPT_ID)?.remove();
  document.querySelectorAll("[data-turnstile-container]").forEach((element) => element.remove());
}
