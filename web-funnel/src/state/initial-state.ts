import {
  createInitialState,
  isFlowStep,
  parseStoredState,
  type FunnelState,
} from "./funnel";

const demoPreviewUrl = "/create/audio/sample-mothers-day-2026.mp3";

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
    return {
      ...stored,
      activeStep: stored.furthestStep,
      answers: occasion ? { ...stored.answers, occasion } : stored.answers,
    };
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
