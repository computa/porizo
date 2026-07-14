export const QUIZ_STEPS = ["recipient", "relationship", "occasion", "memory", "sound"] as const;
export const FLOW_STEPS = [
  ...QUIZ_STEPS,
  "theater",
  "lyrics",
  "preview",
  "offer",
  "success",
] as const;

export type QuizStep = (typeof QUIZ_STEPS)[number];
export type FlowStep = (typeof FLOW_STEPS)[number];

export function isFlowStep(value: string | null): value is FlowStep {
  return value !== null && FLOW_STEPS.includes(value as FlowStep);
}

export interface FunnelAnswers {
  recipient: string;
  relationship: string;
  occasion: string;
  occasionDate: string;
  memory: string;
  specialPhrase: string;
  genre: string;
  mood: string;
  voice: string;
}

export interface FunnelArtifacts {
  trackId?: string;
  versionId?: string;
  versionNum?: number;
  lyrics?: string[];
  jobId?: string;
  previewUrl?: string;
  previewGenerations: number;
}

export interface FunnelState {
  version: 1;
  activeStep: FlowStep;
  furthestStep: FlowStep;
  returnStep?: FlowStep;
  answers: FunnelAnswers;
  artifacts: FunnelArtifacts;
}

export type FunnelAction =
  | { type: "answer"; step: keyof FunnelAnswers; value: string }
  | { type: "advance"; to?: FlowStep }
  | { type: "edit"; step: QuizStep; returnTo?: FlowStep }
  | { type: "artifact"; value: Partial<FunnelArtifacts> }
  | { type: "restart" };

const DEFAULT_ANSWERS: FunnelAnswers = {
  recipient: "",
  relationship: "",
  occasion: "",
  occasionDate: "",
  memory: "",
  specialPhrase: "",
  genre: "Acoustic",
  mood: "Warm",
  voice: "Female voice",
};

export function createInitialState(): FunnelState {
  return {
    version: 1,
    activeStep: "recipient",
    furthestStep: "recipient",
    answers: { ...DEFAULT_ANSWERS },
    artifacts: { previewGenerations: 0 },
  };
}

function nextStep(step: FlowStep): FlowStep {
  return FLOW_STEPS[Math.min(FLOW_STEPS.indexOf(step) + 1, FLOW_STEPS.length - 1)];
}

function laterStep(a: FlowStep, b: FlowStep): FlowStep {
  return FLOW_STEPS.indexOf(a) >= FLOW_STEPS.indexOf(b) ? a : b;
}

export function funnelReducer(state: FunnelState, action: FunnelAction): FunnelState {
  switch (action.type) {
    case "answer":
      return { ...state, answers: { ...state.answers, [action.step]: action.value } };
    case "artifact":
      return { ...state, artifacts: { ...state.artifacts, ...action.value } };
    case "edit":
      return { ...state, activeStep: action.step, returnStep: action.returnTo ?? state.activeStep };
    case "advance": {
      const destination = action.to ?? state.returnStep ?? nextStep(state.activeStep);
      return {
        ...state,
        activeStep: destination,
        furthestStep: laterStep(state.furthestStep, destination),
        returnStep: undefined,
      };
    }
    case "restart":
      return createInitialState();
  }
}

export function serializeState(state: FunnelState): string {
  return JSON.stringify(state);
}

export function parseStoredState(value: string | null): FunnelState | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<FunnelState>;
    if (
      candidate.version !== 1 ||
      !candidate.activeStep ||
      !isFlowStep(candidate.activeStep) ||
      !candidate.furthestStep ||
      !isFlowStep(candidate.furthestStep) ||
      (candidate.returnStep !== undefined && !isFlowStep(candidate.returnStep)) ||
      !isFunnelAnswers(candidate.answers) ||
      !isFunnelArtifacts(candidate.artifacts)
    ) {
      return null;
    }
    return candidate as FunnelState;
  } catch {
    return null;
  }
}

function isFunnelAnswers(value: unknown): value is FunnelAnswers {
  if (!value || typeof value !== "object") return false;
  const answers = value as Record<string, unknown>;
  return Object.keys(DEFAULT_ANSWERS).every((key) => typeof answers[key] === "string");
}

function isFunnelArtifacts(value: unknown): value is FunnelArtifacts {
  if (!value || typeof value !== "object") return false;
  const artifacts = value as Record<string, unknown>;
  const optionalStrings = ["trackId", "versionId", "jobId", "previewUrl"];
  return (
    typeof artifacts.previewGenerations === "number" &&
    Number.isInteger(artifacts.previewGenerations) &&
    artifacts.previewGenerations >= 0 &&
    optionalStrings.every(
      (key) => artifacts[key] === undefined || typeof artifacts[key] === "string",
    ) &&
    (artifacts.versionNum === undefined ||
      (typeof artifacts.versionNum === "number" && Number.isInteger(artifacts.versionNum))) &&
    (artifacts.lyrics === undefined ||
      (Array.isArray(artifacts.lyrics) &&
        artifacts.lyrics.every((line) => typeof line === "string")))
  );
}

export function titleCaseForDisplay(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toUpperCase());
}

export function buildTrackRequest(state: FunnelState) {
  const recipient = titleCaseForDisplay(state.answers.recipient);
  return {
    recipient_name: recipient,
    relationship_type: state.answers.relationship,
    occasion: state.answers.occasion,
    specific_memory: state.answers.memory.trim(),
    special_phrases: state.answers.specialPhrase.trim(),
    message: `I made this song for you, ${recipient}.`,
    style: `${state.answers.genre}, ${state.answers.mood.toLowerCase()}`,
    voice_gender: state.answers.voice.toLowerCase().startsWith("female") ? "female" : "male",
    voice_mode: "ai_voice" as const,
  };
}
