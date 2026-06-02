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
 * "The Drive Home" V3 — 50s (1500 frames @ 30fps)
 *
 * V3 changes from V2:
 * - Scene 1 uses new image with Porizo app visible on phone screen
 * - Added persistent download CTAs at key moments throughout the video
 * - "Download Porizo" appears during emotional peaks for maximum conversion
 * - App Store badge CTA in lower third during flashback scenes
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

// ─── Lyric overlay ───

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

// ─── Download CTA pill — appears at key moments ───

interface DownloadCtaProps {
  startAt: number;
  endAt: number;
  text?: string;
}

const DownloadCta: React.FC<DownloadCtaProps> = ({startAt, endAt, text = 'Download Porizo — Free'}) => {
  const frame = useCurrentFrame();
  if (frame < startAt - 1 || frame > endAt + 1) return null;

  const fadeIn = interpolate(frame, [startAt, startAt + 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const fadeOut = interpolate(frame, [endAt - 15, endAt], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const slideUp = interpolate(frame, [startAt, startAt + 15], [20, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <div style={{
      position: 'absolute',
      bottom: 100,
      left: 0, right: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      opacity: Math.min(fadeIn, fadeOut),
      transform: `translateY(${slideUp}px)`,
    }}>
      <div style={{
        fontFamily: fonts.body, fontSize: 17, fontWeight: 600,
        color: colors.black, background: colors.gold,
        padding: '10px 28px', borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}>
        {text}
      </div>
      <div style={{
        fontFamily: fonts.body, fontSize: 12, color: '#FFFFFF', opacity: 0.7,
        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      }}>
        Available on the App Store
      </div>
    </div>
  );
};

// ─── Main ───

export const AdDriveHomeV3: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: '#0A0604'}}>

      {/* ═══ SCENE 1: Wife holds phone showing Porizo. Song starts. (0-120) ═══ */}
      <Fade startAt={0} endAt={120} fadeIn={8} fadeOut={20}>
        <KenBurns
          src="stock/drive-home/02-wife-phone-porizo.png"
          startAt={0} duration={120}
          zoom="in" driftX={0.5}
          brightness={0.95} overlay={0.05}
        />
      </Fade>

      {/* ═══ SCENE 2: Husband's face. He hears the song. (120-360) ═══ */}
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
        {/* CTA 1: First appearance during flashback */}
        <DownloadCta startAt={420} endAt={530} text="Create a song like this" />
      </Fade>

      {/* ═══ SCENE 4: Back to husband — chorus hits. Tears. (540-720) ═══ */}
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

      {/* ═══ SCENE 5: Daughter on bike. (720-900) ═══ */}
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
        {/* CTA 2: During family scenes */}
        <DownloadCta startAt={800} endAt={895} text="Download Porizo — Free" />
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

      {/* ═══ SCENE 7: Couple holding hands. Tears. Payoff. (1050-1230) ═══ */}
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
        {/* CTA 3: Emotional peak — strongest conversion moment */}
        <DownloadCta startAt={1140} endAt={1225} text="Sing them a song — Download Porizo" />
      </Fade>

      {/* ═══ SCENE 8: The reveal. (1230-1350) ═══ */}
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
              fontFamily: fonts.body, fontSize: 18, fontWeight: 600,
              color: colors.black, background: colors.gold,
              padding: '14px 36px', borderRadius: 14,
              boxShadow: '0 4px 20px rgba(212,165,116,0.3)',
            }}>
              Download Free on the App Store
            </div>
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ FILM GRAIN + VIGNETTE ═══ */}
      <FilmGrain opacity={0.03} />
      <Vignette intensity={0.5} />

      {/* ═══ AUDIO ═══ */}
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
