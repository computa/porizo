import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createApiClient, ApiError } from "./api/client";
import {
  approveAndRenderPreview,
  buildCheckoutRequest,
  buildWalletOrderRequest,
  createEditableVersion,
  createSongDraft,
  isOrderStatus,
  isOrderPollingComplete,
  normalizeLyrics,
  pollPreviewUntilReady,
  type OrderStatus,
  type Product,
} from "./api/funnel";
import { PencilIcon } from "./components/Icons";
import { DimBrand, SiteFooter, SiteNav } from "./components/SiteChrome";
import { isEtsyFulfilment } from "./etsy-fulfilment";
import { LyricSheet } from "./steps/LyricSheet";
import { Offer } from "./steps/Offer";
import { Preview } from "./steps/Preview";
import { QuizFlow } from "./steps/QuizFlow";
import { Success } from "./steps/Success";
import { Theater } from "./steps/Theater";
import {
  QUIZ_STEPS,
  isFlowStep,
  parseStoredState,
  funnelReducer,
  serializeState,
  titleCaseForDisplay,
  type FunnelState,
  type QuizStep,
} from "./state/funnel";
import {
  resolveInitialState,
  resolveResumeCandidate,
} from "./state/initial-state";
import { stageForJob } from "./job-stage";
import { cssDurationMs } from "./motion";
import { acquireTurnstileToken } from "./turnstile";
import { actionErrorCopy, sessionStartErrorCopy } from "./session-errors";
import { clearOrderRecovery, readOrderRecovery } from "./order-recovery";
import { rememberOrderRecovery } from "./order-recovery";
import type { deliveryRequest, DeliveryChannelName } from "./delivery-state";
import {
  TOKEN_KEY,
  createGuestSession,
  refreshExistingSession,
} from "./session-bootstrap";

const STORAGE_KEY = "porizo.web-funnel.v1";
const RUNTIME_PARAMS = new URLSearchParams(location.search);
const DEMO_PARAMS = import.meta.env.DEV
  ? RUNTIME_PARAMS
  : new URLSearchParams();

function initialDemoProduct(): Product | undefined {
  const price = DEMO_PARAMS.get("price");
  return price
    ? { price_key: "demo", localized_price: price, token_count: 1 }
    : undefined;
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
  const path =
    !RUNTIME_PARAMS.get("session_id") && readOrderRecovery()
      ? "/create/success"
      : location.pathname;
  return resolveInitialState(
    localStorage.getItem(STORAGE_KEY),
    search,
    path,
    location.hash,
  );
}

export default function App() {
  const etsyFlow = isEtsyFulfilment();
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
  const [product, setProduct] = useState<Product | undefined>(
    initialDemoProduct,
  );
  const [products, setProducts] = useState<Product[]>(() => {
    const demo = initialDemoProduct();
    return demo ? [demo] : [];
  });
  const [walletBalance, setWalletBalance] = useState<number>();
  const [previewOnly, setPreviewOnly] = useState(false);
  const [automatedDeliveryEnabled, setAutomatedDeliveryEnabled] =
    useState(false);
  const [order, setOrder] = useState<OrderStatus | undefined>(initialDemoOrder);
  const orderContentStatus = order?.content_status ?? order?.status;
  const orderDeliveryStatus = order?.delivery_status;
  const orderPollingComplete = isOrderPollingComplete(order);
  const recovery = readOrderRecovery();
  const checkoutSessionId =
    RUNTIME_PARAMS.get("session_id") ??
    (recovery?.kind === "session" ? recovery.value : null);
  const checkoutOrderId =
    RUNTIME_PARAMS.get("order_id") ??
    (recovery?.kind === "order" ? recovery.value : null);
  const etsyUnitId =
    RUNTIME_PARAMS.get("etsy_unit_id") ??
    (recovery?.kind === "etsy_unit" ? recovery.value : null);
  const orderStatusUrl = etsyUnitId
    ? `/web/etsy/order/unit/${encodeURIComponent(etsyUnitId)}`
    : checkoutOrderId
      ? `/web/orders/by-id/${encodeURIComponent(checkoutOrderId)}`
      : checkoutSessionId
        ? `/web/orders/${encodeURIComponent(checkoutSessionId)}`
        : "/web/orders/latest";
  const [orderStartedAt] = useState(() => Date.now());
  const [orderElapsed, setOrderElapsed] = useState(0);
  const [orderNeedsSignIn, setOrderNeedsSignIn] = useState(false);
  const [orderTimedOut, setOrderTimedOut] = useState(false);
  const [orderPollRun, setOrderPollRun] = useState(0);
  const pollRun = useRef(0);
  const attachedJob = useRef<string | undefined>(undefined);

  // refreshExistingSession intentionally reads current browser storage/cookies;
  // the client itself must stay stable so polling effects do not restart.
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

  const refreshOrderStatus = useCallback(async () => {
    if (state.activeStep !== "success" || DEMO_PARAMS.has("status")) return;
    try {
      const next = await client.get<OrderStatus>(orderStatusUrl);
      setOrder(next);
      setOrderNeedsSignIn(false);
      setOrderTimedOut(false);
      setError(undefined);
      if (next.order_id) {
        rememberOrderRecovery({ kind: "order", value: next.order_id });
      } else if (
        isOrderPollingComplete(next) &&
        !checkoutOrderId &&
        !etsyUnitId
      ) {
        clearOrderRecovery();
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setOrderNeedsSignIn(true);
        return;
      }
      setError("We couldn't refresh the order yet. Try again shortly.");
    }
  }, [checkoutOrderId, client, etsyUnitId, orderStatusUrl, state.activeStep]);

  useEffect(() => {
    const linkedUnitId = RUNTIME_PARAMS.get("etsy_unit_id");
    if (linkedUnitId) {
      rememberOrderRecovery({ kind: "etsy_unit", value: linkedUnitId });
    }
  }, []);

  useEffect(() => {
    if (resumeCandidate) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, serializeState(state));
    if (location.hash !== `#${state.activeStep}`) {
      history.replaceState(
        { step: state.activeStep },
        "",
        `#${state.activeStep}`,
      );
    }
  }, [resumeCandidate, state]);

  useEffect(() => {
    const onBack = () => {
      const step = location.hash.slice(1);
      if (!isFlowStep(step)) return;
      if (QUIZ_STEPS.includes(step as QuizStep)) {
        dispatch({ type: "edit", step: step as QuizStep });
      } else {
        dispatch({ type: "advance", to: step });
      }
    };
    addEventListener("popstate", onBack);
    return () => removeEventListener("popstate", onBack);
  }, []);

  useEffect(() => {
    if (etsyFlow) return;
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      const next = parseStoredState(event.newValue);
      if (next && next.savedAt > state.savedAt) {
        dispatch({ type: "restore", state: next });
      }
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, [etsyFlow, state.savedAt]);

  useEffect(() => {
    if (state.activeStep !== "offer" && state.activeStep !== "success") return;
    if (DEMO_PARAMS.has("price")) return;
    let live = true;
    client
      .get<
        | {
            products: Product[];
            preview_only?: boolean;
            wallet_balance?: number;
            automated_delivery_enabled?: boolean;
          }
        | Product[]
      >("/web/products")
      .then((response) => {
        if (!live) return;
        const products = Array.isArray(response) ? response : response.products;
        setProducts(products);
        if (!Array.isArray(response)) setWalletBalance(response.wallet_balance);
        if (!Array.isArray(response)) {
          setAutomatedDeliveryEnabled(
            Boolean(response.automated_delivery_enabled),
          );
        }
        setPreviewOnly(
          !Array.isArray(response) && Boolean(response.preview_only),
        );
        setProduct((selected) => {
          if (
            selected &&
            products.some(
              (candidate) => candidate.price_key === selected.price_key,
            )
          ) {
            return products.find(
              (candidate) => candidate.price_key === selected.price_key,
            );
          }
          return products.length === 1 ? products[0] : undefined;
        });
      })
      .catch(() => {
        if (state.activeStep === "offer") {
          setError(
            "We couldn't load the price. Check your connection and try again.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, [client, state.activeStep]);

  useEffect(() => {
    if (state.activeStep !== "success" || DEMO_PARAMS.has("status")) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshOrderStatus();
    };
    addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOrderStatus, state.activeStep]);

  useEffect(() => {
    const orderId = RUNTIME_PARAMS.get("order_id");
    if (
      RUNTIME_PARAMS.get("cancelled") !== "1" ||
      !orderId ||
      state.artifacts.trackId
    ) {
      return;
    }
    let live = true;
    void createGuestSession()
      .then(() =>
        client.get<{
          track_id: string;
          track_version_id: string;
          version_num: number;
          recipient_name?: string;
        }>(`/web/order-drafts/${encodeURIComponent(orderId)}`),
      )
      .then((draft) => {
        if (!live) return;
        if (draft.recipient_name) {
          dispatch({
            type: "answer",
            step: "recipient",
            value: draft.recipient_name,
          });
        }
        dispatch({
          type: "artifact",
          value: {
            trackId: draft.track_id,
            versionId: draft.track_version_id,
            versionNum: draft.version_num,
          },
        });
        dispatch({ type: "advance", to: "offer" });
      })
      .catch((caught) => {
        if (live) setError(actionErrorCopy(caught, "checkout").message);
      });
    return () => {
      live = false;
    };
    // This recovery runs only for the immutable checkout return URL.
  }, [client, state.artifacts.trackId]);

  useEffect(() => {
    if (state.activeStep !== "success") return;
    if (DEMO_PARAMS.has("status")) return;
    const sessionId = checkoutSessionId;
    // With a session_id we poll that exact order. Without one (a buyer who paid
    // on another device and signed in fresh here), fall back to the by-user
    // lookup — login re-owns their paid order, so /web/orders/latest finds it.
    // That endpoint 401s harmlessly until they sign in, driving the same
    // recovery UI as the session_id path.
    const orderUrl = orderStatusUrl;
    if (orderPollingComplete) return;
    let live = true;
    let pollTimer: number | undefined;
    let attempts = 0;
    const update = async () => {
      let shouldContinue = true;
      attempts += 1;
      try {
        const next = await client.get<OrderStatus>(orderUrl);
        if (live) {
          setOrder(next);
          setOrderNeedsSignIn(false);
          setOrderTimedOut(false);
          if (next.order_id) {
            rememberOrderRecovery({ kind: "order", value: next.order_id });
          } else if (isOrderPollingComplete(next) && !checkoutOrderId) {
            clearOrderRecovery();
          }
        }
      } catch (caught) {
        if (live && caught instanceof ApiError && caught.status === 401) {
          setOrderNeedsSignIn(true);
          shouldContinue = false;
          return;
        }
        if (
          live &&
          !sessionId &&
          !checkoutOrderId &&
          caught instanceof ApiError &&
          caught.status === 404
        ) {
          // By-user lookup: authenticated but no order to recover — stop rather
          // than spin, and surface the recovery/support actions. (The session_id
          // path keeps retrying a 404: the row may not be visible yet right
          // after the Stripe redirect.)
          setOrderTimedOut(true);
          shouldContinue = false;
          return;
        }
        if (live)
          setError(
            "We couldn't refresh the order yet. We'll try again shortly.",
          );
      } finally {
        if (attempts >= 120) {
          shouldContinue = false;
          if (live) setOrderTimedOut(true);
        }
        if (live && shouldContinue) {
          const baseDelay = cssDurationMs("--t-order-poll");
          const delay = Math.min(
            baseDelay * 4,
            baseDelay * 2 ** Math.min(2, Math.floor(attempts / 10)),
          );
          pollTimer = window.setTimeout(update, delay);
        }
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
  }, [
    checkoutSessionId,
    checkoutOrderId,
    client,
    orderContentStatus,
    orderDeliveryStatus,
    orderPollingComplete,
    orderStartedAt,
    orderPollRun,
    orderStatusUrl,
    state.activeStep,
  ]);

  const recipient = titleCaseForDisplay(state.answers.recipient || "Sarah");
  // Success starts conservatively commerce-free until its server-owned
  // provenance resolves; this prevents a paid Etsy buyer seeing Stripe chrome
  // during cross-device recovery.
  const [contextCommerceFree, setCommerceFree] = useState(
    etsyFlow || state.activeStep === "success",
  );
  const [etsyJourneyId, setEtsyJourneyId] = useState<string>();
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    void client
      .get<{ commerce_free: boolean; journey_id?: string }>(
        "/web/etsy/order/context",
      )
      .then((context) => {
        if (context.commerce_free) setCommerceFree(true);
        setEtsyJourneyId(context.journey_id);
      })
      .catch(() => {
        // The local handoff marker keeps paid buyers commerce-free while a
        // temporary context lookup failure recovers.
      });
  }, [client]);
  const commerceFree = order?.commerce_free ?? contextCommerceFree;
  const isDim = state.activeStep === "preview";
  const showEntryFooter =
    state.activeStep === "recipient" && state.furthestStep === "recipient";

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
          setTimeout(
            resolve,
            Math.min(result.lyrics.length, 4) *
              cssDurationMs("--t-lyric-stagger"),
          ),
        );
      }
      dispatch({ type: "advance", to: "lyrics" });
    } catch (caught) {
      const apiError = caught as ApiError;
      if (
        apiError.code === "MODERATION_BLOCKED" ||
        apiError.code === "GENERATION_BLOCKED"
      ) {
        setError(
          "We couldn't use part of that — try saying it a different way.",
        );
        dispatch({ type: "edit", step: "memory", returnTo: "sound" });
      } else {
        const copy = actionErrorCopy(caught, "write");
        setError(copy.message);
        setCapacity(Boolean(copy.capacity));
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
      const render = await approveAndRenderPreview(
        client,
        trackId,
        versionNum,
        await acquireTurnstileToken(),
      );
      attachedJob.current = render.job_id;
      dispatch({ type: "artifact", value: { jobId: render.job_id } });
      await pollPreview(render.job_id, versionNum);
    } catch (caught) {
      const copy = actionErrorCopy(caught, "approve");
      setError(copy.message);
      if (copy.destination === "offer") {
        dispatch({ type: "advance", to: "offer" });
      } else if (copy.destination === "lyrics") {
        dispatch({ type: "advance", to: "lyrics" });
      } else {
        setTheaterFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pollPreview(initialJobId: string, versionNum: number) {
    const run = ++pollRun.current;
    const trackId = state.artifacts.trackId;
    if (!trackId) return;
    let serverPreviewGenerations = 0;
    const previewUrl = await pollPreviewUntilReady({
      client,
      trackId,
      versionNum,
      initialJobId,
      isActive: () => pollRun.current === run,
      wait: () =>
        new Promise((resolve) =>
          setTimeout(resolve, cssDurationMs("--t-poll")),
        ),
      onJob: (job) => setProgressStage(stageForJob(job)),
      onRetry: (jobId) => {
        attachedJob.current = jobId;
        dispatch({
          type: "artifact",
          value: { jobId, previewRetryUsed: true },
        });
      },
      onPreviewCount: (count) => {
        serverPreviewGenerations = count;
      },
      acquireRetryToken: acquireTurnstileToken,
      retryAvailable: !state.artifacts.previewRetryUsed,
    });
    if (!previewUrl) return;
    dispatch({
      type: "artifact",
      value: {
        previewUrl,
        previewGenerations: Math.max(
          state.artifacts.previewGenerations + 1,
          serverPreviewGenerations,
        ),
      },
    });
    dispatch({ type: "advance", to: "preview" });
  }

  useEffect(() => {
    const jobId = state.artifacts.jobId;
    if (
      state.activeStep === "theater" &&
      jobId &&
      attachedJob.current !== jobId
    ) {
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
      await client.put(
        `/tracks/${trackId}/versions/${version.versionNum}/lyrics`,
        { lyrics: lines },
      );
      dispatch({ type: "artifact", value: { lyrics: lines } });
    } finally {
      setBusy(false);
    }
  }

  async function regenerateLyrics() {
    const trackId = state.artifacts.trackId;
    if (!trackId || state.artifacts.previewGenerations >= 2) return;
    setBusy(true);
    setError(undefined);
    try {
      const version = await editableVersion();
      if (!version) return;
      const response = await client.post<{ lyrics: unknown }>(
        `/tracks/${trackId}/versions/${version.versionNum}/lyrics/generate`,
        {},
      );
      dispatch({
        type: "artifact",
        value: { lyrics: normalizeLyrics(response.lyrics) },
      });
    } catch (caught) {
      setError(actionErrorCopy(caught, "regenerate").message);
    } finally {
      setBusy(false);
    }
  }

  async function editableVersion() {
    const { trackId, versionId, versionNum, previewUrl, previewGenerations } =
      state.artifacts;
    if (!trackId || !versionId || !versionNum) return null;
    if (!previewUrl) return { versionId, versionNum };
    const next = await createEditableVersion(client, {
      trackId,
      versionId,
      versionNum,
      hasPreview: Boolean(previewUrl),
      previewGenerations,
      style: `${state.answers.genre}, ${state.answers.mood.toLowerCase()}`,
      voiceGender: state.answers.voice.toLowerCase().startsWith("female")
        ? "female"
        : "male",
    });
    if (!next.created) return next;
    dispatch({
      type: "artifact",
      value: {
        versionId: next.versionId,
        versionNum: next.versionNum,
        previewUrl: undefined,
        jobId: undefined,
        previewRetryUsed: false,
      },
    });
    return next;
  }

  async function checkout() {
    if (!product || !state.artifacts.trackId || !state.artifacts.versionId)
      return;
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
    } catch (caught) {
      setBusy(false);
      setError(actionErrorCopy(caught, "checkout").message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function startWalletOrder() {
    if (!state.artifacts.trackId || !state.artifacts.versionId) return;
    if (commerceFree && !etsyJourneyId) {
      setError(
        "We couldn't reconnect this Etsy order yet. Refresh the page before finishing the song.",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.post<{
        order_id: string;
        status_url?: string;
      }>(
        "/web/orders",
        buildWalletOrderRequest(
          state.artifacts.trackId,
          state.artifacts.versionId,
          commerceFree ? etsyJourneyId : undefined,
        ),
        {
          headers: {
            "Idempotency-Key": `web-wallet-order:${state.artifacts.trackId}:${state.artifacts.versionId}`,
          },
        },
      );
      rememberOrderRecovery({ kind: "order", value: result.order_id });
      history.replaceState(
        {},
        "",
        `/create/success?order_id=${encodeURIComponent(result.order_id)}`,
      );
      dispatch({ type: "advance", to: "success" });
      setOrder(undefined);
      setOrderPollRun((value) => value + 1);
    } catch (caught) {
      setError(actionErrorCopy(caught, "checkout").message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDelivery(body: ReturnType<typeof deliveryRequest>) {
    const reservationId = order?.gift_reservation_id;
    if (!reservationId) throw new Error("Delivery is not ready to configure.");
    setError(undefined);
    try {
      const response = await client.put<OrderStatus | { order?: OrderStatus }>(
        `/gifts/reservations/${encodeURIComponent(reservationId)}/delivery`,
        body,
      );
      if ("order" in response && response.order) setOrder(response.order);
      else if ("content_status" in response || "status" in response) {
        setOrder(response as OrderStatus);
      }
      setOrderPollRun((value) => value + 1);
    } catch (caught) {
      setError(actionErrorCopy(caught, "checkout").message);
      if (caught instanceof ApiError && caught.status === 409) {
        setOrderPollRun((value) => value + 1);
      }
      throw caught;
    }
  }

  async function stopDeliveryChannel(channel: DeliveryChannelName) {
    const giftId = order?.gift_id ?? order?.gift_order_id;
    if (!giftId) throw new Error("This delivery has not been finalized yet.");
    setError(undefined);
    try {
      await client.post(
        `/gifts/${encodeURIComponent(giftId)}/delivery/stop`,
        { channels: [channel] },
        {
          headers: {
            "Idempotency-Key": `web-delivery-stop:${giftId}:${channel}`,
          },
        },
      );
      setOrderPollRun((value) => value + 1);
    } catch (caught) {
      setError(actionErrorCopy(caught, "checkout").message);
      throw caught;
    }
  }

  async function cancelGift() {
    const giftId = order?.gift_id ?? order?.gift_order_id;
    if (!giftId) throw new Error("This gift has not been finalized yet.");
    setError(undefined);
    try {
      await client.post(
        `/gifts/${encodeURIComponent(giftId)}/cancel`,
        {},
        {
          headers: {
            "Idempotency-Key": `web-gift-cancel:${giftId}`,
          },
        },
      );
      setOrderPollRun((value) => value + 1);
    } catch (caught) {
      setError(actionErrorCopy(caught, "checkout").message);
      throw caught;
    }
  }

  async function downloadMp3() {
    const versionId = order?.track_version_id;
    if (!versionId) throw new Error("The MP3 is still being prepared.");
    const path = `/full/${encodeURIComponent(versionId)}.mp3`;
    const requestDownload = (token: string | null) =>
      fetch(path, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    let response = await requestDownload(localStorage.getItem(TOKEN_KEY));
    if (response.status === 401) {
      const refreshed = await refreshExistingSession();
      if (refreshed) response = await requestDownload(refreshed);
    }
    if (!response.ok) {
      setError(
        response.status === 404
          ? "Your MP3 is still being prepared. Check again shortly."
          : "We couldn't download the MP3 just now.",
      );
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${recipient || "porizo-song"}.mp3`;
    document.body.append(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(href);
    }, 0);
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    clearOrderRecovery();
    pollRun.current += 1;
    setResumeCandidate(null);
    setOrder(undefined);
    setOrderElapsed(0);
    setOrderNeedsSignIn(false);
    setOrderTimedOut(false);
    setError(undefined);
    history.replaceState({ step: "recipient" }, "", "/create#recipient");
    dispatch({ type: "restart" });
  }

  function confirmReset(name: string) {
    if (window.confirm(`Your song for ${name} will be lost.`)) reset();
  }

  function confirmDiscardResume() {
    confirmReset(
      titleCaseForDisplay(resumeCandidate?.answers.recipient ?? recipient),
    );
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
          <SiteNav commerceFree={commerceFree} />
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
                <p>
                  Your answers are saved on this device. Try again later or
                  contact support.
                </p>
                <a className="btn-quiet" href="/support">
                  Contact support
                </a>
              </section>
            )}
            {state.activeStep === "theater" && (
              <>
                <QuizSummary
                  state={state}
                  onEdit={(step) => dispatch({ type: "edit", step })}
                />
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
                products={products}
                selectedPriceKey={product?.price_key}
                walletBalance={walletBalance}
                loading={busy}
                error={error}
                cancelled={RUNTIME_PARAMS.get("cancelled") === "1"}
                previewOnly={previewOnly}
                commerceFree={commerceFree}
                onSelectProduct={(priceKey) =>
                  setProduct(
                    products.find(
                      (candidate) => candidate.price_key === priceKey,
                    ),
                  )
                }
                onCheckout={() => void checkout()}
                onUseCredit={() => void startWalletOrder()}
              />
            )}
            {state.activeStep === "success" && (
              <Success
                order={order}
                error={error}
                elapsedMs={orderElapsed}
                needsSignIn={orderNeedsSignIn}
                timedOut={orderTimedOut}
                orderReference={
                  etsyUnitId ??
                  checkoutOrderId ??
                  checkoutSessionId ??
                  undefined
                }
                orderReferenceKind={
                  etsyUnitId
                    ? "etsy_unit"
                    : checkoutOrderId
                      ? "order"
                      : "session"
                }
                onSaveDelivery={saveDelivery}
                automatedDeliveryEnabled={automatedDeliveryEnabled}
                onStopDeliveryChannel={stopDeliveryChannel}
                onCancelGift={cancelGift}
                onRetryOrder={() => {
                  setOrderTimedOut(false);
                  setOrderPollRun((value) => value + 1);
                }}
                onCheckStatus={() => void refreshOrderStatus()}
                onStartAnother={reset}
                commerceFree={commerceFree}
                onDownloadMp3={commerceFree ? downloadMp3 : undefined}
              />
            )}
            {!commerceFree &&
              state.activeStep !== "recipient" &&
              state.activeStep !== "success" && (
                <div className="flow-reset">
                  <button
                    className="btn-quiet"
                    type="button"
                    onClick={() => confirmReset(recipient)}
                  >
                    Start over
                  </button>
                </div>
              )}
          </div>
          {showEntryFooter && <SiteFooter commerceFree={commerceFree} />}
        </>
      )}
      {state.activeStep === "preview" && (
        <>
          <DimBrand commerceFree={commerceFree} />
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

function QuizSummary({
  state,
  onEdit,
}: {
  state: FunnelState;
  onEdit: (step: QuizStep) => void;
}) {
  return (
    <button
      className="quiz-summary"
      type="button"
      onClick={() => onEdit("sound")}
    >
      <span>
        {titleCaseForDisplay(state.answers.recipient)} ·{" "}
        {state.answers.relationship} · {state.answers.occasion} ·{" "}
        {state.answers.genre}, {state.answers.mood.toLowerCase()},{" "}
        {state.answers.voice.toLowerCase()}
      </span>
      <PencilIcon />
    </button>
  );
}
