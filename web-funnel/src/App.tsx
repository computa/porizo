import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApiClient, ApiError } from "./api/client";
import {
  approveAndRenderPreview,
  buildCheckoutRequest,
  createEditableVersion,
  createSongDraft,
  isOrderStatus,
  isTerminalOrderStatus,
  normalizeLyrics,
  pollPreviewUntilReady,
  type OrderStatus,
  type Product,
} from "./api/funnel";
import { PencilIcon } from "./components/Icons";
import { DimBrand, SiteFooter, SiteNav } from "./components/SiteChrome";
import { LyricSheet } from "./steps/LyricSheet";
import { Offer } from "./steps/Offer";
import { Preview } from "./steps/Preview";
import { QuizFlow } from "./steps/QuizFlow";
import { Success } from "./steps/Success";
import { Theater } from "./steps/Theater";
import {
  QUIZ_STEPS,
  funnelReducer,
  serializeState,
  titleCaseForDisplay,
  type FunnelState,
  type QuizStep,
} from "./state/funnel";
import { resolveInitialState, resolveResumeCandidate } from "./state/initial-state";
import { stageForJob } from "./job-stage";
import { cssDurationMs } from "./motion";
import { acquireTurnstileToken } from "./turnstile";
import { sessionStartErrorCopy } from "./session-errors";

const STORAGE_KEY = "porizo.web-funnel.v1";
const TOKEN_KEY = "porizo.web-funnel.token";
const REFRESH_TOKEN_KEY = "porizo.web-funnel.refresh-token";
const RUNTIME_PARAMS = new URLSearchParams(location.search);
const DEMO_PARAMS = import.meta.env.DEV
  ? RUNTIME_PARAMS
  : new URLSearchParams();

function readCookie(name: string) {
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function initialDemoProduct(): Product | undefined {
  const price = DEMO_PARAMS.get("price");
  return price ? { price_key: "demo", localized_price: price } : undefined;
}

function initialDemoOrder(): OrderStatus | undefined {
  const status = DEMO_PARAMS.get("status");
  if (!isOrderStatus(status)) return undefined;
  return {
    status,
    recipient_name: DEMO_PARAMS.get("recipient") ?? "Sarah",
    share_url: DEMO_PARAMS.get("share_url") ?? undefined,
  };
}

function initialState(): FunnelState {
  const params = new URLSearchParams(location.search);
  if (!import.meta.env.DEV) params.delete("screen");
  const search = params.size ? `?${params.toString()}` : "";
  return resolveInitialState(
    localStorage.getItem(STORAGE_KEY),
    search,
    location.pathname,
    location.hash,
  );
}

export default function App() {
  const [state, dispatch] = useReducer(funnelReducer, undefined, initialState);
  const [resumeCandidate, setResumeCandidate] = useState(() =>
    resolveResumeCandidate(
      localStorage.getItem(STORAGE_KEY),
      location.search,
      location.pathname,
      location.hash,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [capacity, setCapacity] = useState(false);
  const [theaterFailed, setTheaterFailed] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [product, setProduct] = useState<Product | undefined>(initialDemoProduct);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [order, setOrder] = useState<OrderStatus | undefined>(initialDemoOrder);
  const orderStatus = order?.status;
  const [orderStartedAt] = useState(() => Date.now());
  const [orderElapsed, setOrderElapsed] = useState(0);
  const pollRun = useRef(0);
  const attachedJob = useRef<string | undefined>(undefined);

  const client = useMemo(
    () =>
      createApiClient({
        getToken: () => localStorage.getItem(TOKEN_KEY),
        refreshSession: async () => {
          localStorage.removeItem(TOKEN_KEY);
          return refreshExistingSession();
        },
      }),
    [],
  );

  useEffect(() => {
    if (resumeCandidate) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, serializeState(state));
    if (location.hash !== `#${state.activeStep}`) {
      history.replaceState({ step: state.activeStep }, "", `#${state.activeStep}`);
    }
  }, [resumeCandidate, state]);

  useEffect(() => {
    const onBack = () => {
      const step = location.hash.slice(1) as QuizStep;
      if (QUIZ_STEPS.includes(step)) dispatch({ type: "edit", step });
    };
    addEventListener("popstate", onBack);
    return () => removeEventListener("popstate", onBack);
  }, []);

  useEffect(() => {
    if (state.activeStep !== "offer") return;
    if (DEMO_PARAMS.has("price")) return;
    let live = true;
    client
      .get<{ products: Product[]; preview_only?: boolean } | Product[]>("/web/products")
      .then((response) => {
        if (!live) return;
        const products = Array.isArray(response) ? response : response.products;
        setPreviewOnly(!Array.isArray(response) && Boolean(response.preview_only));
        setProduct(products[0]);
      })
      .catch(() => setError("We couldn't load the price. Check your connection and try again."));
    return () => { live = false; };
  }, [client, state.activeStep]);

  useEffect(() => {
    if (state.activeStep !== "success") return;
    if (DEMO_PARAMS.has("status")) return;
    const sessionId = RUNTIME_PARAMS.get("session_id");
    if (!sessionId) return;
    if (isTerminalOrderStatus(orderStatus)) return;
    let live = true;
    let pollTimer: number | undefined;
    const update = async () => {
      try {
        const next = await client.get<OrderStatus>(`/web/orders/${encodeURIComponent(sessionId)}`);
        if (live) setOrder(next);
      } catch {
        if (live) setError("We couldn't refresh the order yet. We'll keep trying.");
      } finally {
        if (live) pollTimer = window.setTimeout(update, cssDurationMs("--t-order-poll"));
      }
    };
    void update();
    const elapsed = window.setInterval(
      () => setOrderElapsed(Date.now() - orderStartedAt),
      cssDurationMs("--t-order-elapsed"),
    );
    return () => {
      live = false;
      clearTimeout(pollTimer);
      clearInterval(elapsed);
    };
  }, [client, orderStatus, orderStartedAt, state.activeStep]);

  const recipient = titleCaseForDisplay(state.answers.recipient || "Sarah");
  const isDim = state.activeStep === "preview";
  const showEntryFooter = state.activeStep === "recipient" && state.furthestStep === "recipient";

  async function createGuestSession() {
    const bridged = await exchangeWebSession();
    if (bridged) return bridged;
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const turnstileToken = await acquireTurnstileToken();
    const response = await fetch("/web/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        turnstile_token: turnstileToken,
        entry_url: location.href,
      }),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        message?: string;
      };
      throw new ApiError(
        failure.message ?? "Session could not be started",
        response.status,
        failure.error ?? failure.code,
      );
    }
    const body = (await response.json()) as {
      access_token?: string;
      token?: string;
      refresh_token?: string;
    };
    const token = body.access_token ?? body.token;
    if (!token) throw new Error("Guest session response did not include a token.");
    localStorage.setItem(TOKEN_KEY, token);
    if (body.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, body.refresh_token);
    return token;
  }

  async function exchangeWebSession() {
    const csrf = readCookie("__Host-porizo_web_csrf");
    if (!csrf) return null;
    const response = await fetch("/auth/web/token", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrf,
      },
    });
    if (response.status === 401) return null;
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      throw new ApiError(
        failure.message ?? "Signed-in session could not be restored",
        response.status,
        failure.error,
      );
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error("Signed-in session response did not include a token.");
    }
    localStorage.setItem(TOKEN_KEY, body.access_token);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return body.access_token;
  }

  async function refreshExistingSession() {
    const bridged = await exchangeWebSession();
    if (bridged) return bridged;
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    const response = await fetch("/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return null;
    }
    const body = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!body.access_token || !body.refresh_token) return null;
    localStorage.setItem(TOKEN_KEY, body.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, body.refresh_token);
    return body.access_token;
  }

  async function startSession() {
    setBusy(true);
    setError(undefined);
    try {
      await createGuestSession();
      return true;
    } catch (caught) {
      setError(sessionStartErrorCopy(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function writeSong() {
    setBusy(true);
    setError(undefined);
    setCapacity(false);
    dispatch({ type: "advance", to: "theater" });
    try {
      await createGuestSession();
      const result = await createSongDraft(client, state);
      dispatch({
        type: "artifact",
        value: {
          trackId: result.trackId,
          versionId: result.versionId,
          versionNum: result.versionNum,
          lyrics: result.lyrics,
        },
      });
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(result.lyrics.length, 4) * cssDurationMs("--t-lyric-stagger")),
        );
      }
      dispatch({ type: "advance", to: "lyrics" });
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.code === "MODERATION_BLOCKED" || apiError.code === "GENERATION_BLOCKED") {
        setError("We couldn't use part of that — try saying it a different way.");
        dispatch({ type: "edit", step: "memory", returnTo: "sound" });
      } else if (apiError.status === 429 || apiError.code === "FUNNEL_PAUSED") {
        setCapacity(true);
        dispatch({ type: "edit", step: "sound" });
      } else {
        setError("We couldn't start the song. Check your connection and try again.");
        dispatch({ type: "edit", step: "sound" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function approveLyrics() {
    const { trackId, versionNum } = state.artifacts;
    if (!trackId || !versionNum) return;
    setBusy(true);
    setError(undefined);
    setTheaterFailed(false);
    setProgressStage(0);
    dispatch({ type: "advance", to: "theater" });
    try {
      const render = await approveAndRenderPreview(client, trackId, versionNum);
      attachedJob.current = render.job_id;
      dispatch({ type: "artifact", value: { jobId: render.job_id } });
      await pollPreview(render.job_id, versionNum);
    } catch {
      setTheaterFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function pollPreview(initialJobId: string, versionNum: number) {
    const run = ++pollRun.current;
    const trackId = state.artifacts.trackId;
    if (!trackId) return;
    const previewUrl = await pollPreviewUntilReady({
      client,
      trackId,
      versionNum,
      initialJobId,
      isActive: () => pollRun.current === run,
      wait: () => new Promise((resolve) => setTimeout(resolve, cssDurationMs("--t-poll"))),
      onJob: (job) => setProgressStage(stageForJob(job)),
      onRetry: (jobId) => {
        attachedJob.current = jobId;
        dispatch({ type: "artifact", value: { jobId } });
      },
    });
    if (!previewUrl) return;
    dispatch({
      type: "artifact",
      value: { previewUrl, previewGenerations: state.artifacts.previewGenerations + 1 },
    });
    dispatch({ type: "advance", to: "preview" });
  }

  useEffect(() => {
    const jobId = state.artifacts.jobId;
    if (state.activeStep === "theater" && jobId && attachedJob.current !== jobId) {
      attachedJob.current = jobId;
      void pollPreview(jobId, state.artifacts.versionNum ?? 1).catch(() => {
        setTheaterFailed(true);
      });
    }
    // Resume a persisted job exactly once when it becomes the active phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeStep, state.artifacts.jobId, state.artifacts.versionNum]);

  useEffect(() => {
    if (state.activeStep !== "theater") {
      pollRun.current += 1;
      attachedJob.current = undefined;
    }
  }, [state.activeStep]);

  async function saveLyrics(lines: string[]) {
    const trackId = state.artifacts.trackId;
    if (!trackId) return;
    setBusy(true);
    try {
      const version = await editableVersion();
      if (!version) return;
      await client.put(`/tracks/${trackId}/versions/${version.versionNum}/lyrics`, { lyrics: lines });
      dispatch({ type: "artifact", value: { lyrics: lines } });
    } finally {
      setBusy(false);
    }
  }

  async function regenerateLyrics() {
    const trackId = state.artifacts.trackId;
    if (!trackId || state.artifacts.previewGenerations >= 2) return;
    setBusy(true);
    try {
      const version = await editableVersion();
      if (!version) return;
      const response = await client.post<{ lyrics: unknown }>(
        `/tracks/${trackId}/versions/${version.versionNum}/lyrics/generate`,
        {},
      );
      dispatch({ type: "artifact", value: { lyrics: normalizeLyrics(response.lyrics) } });
    } finally {
      setBusy(false);
    }
  }

  async function editableVersion() {
    const { trackId, versionId, versionNum, previewUrl, previewGenerations } = state.artifacts;
    if (!trackId || !versionId || !versionNum) return null;
    if (!previewUrl) return { versionId, versionNum };
    const next = await createEditableVersion(client, {
      trackId,
      versionId,
      versionNum,
      hasPreview: Boolean(previewUrl),
      previewGenerations,
      style: `${state.answers.genre}, ${state.answers.mood.toLowerCase()}`,
      voiceGender: state.answers.voice.toLowerCase().startsWith("female") ? "female" : "male",
    });
    if (!next.created) return next;
    dispatch({
      type: "artifact",
      value: {
        versionId: next.versionId,
        versionNum: next.versionNum,
        previewUrl: undefined,
        jobId: undefined,
      },
    });
    return next;
  }

  async function checkout() {
    if (!product || !state.artifacts.trackId || !state.artifacts.versionId) return;
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      cssDurationMs("--t-checkout-timeout"),
    );
    try {
      const result = await client.post<{ checkout_url: string }>(
        "/web/checkout",
        buildCheckoutRequest(
          state.artifacts.trackId,
          state.artifacts.versionId,
          product.price_key,
        ),
        {
          signal: controller.signal,
          headers: {
            "Idempotency-Key": `web-checkout:${state.artifacts.trackId}:${state.artifacts.versionId}`,
          },
        },
      );
      location.assign(result.checkout_url);
    } catch {
      setBusy(false);
      setError("Secure checkout didn't open. Please try again.");
    } finally {
      clearTimeout(timeout);
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    pollRun.current += 1;
    setResumeCandidate(null);
    setOrder(undefined);
    setOrderElapsed(0);
    setError(undefined);
    history.replaceState({ step: "recipient" }, "", "/create#recipient");
    dispatch({ type: "restart" });
  }

  function confirmReset(name: string) {
    if (window.confirm(`Your song for ${name} will be lost.`)) reset();
  }

  function confirmDiscardResume() {
    confirmReset(titleCaseForDisplay(resumeCandidate?.answers.recipient ?? recipient));
  }

  function resumeSavedSong() {
    if (!resumeCandidate) return;
    dispatch({ type: "restore", state: resumeCandidate });
    setResumeCandidate(null);
  }

  return (
    <div className={isDim ? "dim app-root" : "app-root"}>
      {!isDim && (
        <>
          <SiteNav />
          <div className={showEntryFooter ? "shell shell-entry" : "shell"}>
            {QUIZ_STEPS.includes(state.activeStep as QuizStep) && !capacity && (
              <QuizFlow
                state={state}
                dispatch={dispatch}
                onStartSession={startSession}
                onWriteSong={writeSong}
                busy={busy}
                error={error}
                resumeRecipient={resumeCandidate?.answers.recipient}
                onResume={resumeSavedSong}
                onDiscardResume={confirmDiscardResume}
                onBeginNew={() => setResumeCandidate(null)}
              />
            )}
            {capacity && (
              <section className="card hold-card" role="status">
                <h2>We're at capacity.</h2>
                <p>Leave your email and we'll hold your place.</p>
                <label htmlFor="capacity-email">Email</label>
                <input className="field" id="capacity-email" type="email" autoComplete="email" />
                <button className="btn-quiet" type="button">Hold my place</button>
              </section>
            )}
            {state.activeStep === "theater" && (
              <>
                <QuizSummary state={state} onEdit={(step) => dispatch({ type: "edit", step })} />
                <Theater
                  key={state.artifacts.jobId ?? "draft"}
                  recipient={recipient}
                  lyrics={state.artifacts.lyrics ?? []}
                  progressStage={progressStage}
                  failed={theaterFailed}
                  onRetry={() => void approveLyrics()}
                />
              </>
            )}
            {state.activeStep === "lyrics" && (
              <LyricSheet
                recipient={recipient}
                lines={state.artifacts.lyrics ?? []}
                generations={state.artifacts.previewGenerations}
                busy={busy}
                onApprove={() => void approveLyrics()}
                onSaveEdit={saveLyrics}
                onRegenerate={regenerateLyrics}
              />
            )}
            {state.activeStep === "offer" && (
              <Offer
                recipient={recipient}
                product={product}
                loading={busy}
                error={error}
                cancelled={RUNTIME_PARAMS.get("cancelled") === "1"}
                previewOnly={previewOnly}
                onCheckout={() => void checkout()}
              />
            )}
            {state.activeStep === "success" && (
              <Success order={order} elapsedMs={orderElapsed} onStartAnother={reset} />
            )}
            {state.activeStep !== "recipient" && state.activeStep !== "success" && (
              <div className="flow-reset">
                <button className="btn-quiet" type="button" onClick={() => confirmReset(recipient)}>Start over</button>
              </div>
            )}
          </div>
          {showEntryFooter && <SiteFooter />}
        </>
      )}
      {state.activeStep === "preview" && (
        <>
          <DimBrand />
          <Preview
            recipient={recipient}
            lines={state.artifacts.lyrics ?? []}
            previewUrl={state.artifacts.previewUrl ?? ""}
            generations={state.artifacts.previewGenerations}
            onChangeLyrics={() => dispatch({ type: "advance", to: "lyrics" })}
            onUnlock={() => dispatch({ type: "advance", to: "offer" })}
          />
        </>
      )}
    </div>
  );
}

function QuizSummary({ state, onEdit }: { state: FunnelState; onEdit: (step: QuizStep) => void }) {
  return (
    <button className="quiz-summary" type="button" onClick={() => onEdit("sound")}>
      <span>{titleCaseForDisplay(state.answers.recipient)} · {state.answers.relationship} · {state.answers.occasion} · {state.answers.genre}, {state.answers.mood.toLowerCase()}, {state.answers.voice.toLowerCase()}</span>
      <PencilIcon />
    </button>
  );
}
