import { useEffect, useMemo, useRef, useState } from "react";
import { ChoiceChips } from "../components/ChoiceChips";
import { PencilIcon } from "../components/Icons";
import {
  QUIZ_STEPS,
  titleCaseForDisplay,
  type FunnelAction,
  type FunnelAnswers,
  type FunnelState,
  type QuizStep,
} from "../state/funnel";
import { cssDurationMs } from "../motion";

const RELATIONSHIPS = [
  "Mum", "Dad", "Partner", "Wife", "Husband", "Friend", "Daughter", "Son",
  "Grandma", "Grandpa", "Sister", "Brother", "Someone else…",
];
const OCCASIONS = [
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
const CUSTOM_OCCASIONS = ["Apology 💐", "Advice 🧭", "Bereavement 🕊️"];
const POPULAR_STYLES = ["Pop", "Acoustic", "Soul", "Folk", "Jazz", "R&B", "Rock", "Country", "Ballad"];
const MORE_STYLES = [
  "Afrobeats",
  "Highlife",
  "Igbo Highlife",
  "Amapiano",
  "Jùjú",
  "Fuji",
  "Afropop",
  "Reggaeton",
  "Salsa",
  "Bossa Nova",
  "Cumbia",
  "Bachata",
  "Samba",
  "Latin Pop",
];
const MEMORIES = [
  "Every Sunday, she sang while making breakfast…",
  "The first time we got caught in the rain together…",
  "He always calls just when I need to hear his voice…",
  "We still laugh about the road trip when everything went wrong…",
];

interface QuizFlowProps {
  state: FunnelState;
  dispatch: (action: FunnelAction) => void;
  onStartSession: () => Promise<boolean>;
  onWriteSong: () => Promise<void>;
  busy: boolean;
  error?: string;
  resumeRecipient?: string;
  onResume?: () => void;
  onDiscardResume?: () => void;
  onBeginNew?: () => void;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function QuizFlow({
  state,
  dispatch,
  onStartSession,
  onWriteSong,
  busy,
  error,
  resumeRecipient,
  onResume,
  onDiscardResume,
  onBeginNew,
}: QuizFlowProps) {
  const reducedMotion = useReducedMotion();
  const [customRelationship, setCustomRelationship] = useState("");
  const [showCustomOccasions, setShowCustomOccasions] = useState(false);
  const [showMoreStyles, setShowMoreStyles] = useState(false);
  const [memoryNudged, setMemoryNudged] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [collapsing, setCollapsing] = useState(false);
  const previousHeadingTop = useRef<number | null>(null);
  const autoAdvanceTimer = useRef<number | undefined>(undefined);
  const transitionTimer = useRef<number | undefined>(undefined);
  const activeStepRef = useRef(state.activeStep);
  const activeStep = state.activeStep as QuizStep;
  const furthestQuizIndex = QUIZ_STEPS.includes(state.furthestStep as QuizStep)
    ? QUIZ_STEPS.indexOf(state.furthestStep as QuizStep)
    : QUIZ_STEPS.length - 1;
  const returnQuizStep = state.returnStep && QUIZ_STEPS.includes(state.returnStep as QuizStep)
    ? state.returnStep as QuizStep
    : undefined;

  useEffect(() => {
    activeStepRef.current = state.activeStep;
  }, [state.activeStep]);

  useEffect(() => {
    if (reducedMotion || activeStep !== "memory") return;
    const timer = window.setInterval(
      () => setPlaceholderIndex((index) => (index + 1) % MEMORIES.length),
      cssDurationMs("--t-placeholder"),
    );
    return () => window.clearInterval(timer);
  }, [activeStep, reducedMotion]);

  useEffect(() => {
    if (previousHeadingTop.current === null) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(".step-live .q");
      if (heading) window.scrollBy({ top: heading.getBoundingClientRect().top - previousHeadingTop.current! });
      heading?.focus({ preventScroll: true });
      previousHeadingTop.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStep]);

  useEffect(
    () => () => {
      clearTimeout(autoAdvanceTimer.current);
      clearTimeout(transitionTimer.current);
    },
    [],
  );

  const orderedOccasions = useMemo(() => {
    const prefill = new URLSearchParams(window.location.search).get("occasion");
    if (!prefill) return OCCASIONS;
    const match = OCCASIONS.find((occasion) => occasion.toLowerCase().startsWith(prefill.toLowerCase()));
    return match ? [match, ...OCCASIONS.filter((occasion) => occasion !== match)] : OCCASIONS;
  }, []);

  function answer(step: keyof FunnelAnswers, value: string) {
    dispatch({ type: "answer", step, value });
  }

  function advance(to?: QuizStep) {
    previousHeadingTop.current = document.querySelector<HTMLElement>(".step-live .q")?.getBoundingClientRect().top ?? null;
    const commit = () => {
      dispatch({ type: "advance", to });
      history.pushState({ step: to }, "", `#${to ?? "next"}`);
      setCollapsing(false);
    };
    if (reducedMotion) {
      commit();
      return;
    }
    setCollapsing(true);
    transitionTimer.current = window.setTimeout(commit, cssDurationMs("--t-step"));
  }

  function autoAdvance(step: "relationship", value: string) {
    answer(step, value);
    clearTimeout(autoAdvanceTimer.current);
    if (!reducedMotion && value !== "Someone else…") {
      autoAdvanceTimer.current = window.setTimeout(() => advance(), cssDurationMs("--t-chip-delay"));
    }
  }

  function edit(step: QuizStep) {
    previousHeadingTop.current = document
      .querySelector<HTMLElement>(`[data-summary-step="${step}"]`)
      ?.getBoundingClientRect().top ?? null;
    history.pushState({ step }, "", `#${step}`);
    dispatch({ type: "edit", step, returnTo: state.returnStep ?? state.activeStep });
  }

  return (
    <main className="stack" aria-label="Song details">
      {QUIZ_STEPS.map((step, index) => {
        if (step !== activeStep && index <= furthestQuizIndex) {
          if (step === returnQuizStep) {
            return <WaitingRow key={step} step={step} state={state} />;
          }
          return (
            <SummaryRow
              key={step}
              step={step}
              state={state}
              onEdit={() => edit(step)}
            />
          );
        }
        if (step !== activeStep) return null;
        return (
          <section className="step-live" key={step} data-step={step}>
            {state.returnStep && (
              <button
                className="btn-quiet edit-cancel"
                type="button"
                disabled={busy || collapsing}
                onClick={() => advance()}
              >
                Cancel edit
              </button>
            )}
            <div className={collapsing ? "collapse-wrap closed" : "collapse-wrap"}>
              <div>
            {step === "recipient" && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!state.answers.recipient.trim()) return;
                  if (await onStartSession() && activeStepRef.current === "recipient") advance();
                }}
              >
                {resumeRecipient && (
                  <aside className="card resume-card" aria-label="Saved song">
                    <p>Pick up {titleCaseForDisplay(resumeRecipient)}'s song where you left off</p>
                    <div className="quiet-actions">
                      <button className="btn-quiet" type="button" onClick={onResume}>Pick up the song</button>
                      <button className="btn-quiet" type="button" onClick={onDiscardResume}>Start over</button>
                    </div>
                  </aside>
                )}
                <h1 className="q" tabIndex={-1}>Who's this song for?</h1>
                <p className="hint">Their name will be sung in the lyrics.</p>
                <label className="sr-only" htmlFor="recipient">Recipient's name</label>
                <input
                  className="field big"
                  id="recipient"
                  autoComplete="name"
                  value={state.answers.recipient}
                  onChange={(event) => {
                    onBeginNew?.();
                    answer("recipient", event.target.value);
                  }}
                  placeholder="Their name"
                  autoFocus
                  disabled={Boolean(resumeRecipient)}
                />
                {error && <p className="error-text" role="alert">{error}</p>}
                <Cta disabled={Boolean(resumeRecipient) || !state.answers.recipient.trim() || busy || collapsing} label="Next" />
              </form>
            )}

            {step === "relationship" && (
              <>
                <h1 className="q" tabIndex={-1}><strong>{titleCaseForDisplay(state.answers.recipient)}</strong> is your…</h1>
                <p className="hint">So the song speaks the way you two speak.</p>
                <ChoiceChips
                  label="Relationship"
                  options={RELATIONSHIPS}
                  value={state.answers.relationship}
                  onChange={(value) => autoAdvance("relationship", value)}
                />
                {state.answers.relationship === "Someone else…" && (
                  <div className="inline-field">
                    <label htmlFor="custom-relationship">Your relationship</label>
                    <input
                      className="field"
                      id="custom-relationship"
                      maxLength={50}
                      value={customRelationship}
                      onChange={(event) => setCustomRelationship(event.target.value)}
                    />
                  </div>
                )}
                <Cta
                  disabled={collapsing ||
                    !state.answers.relationship ||
                    (state.answers.relationship === "Someone else…" && !customRelationship.trim())
                  }
                  label="Next"
                  onClick={() => {
                    if (customRelationship.trim()) answer("relationship", customRelationship.trim());
                    advance();
                  }}
                />
              </>
            )}

            {step === "occasion" && (
              <>
                <h1 className="q" tabIndex={-1}>What's the moment?</h1>
                <p className="hint">It doesn't need a date. “I Love You” songs get the biggest tears.</p>
                <ChoiceChips
                  label="Occasion"
                  options={showCustomOccasions ? [...orderedOccasions, ...CUSTOM_OCCASIONS] : orderedOccasions}
                  value={state.answers.occasion}
                  onChange={(value) => {
                    answer("occasion", value);
                    if (value === "Custom ✨") setShowCustomOccasions(true);
                  }}
                />
                <div className="inline-field">
                  <label htmlFor="occasion-date">Is there a date? <span>(optional)</span></label>
                  <input
                    className="field"
                    id="occasion-date"
                    value={state.answers.occasionDate}
                    onChange={(event) => answer("occasionDate", event.target.value)}
                    placeholder="July 26"
                  />
                  <p className="field-help">Your song is ready in minutes — the date just helps us remind you to send it.</p>
                </div>
                <Cta disabled={!state.answers.occasion || collapsing} label="Next" onClick={() => advance()} />
              </>
            )}

            {step === "memory" && (
              <>
                <h1 className="q" tabIndex={-1}>Tell us one real memory.</h1>
                <p className="hint" id="memory-guidance">
                  {memoryNudged
                    ? "One more sentence — what did it feel like?"
                    : "You don't need to be creative. Start with one real memory."}
                </p>
                <label className="sr-only" htmlFor="memory">Your memory</label>
                <div className={state.answers.memory ? "memory-field has-value" : "memory-field"}>
                  <textarea
                    className="field"
                    id="memory"
                    maxLength={2000}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "memory-guidance memory-error" : "memory-guidance"}
                    value={state.answers.memory}
                    onChange={(event) => answer("memory", event.target.value)}
                  />
                  <p className="memory-placeholder" key={placeholderIndex} aria-hidden="true">
                    {MEMORIES[placeholderIndex]}
                  </p>
                </div>
                <div className="field-row">
                  <span className="memory-coaching">Plain words beat perfect words.</span>
                  <span className={state.answers.memory.length >= 1900 ? "count count-warm" : "count"}>
                    {state.answers.memory.length} / 2000
                  </span>
                </div>
                {error && <p className="error-text" id="memory-error" role="alert">{error}</p>}
                <div className="inline-field">
                  <label htmlFor="phrase">Something they always say <span>(optional)</span></label>
                  <input
                    className="field"
                    id="phrase"
                    value={state.answers.specialPhrase}
                    onChange={(event) => answer("specialPhrase", event.target.value)}
                    placeholder="Love you to the moon"
                  />
                </div>
                <Cta
                  disabled={!state.answers.memory.trim() || collapsing}
                  label="Next"
                  onClick={() => {
                    if (state.answers.memory.trim().length < 20 && !memoryNudged) {
                      setMemoryNudged(true);
                      return;
                    }
                    advance();
                  }}
                />
              </>
            )}

            {step === "sound" && (
              <>
                <h1 className="q" tabIndex={-1}>How should it sound?</h1>
                <p className="hint">Pick what she'd play in the car.</p>
                <OptionGroup label="Style">
                  <ChoiceChips
                    label="Style"
                    labelledByParent
                    className="choice-rail style-rail"
                    options={showMoreStyles ? [...POPULAR_STYLES, ...MORE_STYLES] : [...POPULAR_STYLES, "More styles…"]}
                    value={state.answers.genre}
                    onChange={(value) => {
                      if (value === "More styles…") setShowMoreStyles(true);
                      else answer("genre", value);
                    }}
                  />
                </OptionGroup>
                <OptionGroup label="Mood">
                  <ChoiceChips
                    label="Mood"
                    labelledByParent
                    className="choice-rail"
                    options={["Warm", "Joyful", "Emotional", "Playful"]}
                    value={state.answers.mood}
                    onChange={(value) => answer("mood", value)}
                  />
                </OptionGroup>
                <OptionGroup label="Voice">
                  <ChoiceChips
                    label="Voice"
                    labelledByParent
                    options={["Female voice", "Male voice"]}
                    value={state.answers.voice}
                    onChange={(value) => answer("voice", value)}
                  />
                </OptionGroup>
                {error && <p className="error-text" role="alert">{error}</p>}
                <Cta
                  disabled={busy || collapsing}
                  label={busy ? "Starting your song…" : `Write ${titleCaseForDisplay(state.answers.recipient)}'s song`}
                  onClick={() => void onWriteSong()}
                />
              </>
            )}
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}

function SummaryRow({ step, state, onEdit }: { step: QuizStep; state: FunnelState; onEdit: () => void }) {
  const summaries: Record<QuizStep, [string, string]> = {
    recipient: ["For", titleCaseForDisplay(state.answers.recipient)],
    relationship: ["Your", state.answers.relationship],
    occasion: ["Moment", state.answers.occasion],
    memory: ["Memory", state.answers.memory],
    sound: ["Sound", `${state.answers.genre}, ${state.answers.mood.toLowerCase()}, ${state.answers.voice.toLowerCase()}`],
  };
  const [key, value] = summaries[step];
  return (
    <button
      className="step-done"
      type="button"
      data-summary-step={step}
      onClick={onEdit}
      aria-label={`Edit ${key.toLowerCase()}: ${value}`}
    >
      <span className="k">{key}</span>
      <span className="v">{value}</span>
      <PencilIcon />
    </button>
  );
}

function WaitingRow({ step, state }: { step: QuizStep; state: FunnelState }) {
  const labels: Record<QuizStep, string> = {
    recipient: "Who's this song for?",
    relationship: `${titleCaseForDisplay(state.answers.recipient)} is your…`,
    occasion: "What's the moment?",
    memory: "Tell us one real memory.",
    sound: "How should it sound?",
  };
  return (
    <div className="step-waiting" aria-label={`${labels[step]} Waiting while you edit`}>
      <span className="k">Next</span>
      <span className="v">{labels[step]}</span>
    </div>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="option-group">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function Cta({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <div className="cta-bar">
      <button className="btn-primary" type={onClick ? "button" : "submit"} disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
