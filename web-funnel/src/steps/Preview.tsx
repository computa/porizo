import { useEffect, useRef, useState } from "react";
import { PlayIcon } from "../components/Icons";
import { cssDurationMs } from "../motion";

interface PreviewProps {
  recipient: string;
  lines: string[];
  previewUrl: string;
  generations: number;
  onChangeLyrics: () => void;
  onUnlock: () => void;
}

export function Preview({
  previewUrl,
  ...props
}: PreviewProps) {
  return <PreviewPlayer key={previewUrl} {...props} previewUrl={previewUrl} />;
}

function PreviewPlayer({
  recipient,
  lines,
  previewUrl,
  generations,
  onChangeLyrics,
  onUnlock,
}: PreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [listenCount, setListenCount] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const endedForPlay = useRef(false);
  const manualScrollUntil = useRef(0);
  const activeLine = Math.max(0, Math.min(lines.length - 1, Math.floor(progress * lines.length)));

  useEffect(() => {
    if (Date.now() < manualScrollUntil.current) return;
    lyricRefs.current[activeLine]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeLine]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      endedForPlay.current = false;
      setPlaybackError(false);
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
        setPlaybackError(true);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  return (
    <main className="dim-scene">
      <div className="preview-inner">
        <h1>{recipient}'s song</h1>
        <p className="muted">This is the chorus — the full song runs about 90 seconds.</p>
        <audio
          ref={audioRef}
          src={previewUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration;
            setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
          }}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            const ratio = audio.duration ? audio.currentTime / audio.duration : 0;
            setProgress(ratio);
            setCurrentTime(audio.currentTime);
            setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => {
            endedForPlay.current = false;
            setPlaying(true);
          }}
          onError={() => {
            setPlaying(false);
            setPlaybackError(true);
          }}
          onEnded={() => {
            if (endedForPlay.current) return;
            endedForPlay.current = true;
            setPlaying(false);
            setListenCount((count) => count + 1);
          }}
        />
        <button className="play-btn" type="button" onClick={() => void togglePlayback()} aria-label={playing ? "Pause preview" : playbackError ? "Try preview again" : "Play preview"}>
          <PlayIcon paused={playing} />
        </button>
        {playbackError && (
          <p className="playback-error" role="alert">
            The preview didn't play. Check your connection, then try again.
          </p>
        )}
        <div
          className="lyrics karaoke-window"
          onScroll={() => {
            manualScrollUntil.current = Date.now() + cssDurationMs("--t-manual-scroll");
          }}
          aria-label="Song lyrics"
        >
          {lines.map((line, index) => (
            <p
              className={index < activeLine ? "past" : index === activeLine ? "now" : "next"}
              ref={(node) => { lyricRefs.current[index] = node; }}
              key={`${line}-${index}`}
            >
              {line}
            </p>
          ))}
        </div>
        <div
          className="scrub"
          role="progressbar"
          aria-label="Preview playback position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={`${Math.round(progress * 100)} percent complete`}
        >
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="timecode" aria-label="Preview timecode">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        {generations < 2 && (
          <button className="btn-quiet preview-edit" type="button" onClick={onChangeLyrics}>
            Change something in the lyrics
          </button>
        )}
        <div className="cta-bar dim-cta">
          <button className={listenCount >= 2 ? "btn-primary pulse-once" : "btn-primary"} type="button" onClick={onUnlock}>
            Unlock the full song
          </button>
          {generations >= 2 && <p className="cap-copy dim-copy">You've heard two versions free — unlocking lets us perfect it with you.</p>}
        </div>
      </div>
    </main>
  );
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}
