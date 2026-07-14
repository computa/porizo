const SCRIPT_ID = "porizo-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

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

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => window.turnstile ? resolve() : reject(new Error("Turnstile did not load."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile could not load.")), {
      once: true,
    });
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
  if (!sitekey) throw new Error("VITE_TURNSTILE_SITE_KEY is not configured.");
  await loadTurnstile();

  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    document.body.append(container);
    let widgetId = "";
    const finish = (result: { token?: string; error?: Error }) => {
      if (widgetId) window.turnstile?.remove(widgetId);
      container.remove();
      if (result.token) resolve(result.token);
      else reject(result.error ?? new Error("Turnstile verification failed."));
    };
    widgetId = window.turnstile!.render(container, {
      sitekey,
      execution: "execute",
      callback: (token: string) => finish({ token }),
      "error-callback": () => finish({ error: new Error("Turnstile verification failed.") }),
      "expired-callback": () => finish({ error: new Error("Turnstile verification expired.") }),
      "timeout-callback": () => finish({ error: new Error("Turnstile verification timed out.") }),
    });
    window.turnstile!.execute(widgetId);
  });
}
