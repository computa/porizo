import {
  createInitialState,
  isFlowStep,
  parseStoredState,
  type FunnelState,
} from "./funnel";

const demoPreviewUrl = "/create/audio/sample-mothers-day-2026.mp3";
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const OCCASION_PREFILLS = [
  "I Love You ❤️",
  "Celebration 🎉",
  "Birthday 🎂",
  "Thank You 🙏",
  "Encouragement 💪",
  "Anniversary 💑",
  "Mother's Day 💐",
  "Wedding 💒",
  "Graduation 🎓",
  "Friendship 👫",
  "Get Well 💊",
  "Custom ✨",
];

const DEMO_LYRICS = [
  "You made the ordinary feel like home",
  "Sunday songs and coffee on the stove",
  "Every little kindness led me here",
  "I hope this melody says it clear",
];

export function resolveInitialState(
  storedValue: string | null,
  search: string,
  pathname: string,
  hash = "",
  now = Date.now(),
): FunnelState {
  const params = new URLSearchParams(search);
  const requestedScreen = params.get("screen");
  const requestedOccasion = params.get("occasion");
  const occasion = requestedOccasion
    ? OCCASION_PREFILLS.find((value) =>
        value.toLowerCase().startsWith(requestedOccasion.toLowerCase()),
      )
    : undefined;
  const routeStep = isFlowStep(requestedScreen)
    ? requestedScreen
    : pathname.replace(/\/$/, "").endsWith("/success")
      ? "success"
      : null;
  const stored = parseStoredState(storedValue);
  if (stored) {
    if (routeStep === "success") return { ...stored, activeStep: "success", furthestStep: "success" };
    if (params.get("cancelled") === "1" && hasOfferArtifacts(stored)) {
      return { ...stored, activeStep: "offer", furthestStep: "offer" };
    }
    const hashStep = hash.replace(/^#/, "");
    if (
      isFlowStep(hashStep) &&
      hashStep !== "recipient" &&
      hashStep !== "success" &&
      stored.furthestStep !== "success" &&
      now - stored.savedAt <= RESUME_MAX_AGE_MS
    ) {
      return {
        ...stored,
        activeStep: stored.furthestStep,
        answers: occasion ? { ...stored.answers, occasion } : stored.answers,
      };
    }
  }
  if (!routeStep) {
    const initial = createInitialState();
    return occasion ? { ...initial, answers: { ...initial.answers, occasion } } : initial;
  }
  if (requestedScreen === null) {
    return { ...createInitialState(), activeStep: routeStep, furthestStep: routeStep };
  }
  const initial = createInitialState();
  return {
    ...initial,
    activeStep: routeStep,
    furthestStep: routeStep,
    answers: {
      ...initial.answers,
      recipient: "Sarah",
      relationship: "Mum",
      occasion: "I Love You ❤️",
      memory: "She sang in the kitchen every Sunday morning, even when the week had been hard.",
      specialPhrase: "Love you to the moon",
    },
    artifacts: {
      previewGenerations: 1,
      lyrics: DEMO_LYRICS,
      previewUrl: demoPreviewUrl,
    },
  };
}

export function resolveResumeCandidate(
  storedValue: string | null,
  search: string,
  pathname: string,
  hash = "",
  now = Date.now(),
): FunnelState | null {
  if (pathname.replace(/\/$/, "").endsWith("/success")) return null;
  if (new URLSearchParams(search).get("cancelled") === "1") return null;
  const hashStep = hash.replace(/^#/, "");
  if (isFlowStep(hashStep) && hashStep !== "recipient") return null;
  const stored = parseStoredState(storedValue);
  if (!stored || stored.furthestStep === "recipient" || stored.furthestStep === "success") return null;
  return now - stored.savedAt <= RESUME_MAX_AGE_MS ? stored : null;
}

function hasOfferArtifacts(state: FunnelState) {
  return Boolean(state.artifacts.trackId && state.artifacts.versionId);
}
