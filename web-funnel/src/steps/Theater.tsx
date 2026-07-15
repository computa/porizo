import { useEffect, useState } from "react";
import { cssDurationMs } from "../motion";

const STAGES = [
  "Reading your memory…",
  "Writing the words…",
  "Finding the melody",
  "Recording the vocals",
  "Mixing",
];

interface TheaterProps {
  recipient: string;
  lyrics: string[];
  progressStage?: number;
  failed?: boolean;
  onRetry?: () => void;
  onHoldPlace?: (email: string) => void;
}

export function Theater({ recipient, lyrics, progressStage, failed, onRetry, onHoldPlace }: TheaterProps) {
  const [timedStage, setTimedStage] = useState(0);
  const [showHold, setShowHold] = useState(false);
  const [email, setEmail] = useState("");
  const incomingStage = clampStage(progressStage ?? 0);
  const [serverStage, setServerStage] = useState(incomingStage);
  if (incomingStage > serverStage) setServerStage(incomingStage);
  const stage = Math.max(timedStage, serverStage, incomingStage);

  useEffect(() => {
    if (failed) return;
    let stageTimer: number | undefined;
    const advanceStage = () => {
      setTimedStage((current) => {
        const next = Math.min(current + 1, STAGES.length - 1);
        if (next < STAGES.length - 1) {
          stageTimer = window.setTimeout(advanceStage, cssDurationMs("--t-stage"));
        }
        return next;
      });
    };
    stageTimer = window.setTimeout(advanceStage, cssDurationMs("--t-stage"));
    const holdTimer = window.setTimeout(
      () => setShowHold(true),
      cssDurationMs("--t-theater-hold"),
    );
    return () => {
      clearTimeout(stageTimer);
      clearTimeout(holdTimer);
    };
  }, [failed]);

  if (failed) {
    return (
      <main className="step step-centered">
        <section className="card status-card" role="alert">
          <h1>That take didn't come together.</h1>
          <p>Your details are safe. Let's try again.</p>
          <button className="btn-primary" type="button" onClick={onRetry}>Retry</button>
        </section>
      </main>
    );
  }

  return (
    <main className="step theater step-centered">
      <h1 className="q">Writing {recipient}'s song…</h1>
      <p className="stage-label" aria-live="polite">{STAGES[stage]}</p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Making your song"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={stage * 25}
      >
        <i />
      </div>
      <div className="lyric-feed" aria-label="A preview of the lyrics">
        {lyrics.slice(0, 4).map((line) => <p className="line" key={line}>{line}</p>)}
      </div>
      <p className="hint theater-note">
        {onHoldPlace
          ? "Usually under two minutes. Keep this tab open — or we can email you a link."
          : "Usually under two minutes. Keep this tab open."}
      </p>
      {showHold && onHoldPlace && (
        <form
          className="card hold-card"
          onSubmit={(event) => {
            event.preventDefault();
            onHoldPlace?.(email);
          }}
        >
          <label htmlFor="hold-email">Want us to tell you when it's ready?</label>
          <div className="inline-action">
            <input
              className="field"
              id="hold-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className="btn-quiet" type="submit">Hold my place</button>
          </div>
        </form>
      )}
    </main>
  );
}

function clampStage(stage: number): number {
  return Math.max(0, Math.min(STAGES.length - 1, stage));
}
