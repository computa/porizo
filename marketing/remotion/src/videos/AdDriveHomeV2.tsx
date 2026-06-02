import React from 'react';
import {
  AbsoluteFill,
  Img,
  Audio,
  staticFile,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {colors, fonts, warmPalette} from '../tokens';
import {Fade, FilmGrain, Vignette} from '../components/SceneTransition';

/**
 * "The Drive Home" V2 — 50s (1500 frames @ 30fps)
 *
 * SONG-FIRST approach. No preamble, no narration, no "she had something to show him."
 * The song starts IMMEDIATELY. We see the husband's face. He doesn't know what's coming.
 * The song does all the work. Images intercut between his reaction and memory flashbacks.
 *
 * The surprise IS the ad. The viewer experiences the same surprise James does.
 *
 * Timeline:
 *   0-120:     Wife taps play. Song begins. (4 seconds)
 *   120-360:   Husband's face — confusion, then recognition. Lyrics on screen. (8 seconds)
 *   360-540:   Flashback: teenagers meeting. Song continues. (6 seconds)
 *   540-720:   Back to husband — eyes welling up. Chorus hits. (6 seconds)
 *   720-900:   Flashback: teaching daughter to ride bike. (6 seconds)
 *   900-1050:  Flashback: dad making lunches. The ordinary. (5 seconds)
 *   1050-1230: Payoff: couple holding hands, tears. Bridge lyrics. (6 seconds)
 *   1230-1350: "She recorded it in 2 minutes. He'll remember it forever." (4 seconds)
 *   1350-1500: End card: Porizo + CTA (5 seconds)
 */

// ─── Ken Burns ───

interface KenBurnsProps {
  src: string;
  startAt: number;
  duration: number;
  zoom?: 'in' | 'out';
  driftX?: number;
  driftY?: number;
  brightness?: number;
  overlay?: number;
}

const KenBurns: React.FC<KenBurnsProps> = ({
  src, startAt, duration, zoom = 'in', driftX = 1.5, driftY = 0,
  brightness = 1.0, overlay = 0.15,
}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startAt, startAt + duration], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const scaleStart = zoom === 'in' ? 1.0 : 1.12;
  const scaleEnd = zoom === 'in' ? 1.12 : 1.0;
  const scale = interpolate(progress, [0, 1], [scaleStart, scaleEnd]);
  const tx = interpolate(progress, [0, 1], [0, driftX]);
  const ty = interpolate(progress, [0, 1], [0, driftY]);

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(src)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
          filter: `brightness(${brightness})`,
        }}
      />
      {overlay > 0 && (
        <div style={{position: 'absolute', inset: 0, background: warmPalette.shadow, opacity: overlay}} />
      )}
    </AbsoluteFill>
  );
};

// ─── Lyric overlay — minimal, elegant, Apple-style ───

interface LyricProps {
  text: string;
  startAt: number;
  duration: number;
  fontSize?: number;
  position?: 'center' | 'bottom' | 'top';
}

const Lyric: React.FC<LyricProps> = ({text, startAt, duration, fontSize = 30, position = 'bottom'}) => {
  const frame = useCurrentFrame();
  if (frame < startAt - 1 || frame > startAt + duration + 1) return null;

  const fadeIn = interpolate(frame, [startAt, startAt + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const fadeOut = interpolate(frame, [startAt + duration - 10, startAt + duration], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const slideUp = interpolate(frame, [startAt, startAt + 12], [8, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const posStyle = position === 'center'
    ? {top: '50%', transform: `translateY(calc(-50% + ${slideUp}px))`}
    : position === 'top'
    ? {top: 160, transform: `translateY(${slideUp}px)`}
    : {bottom: 200, transform: `translateY(${slideUp}px)`};

  return (
    <div style={{position: 'absolute', left: 36, right: 36, textAlign: 'center', opacity: Math.min(fadeIn, fadeOut), ...posStyle}}>
      <div style={{
        fontFamily: fonts.display, fontSize, fontWeight: 400, color: '#FFFFFF',
        lineHeight: 1.5, textShadow: '0 2px 20px rgba(0,0,0,0.8), 0 1px 6px rgba(0,0,0,0.6)',
      }}>
        {text}
      </div>
    </div>
  );
};

// ─── Main ───

export const AdDriveHomeV2: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: '#0A0604'}}>

      {/* ═══ SCENE 1: Wife taps play. Song starts. No context. (0-120) ═══ */}
      <Fade startAt={0} endAt={120} fadeIn={8} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/02-wife-phone-car.png"
          startAt={0} duration={120}
          zoom="in" driftX={0.5}
          brightness={0.9} overlay={0.08}
        />
      </Fade>

      {/* ═══ SCENE 2: Husband's face. He hears the song. (120-360) ═══ */}
      {/* This is the hook. His expression shifts. Lyrics tell the viewer what he's hearing. */}
      <Fade startAt={120} endAt={360} fadeIn={20} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/03-husband-driving-react.png"
          startAt={120} duration={240}
          zoom="in" driftX={0.3} driftY={-0.2}
          brightness={0.85} overlay={0.1}
        />
        <Lyric
          text={`"I still remember that\nSeptember afternoon"`}
          startAt={140} duration={100}
        />
        <Lyric
          text={`"But something in your laugh\nmade everything begin"`}
          startAt={250} duration={100}
        />
      </Fade>

      {/* ═══ SCENE 3: Flashback — teenagers meeting. (360-540) ═══ */}
      {/* Memory triggered. Warm. Golden. The beginning. */}
      <Fade startAt={360} endAt={540} fadeIn={25} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/01-young-couple-meet.png"
          startAt={360} duration={180}
          zoom="out" driftX={-1.0} driftY={0.3}
          brightness={1.05} overlay={0.05}
        />
        <Lyric
          text={`"We were just kids then,\ndidn't know a thing"`}
          startAt={380} duration={140}
        />
      </Fade>

      {/* ═══ SCENE 4: Back to husband — chorus hits. Tears forming. (540-720) ═══ */}
      <Fade startAt={540} endAt={720} fadeIn={20} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/03-husband-driving-react.png"
          startAt={540} duration={180}
          zoom="in" driftX={-0.3} driftY={-0.4}
          brightness={0.82} overlay={0.15}
        />
        <Lyric
          text={`"You wake up early\nso the house is warm"`}
          startAt={560} duration={80}
        />
        <Lyric
          text={`"And I forgot to tell you —\nyou're the reason we're enough"`}
          startAt={650} duration={65} fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 5: Flashback — daughter on bike. (720-900) ═══ */}
      <Fade startAt={720} endAt={900} fadeIn={25} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/04-father-daughter-bike.png"
          startAt={720} duration={180}
          zoom="in" driftX={1.0}
          brightness={1.1} overlay={0.05}
        />
        <Lyric
          text={`"You taught our daughter how to ride\nwithout the training wheels"`}
          startAt={740} duration={80} fontSize={28}
        />
        <Lyric
          text={`"You held our son the night\nthe fever wouldn't break"`}
          startAt={830} duration={65} fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 6: Dad making lunches. The ordinary. (900-1050) ═══ */}
      <Fade startAt={900} endAt={1050} fadeIn={20} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/05-dad-morning-routine.png"
          startAt={900} duration={150}
          zoom="out" driftX={-0.6}
          brightness={1.0} overlay={0.08}
        />
        <Lyric
          text={`"All these ordinary things\nI stopped paying attention"`}
          startAt={920} duration={120} fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 7: Couple holding hands. Tears. The payoff. (1050-1230) ═══ */}
      <Fade startAt={1050} endAt={1230} fadeIn={25} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/06-couple-hands-car.png"
          startAt={1050} duration={180}
          zoom="in" driftX={0.2} driftY={-0.3}
          brightness={0.85} overlay={0.08}
        />
        <Lyric
          text={`"The best man I've ever known\nwas standing next to me"`}
          startAt={1080} duration={90}
        />
        <Lyric
          text={`"Thank you for the ordinary"`}
          startAt={1170} duration={55} fontSize={34}
          position="center"
        />
      </Fade>

      {/* ═══ SCENE 8: Black — the reveal. (1230-1350) ═══ */}
      <Fade startAt={1230} endAt={1350} fadeIn={15} fadeOut={15}>
        <AbsoluteFill style={{
          background: '#0A0604',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 28,
        }}>
          <div style={{
            fontFamily: fonts.display, fontSize: 32, color: '#FFFFFF',
            textAlign: 'center', lineHeight: 1.6,
            opacity: interpolate(frame, [1245, 1265], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}>
            She recorded it in 2 minutes.
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 20, color: colors.textSecondary,
            opacity: interpolate(frame, [1280, 1300], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}>
            He'll remember it forever.
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 9: End card (1350-1500) ═══ */}
      <Fade startAt={1350} endAt={1500} fadeIn={12} fadeOut={0}>
        <AbsoluteFill style={{
          background: colors.background,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
        }}>
          <div style={{
            position: 'absolute', width: 600, height: 600, borderRadius: '50%',
            background: `radial-gradient(circle, ${colors.gold}14 0%, transparent 60%)`,
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          }} />
          <div style={{
            fontFamily: fonts.display, fontSize: 72, color: colors.gold, letterSpacing: '0.05em',
            opacity: interpolate(frame, [1365, 1385], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
            transform: `scale(${interpolate(frame, [1365, 1385], [0.8, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`,
          }}>
            Porizo
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 22, color: colors.textSecondary,
            opacity: interpolate(frame, [1390, 1410], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}>
            Your moment, in a song.
          </div>
          <div style={{
            marginTop: 20,
            opacity: interpolate(frame, [1415, 1435], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}>
            <div style={{
              fontFamily: fonts.body, fontSize: 16, fontWeight: 600,
              color: colors.black, background: colors.gold,
              padding: '12px 32px', borderRadius: 14,
            }}>
              Download free on the App Store
            </div>
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ FILM GRAIN + VIGNETTE ═══ */}
      <FilmGrain opacity={0.03} />
      <Vignette intensity={0.5} />

      {/* ═══ AUDIO: Song starts from frame 0. No delay. ═══ */}
      <Audio
        src={staticFile('audio/cafeteria-light-trimmed.mp3')}
        volume={(f) => interpolate(
          f, [0, 15, 1230, 1350],
          [0, 0.75, 0.75, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        )}
      />
    </AbsoluteFill>
  );
};
