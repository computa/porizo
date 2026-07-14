import { useState } from "react";
import { normalizeLyrics } from "../api/funnel";

interface LyricSheetProps {
  recipient: string;
  lines: string[];
  generations: number;
  busy: boolean;
  onApprove: () => void;
  onSaveEdit: (lines: string[]) => Promise<void>;
  onRegenerate: () => Promise<void>;
}

export function LyricSheet({
  recipient,
  lines,
  generations,
  busy,
  onApprove,
  onSaveEdit,
  onRegenerate,
}: LyricSheetProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lines.join("\n"));
  const capped = generations >= 2;

  return (
    <main className="step lyric-sheet">
      <p className="eyebrow">For {recipient}</p>
      <h1 className="q">These are the words.</h1>
      <p className="hint">Read them once. The song comes next.</p>
      {editing ? (
        <>
          <label className="sr-only" htmlFor="lyrics-edit">Song lyrics</label>
          <textarea
            className="field lyrics-editor"
            id="lyrics-edit"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="btn-quiet"
            type="button"
            disabled={busy}
            onClick={() => void onSaveEdit(normalizeLyrics(draft)).then(() => setEditing(false))}
          >
            Save changes
          </button>
        </>
      ) : (
        <div className="paper-lyrics">
          {lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
        </div>
      )}
      <div className="cta-bar cta-stack">
        <button className="btn-primary" type="button" disabled={busy} onClick={onApprove}>
          {busy ? "Preparing the preview…" : "Sounds right — hear it"}
        </button>
        {capped ? (
          <p className="cap-copy">You've heard two versions free — unlocking lets us perfect it with you.</p>
        ) : (
          <div className="quiet-actions">
            <button className="btn-quiet" type="button" onClick={() => setEditing(true)}>Change something</button>
            <button className="btn-quiet" type="button" disabled={busy} onClick={() => void onRegenerate()}>Try another version</button>
          </div>
        )}
      </div>
    </main>
  );
}
