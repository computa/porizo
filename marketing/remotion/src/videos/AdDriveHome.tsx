import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  Img,
  Audio,
  staticFile,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from 'remotion';
import {colors, fonts, warmPalette} from '../tokens';
import {Fade, FilmGrain, Vignette} from '../components/SceneTransition';

/**
 * "The Drive Home" — 55s (1650 frames @ 30fps)
 *
 * Concept: Wife plays a Porizo song she made for her husband while driving.
 * Song is about their 20-year journey — meeting as teenagers, building a family,
 * and all the quiet everyday things she stopped noticing.
 *
 * Visual approach: AI-generated stills with Ken Burns motion + lyric text overlays.
 * Audio: warm-piano.mp3 as score (song TBD — will replace with actual Porizo song).
 *
 * Scene map (frames @ 30fps):
 *   0-90:      Opening — dark, "What if you could sing them a song?"
 *   90-270:    Scene 1 — Wife in car with phone, nervous smile
 *   270-510:   Scene 2 — Flashback: young couple meeting (verse 1)
 *   510-720:   Scene 3 — Husband driving, starting to react (chorus)
 *   720-930:   Scene 4 — Father teaching daughter bike (verse 2)
 *   930-1110:  Scene 5 — Dad morning routine, packing lunches (verse 2 cont.)
 *   1110-1350: Scene 6 — Couple holding hands in car, tears (bridge)
 *   1350-1470: Scene 7 — End text: "She recorded it in 2 minutes"
 *   1470-1650: Scene 8 — End card: Porizo logo + CTA
 */

// ─── Ken Burns cinematic motion on stills ───

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
  src,
  startAt,
  duration,
  zoom = 'in',
  driftX = 1.5,
  driftY = 0,
  brightness = 1.0,
  overlay = 0.15,
}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [startAt, startAt + duration],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

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
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
          filter: `brightness(${brightness})`,
        }}
      />
      {overlay > 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: warmPalette.shadow,
          opacity: overlay,
        }} />
      )}
    </AbsoluteFill>
  );
};

// ─── Lyric text overlay ───

interface LyricLineProps {
  text: string;
  startAt: number;
  duration: number;
  fontSize?: number;
  position?: 'center' | 'bottom' | 'top';
  italic?: boolean;
}

const LyricLine: React.FC<LyricLineProps> = ({
  text,
  startAt,
  duration,
  fontSize = 32,
  position = 'bottom',
  italic = false,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  if (frame < startAt - 1 || frame > startAt + duration + 1) return null;

  const fadeIn = interpolate(
    frame,
    [startAt, startAt + 12],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const fadeOut = interpolate(
    frame,
    [startAt + duration - 12, startAt + duration],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const slideUp = interpolate(
    frame,
    [startAt, startAt + 15],
    [12, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const positionStyle = position === 'center'
    ? {top: '50%', transform: `translateY(calc(-50% + ${slideUp}px))`}
    : position === 'top'
    ? {top: 180, transform: `translateY(${slideUp}px)`}
    : {bottom: 220, transform: `translateY(${slideUp}px)`};

  return (
    <div style={{
      position: 'absolute',
      left: 40,
      right: 40,
      ...positionStyle,
      textAlign: 'center',
      opacity: Math.min(fadeIn, fadeOut),
    }}>
      <div style={{
        fontFamily: fonts.display,
        fontSize,
        fontWeight: 400,
        fontStyle: italic ? 'italic' : 'normal',
        color: '#FFFFFF',
        lineHeight: 1.5,
        textShadow: '0 2px 20px rgba(0,0,0,0.8), 0 1px 6px rgba(0,0,0,0.6)',
        letterSpacing: '0.01em',
      }}>
        {text}
      </div>
    </div>
  );
};

// ─── Main composition ───

export const AdDriveHome: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Global audio volume — gentle fade in/out
  const musicVolume = interpolate(
    frame,
    [0, 60, 1350, 1470],
    [0, 0.5, 0.5, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill style={{background: '#0A0604'}}>

      {/* ═══ SCENE 1: Song starts — wife watching him (0-180) ═══ */}
      {/* Song plays immediately. She's watching his face as it hits him. */}
      <Fade startAt={0} endAt={180} fadeIn={15} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/02-wife-phone-car.png"
          startAt={0}
          duration={180}
          zoom="in"
          driftX={0.8}
          brightness={0.95}
          overlay={0.1}
        />
      </Fade>

      {/* ═══ SCENE 2: Husband's face — confusion turns to recognition (180-390) ═══ */}
      {/* Verse 1 lyrics appear as he starts to understand */}
      <Fade startAt={180} endAt={390} fadeIn={25} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/03-husband-driving-react.png"
          startAt={180}
          duration={210}
          zoom="in"
          driftX={0.5}
          driftY={-0.3}
          brightness={0.9}
          overlay={0.12}
        />
        <LyricLine
          text={`"I still remember that\nSeptember afternoon"`}
          startAt={200}
          duration={90}
          fontSize={30}
        />
        <LyricLine
          text={`"We were just kids then,\ndidn't know a thing"`}
          startAt={300}
          duration={85}
          fontSize={30}
        />
      </Fade>

      {/* ═══ SCENE 3: Flashback — young couple meeting (390-600) ═══ */}
      {/* Memory washes in as the song triggers the flashback */}
      <Fade startAt={390} endAt={600} fadeIn={30} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/01-young-couple-meet.png"
          startAt={390}
          duration={210}
          zoom="out"
          driftX={-1.0}
          driftY={0.5}
          brightness={1.05}
          overlay={0.05}
        />
        <LyricLine
          text={`"You wake up early\nso the house is warm"`}
          startAt={410}
          duration={90}
          fontSize={30}
        />
        <LyricLine
          text={`"And I forgot to tell you —\nyou're the reason we're enough"`}
          startAt={510}
          duration={85}
          fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 4: Father teaching daughter bike (720-930) ═══ */}
      {/* Verse 2: "You taught our daughter how to ride" */}
      <Fade startAt={720} endAt={930} fadeIn={30} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/04-father-daughter-bike.png"
          startAt={720}
          duration={210}
          zoom="in"
          driftX={1.2}
          brightness={1.1}
          overlay={0.05}
        />
        <LyricLine
          text={`"You taught our daughter how to ride\nwithout the training wheels"`}
          startAt={740}
          duration={95}
          fontSize={28}
        />
        <LyricLine
          text={`"You held our son the night\nthe fever wouldn't break"`}
          startAt={845}
          duration={80}
          fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 5: Dad morning routine (930-1110) ═══ */}
      {/* Verse 2 cont: "The lunches packed, the bills you never mention" */}
      <Fade startAt={930} endAt={1110} fadeIn={25} fadeOut={25}>
        <KenBurns
          src="stock/drive-home/05-dad-morning-routine.png"
          startAt={930}
          duration={180}
          zoom="out"
          driftX={-0.8}
          brightness={1.0}
          overlay={0.08}
        />
        <LyricLine
          text={`"The lunches packed,\nthe bills you never mention"`}
          startAt={950}
          duration={90}
          fontSize={28}
        />
        <LyricLine
          text={`"All these ordinary things\nI stopped paying attention"`}
          startAt={1040}
          duration={65}
          fontSize={28}
        />
      </Fade>

      {/* ═══ SCENE 6: Couple holding hands, tears (1110-1350) ═══ */}
      {/* Bridge: "We were seventeen with nothing but a dream" */}
      <Fade startAt={1110} endAt={1350} fadeIn={30} fadeOut={30}>
        <KenBurns
          src="stock/drive-home/06-couple-hands-car.png"
          startAt={1110}
          duration={240}
          zoom="in"
          driftX={0.3}
          driftY={-0.5}
          brightness={0.85}
          overlay={0.1}
        />
        <LyricLine
          text={`"We were seventeen\nwith nothing but a dream"`}
          startAt={1130}
          duration={90}
          fontSize={30}
        />
        <LyricLine
          text={`"The best man I've ever known\nwas standing next to me"`}
          startAt={1230}
          duration={100}
          fontSize={30}
        />
      </Fade>

      {/* ═══ SCENE 7: Closing message (1350-1470) ═══ */}
      <Fade startAt={1350} endAt={1470} fadeIn={20} fadeOut={15}>
        <AbsoluteFill style={{
          background: '#0A0604',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}>
          <div style={{
            fontFamily: fonts.display,
            fontSize: 34,
            color: '#FFFFFF',
            opacity: interpolate(frame, [1365, 1385], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            She recorded it in 2 minutes.
          </div>
          <div style={{
            fontFamily: fonts.body,
            fontSize: 20,
            color: colors.textSecondary,
            opacity: interpolate(frame, [1400, 1420], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}>
            He'll remember it forever.
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 8: End card (1470-1650) ═══ */}
      <Fade startAt={1470} endAt={1650} fadeIn={15} fadeOut={0}>
        <AbsoluteFill style={{
          background: colors.background,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        }}>
          {/* Gold glow */}
          <div style={{
            position: 'absolute',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${colors.gold}14 0%, transparent 60%)`,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />

          {/* Logo */}
          <div style={{
            fontFamily: fonts.display,
            fontSize: 72,
            color: colors.gold,
            letterSpacing: '0.05em',
            opacity: interpolate(frame, [1485, 1510], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `scale(${interpolate(frame, [1485, 1510], [0.8, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })})`,
          }}>
            Porizo
          </div>

          {/* Tagline */}
          <div style={{
            fontFamily: fonts.body,
            fontSize: 22,
            color: colors.textSecondary,
            opacity: interpolate(frame, [1510, 1530], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}>
            Your moment, in a song.
          </div>

          {/* CTA button */}
          <div style={{
            marginTop: 20,
            opacity: interpolate(frame, [1540, 1560], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}>
            <div style={{
              fontFamily: fonts.body,
              fontSize: 16,
              fontWeight: 600,
              color: colors.black,
              background: colors.gold,
              padding: '12px 32px',
              borderRadius: 14,
            }}>
              Download free on the App Store
            </div>
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ PERSISTENT: Brand bug — top-left throughout scenes ═══ */}
      <Fade startAt={90} endAt={1350} fadeIn={15} fadeOut={15}>
        <div style={{
          position: 'absolute',
          top: 60,
          left: 40,
          fontFamily: fonts.display,
          fontSize: 24,
          fontWeight: 700,
          color: '#FFFFFF',
          opacity: 0.6,
          textShadow: '0 1px 8px rgba(0,0,0,0.7)',
          letterSpacing: '0.06em',
        }}>
          Porizo
        </div>
      </Fade>

      {/* ═══ FILM GRAIN + VIGNETTE — cinematic feel ═══ */}
      <FilmGrain opacity={0.03} />
      <Vignette intensity={0.5} />

      {/* ═══ AUDIO: "Cafeteria Light" — Porizo-generated song ═══ */}
      <Audio
        src={staticFile('audio/cafeteria-light-trimmed.mp3')}
        volume={(f) => interpolate(
          f,
          [0, 30, 1350, 1470],
          [0, 0.7, 0.7, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        )}
      />
    </AbsoluteFill>
  );
};
