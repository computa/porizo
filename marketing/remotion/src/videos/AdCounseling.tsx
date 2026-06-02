import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Img,
  Audio,
  staticFile,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import {colors, fonts, warmPalette} from '../tokens';
import {Fade, GradientBg} from '../components/SceneTransition';
import {EndCard} from '../components/EndCard';
import {AppFlowDemo} from '../components/AppFlowDemo';

// ─── Config interface — V2: all-video approach ───

export interface AdConfig {
  clips: {
    counselorFull: string;  // Full narration video (audio + visual base layer)
    coupleMeet: string;     // AI-generated couple image — coffee date
    coupleFalling: string;  // AI-generated couple image — sunset walk
    coupleDrift: string;    // AI-generated couple image — drifting apart
    couplePhone: string;    // AI-generated image — woman with phone
  };
  appFlow: {
    recipientName: string;
    occasion: string;
    message: string;
    songTitle: string;
  };
  endTagline: string;
}

interface AdCounselingProps {
  config: AdConfig;
}

// ─── Memory Bridge — warm wash that bridges counselor ↔ overlay scenes ───

/** How many frames the warm wash leads before the image appears */
const BRIDGE_LEAD = 12;
/** How many frames the warm wash trails after the image disappears */
const BRIDGE_TRAIL = 8;

interface MemoryBridgeProps {
  children: React.ReactNode;
  startAt: number;
  endAt: number;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Wraps an overlay scene with a "dip to warm dark" transition.
 * The warm wash fades in BEFORE the image, creating:
 *   counselor → warm dark wash → image emerging from warmth
 * This prevents the ghostly double-exposure of pure opacity crossfades.
 */
const MemoryBridge: React.FC<MemoryBridgeProps> = ({
  children,
  startAt,
  endAt,
  fadeIn = 35,
  fadeOut = 30,
}) => {
  const frame = useCurrentFrame();
  const washStart = startAt - BRIDGE_LEAD;
  const washEnd = endAt + BRIDGE_TRAIL;

  if (frame < washStart - 1 || frame > washEnd + 1) return null;

  // Entrance wash: ramps up before image, fades as image appears
  const enterWash = interpolate(
    frame,
    [washStart, startAt, startAt + fadeIn],
    [0, 0.85, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Exit wash: ramps up as image fades, then disappears
  const exitWash = interpolate(
    frame,
    [endAt - fadeOut, endAt, washEnd],
    [0, 0.7, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const washOpacity = Math.max(enterWash, exitWash);

  // Image: fades in after the wash leads, fades out before exit wash
  const imageOpacity = interpolate(
    frame,
    [startAt, startAt + fadeIn, endAt - fadeOut, endAt],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <>
      {/* Warm dark wash — bridges the visual gap */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse at center, #1A0F08 0%, #0A0604 100%)`,
        opacity: washOpacity,
      }} />
      {/* Image content — fades in on top of the wash */}
      <div style={{position: 'absolute', inset: 0, opacity: imageOpacity}}>
        {children}
      </div>
    </>
  );
};

// ─── Ken Burns cinematic motion on still images ───

interface CinematicImageProps {
  src: string;
  startAt: number;
  duration: number;
  zoom?: 'in' | 'out';
  driftX?: number;
  brightness?: number;
  overlay?: number;
  overlayColor?: string;
  children?: React.ReactNode;
}

const CinematicImage: React.FC<CinematicImageProps> = ({
  src,
  startAt,
  duration,
  zoom = 'in',
  driftX = 2,
  brightness = 1.0,
  overlay = 0.15,
  overlayColor = '#0A0A0A',
  children,
}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [startAt, startAt + duration],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Ken Burns: slow zoom + drift
  const scaleStart = zoom === 'in' ? 1.02 : 1.12;
  const scaleEnd = zoom === 'in' ? 1.12 : 1.02;
  const scale = interpolate(progress, [0, 1], [scaleStart, scaleEnd]);
  const translateX = interpolate(progress, [0, 1], [0, driftX]);

  // Settling effect: image starts slightly larger and settles in
  const settleScale = interpolate(
    frame,
    [startAt, startAt + 25],
    [1.03, 1.0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale * settleScale}) translateX(${translateX}%)`,
          filter: `brightness(${brightness})`,
        }}
      />
      {overlay > 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: overlayColor,
          opacity: overlay,
        }} />
      )}
      {children}
    </AbsoluteFill>
  );
};

/**
 * Counseling Ad V2 — 45s (1350 frames @ 30fps) all-video composition.
 *
 * Architecture: Counselor video (39.1s) = base layer.
 * Audio plays throughout. AI-generated images with Ken Burns motion
 * overlay the counselor during story scenes.
 *
 * Narration timing (39.1s total):
 *   Scene 1 (0-8s):     Hook — "When was the last time you reminded each other..."
 *   Scene 2 (8-13s):    Story — "Think about when it started..."
 *   Scene 3 (13-17s):   Falling — "You fell in love..."
 *   Scene 4 (17-22s):   Drift — "But then life happened..."
 *   Scene 5 (22-27s):   Insight — "Sometimes the little things..."
 *   Scene 6 (27-35s):   How it works — "That's Porizo..."
 *   Scene 7 (35-39s):   Closing — "Remind each other."
 *
 * Visual overlay map (frames @ 30fps):
 *   0-240:     Counselor on camera (hook)
 *   220-400:   couple-meet — coffee date
 *   380-510:   couple-falling — sunset walk
 *   490-660:   couple-drift — drifting apart
 *   640-1040:  couple-phone + AppFlowDemo
 *   1020-1173: Counselor on camera (closing)
 *   1130-1350: EndCard — CTA
 *
 * Audio layers:
 *   L1: Counselor narration (from video) — volume 1.0
 *   L2: warm-piano.mp3 — 0.15 under story, fades for CTA
 *   L3: acoustic-indie.mp3 — 0.30 during app demo payoff
 */
export const AdCounseling: React.FC<AdCounselingProps> = ({config}) => {

  // ─── Audio volume curves ───

  // L2: Background music — very subtle, never competes with voice
  const bgMusicVolume = (f: number) =>
    interpolate(
      f,
      [0, 30, 780, 830, 950, 1000],
      [0, 0.15, 0.15, 0.08, 0.08, 0],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
    );

  // L3: Sample Porizo song — plays during app demo payoff
  const sampleSongVolume = (f: number) =>
    interpolate(
      f,
      [0, 30, 170, 220, 380],
      [0, 0.30, 0.30, 0.15, 0],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
    );

  return (
    <AbsoluteFill style={{background: '#0A0A0A'}}>

      {/* ═══ BASE LAYER: Counselor video — audio plays throughout ═══ */}
      <OffthreadVideo
        src={staticFile(config.clips.counselorFull)}
        volume={(f) => interpolate(
          f,
          [0, 8, 1130, 1173],
          [0, 1, 1, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        )}
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
      />

      {/* ═══ VISUAL OVERLAYS — MemoryBridge for smooth counselor↔scene transitions ═══ */}

      {/* Scene 2: First date — coffee shop (frames 220-400) */}
      <MemoryBridge startAt={220} endAt={400} fadeIn={35} fadeOut={30}>
        <CinematicImage
          src={config.clips.coupleMeet}
          startAt={220}
          duration={180}
          zoom="in"
          driftX={1.5}
          brightness={0.95}
          overlay={0.1}
        />
      </MemoryBridge>

      {/* Scene 3: Falling in love — sunset walk (frames 380-510) */}
      <MemoryBridge startAt={380} endAt={510} fadeIn={30} fadeOut={30}>
        <CinematicImage
          src={config.clips.coupleFalling}
          startAt={380}
          duration={130}
          zoom="out"
          driftX={-1.5}
          brightness={1.0}
          overlay={0.08}
        />
      </MemoryBridge>

      {/* Scene 4: The drift — couch distance (frames 490-660) */}
      <MemoryBridge startAt={490} endAt={660} fadeIn={30} fadeOut={30}>
        <CinematicImage
          src={config.clips.coupleDrift}
          startAt={490}
          duration={170}
          zoom="in"
          driftX={0.8}
          brightness={0.85}
          overlay={0.2}
          overlayColor="#0D0805"
        />
      </MemoryBridge>

      {/* Scene 5-6: App demo — phone bg + Porizo flow (frames 640-1040) */}
      <MemoryBridge startAt={640} endAt={1040} fadeIn={35} fadeOut={30}>
        <CinematicImage
          src={config.clips.couplePhone}
          startAt={640}
          duration={400}
          zoom="in"
          driftX={0.5}
          brightness={0.65}
          overlay={0.25}
          overlayColor="#0A0A0A"
        />
        <AppFlowDemo
          startAt={670}
          duration={340}
          recipientName={config.appFlow.recipientName}
          occasion={config.appFlow.occasion}
          message={config.appFlow.message}
          songTitle={config.appFlow.songTitle}
        />
      </MemoryBridge>

      {/* ═══ BRANDING — persistent + contextual CTAs ═══ */}

      {/* 1. Persistent brand bug — top-left corner throughout (except end card) */}
      <Fade startAt={15} endAt={1130} fadeIn={20} fadeOut={15}>
        <div style={{
          position: 'absolute',
          top: 60,
          left: 40,
          fontFamily: fonts.display,
          fontSize: 28,
          fontWeight: 700,
          color: '#FFFFFF',
          opacity: 0.7,
          textShadow: '0 1px 8px rgba(0,0,0,0.6)',
          letterSpacing: '0.06em',
        }}>
          Porizo
        </div>
      </Fade>

      {/* 2. Bold hook branding — large "Porizo" over cushion area during counselor hook */}
      <Fade startAt={30} endAt={210} fadeIn={25} fadeOut={20}>
        <div style={{
          position: 'absolute',
          bottom: 520,
          left: 60,
          fontFamily: fonts.display,
          fontSize: 56,
          fontWeight: 700,
          color: '#FFFFFF',
          opacity: 0.9,
          textShadow: '0 2px 16px rgba(0,0,0,0.5)',
          letterSpacing: '0.08em',
        }}>
          Porizo
        </div>
        <div style={{
          position: 'absolute',
          bottom: 480,
          left: 62,
          fontFamily: fonts.body,
          fontSize: 18,
          color: '#FFFFFF',
          opacity: 0.7,
          textShadow: '0 1px 8px rgba(0,0,0,0.5)',
        }}>
          Turn your memories into a song
        </div>
      </Fade>

      {/* 3. App demo CTA — "Download free" below phone mockup */}
      <Fade startAt={750} endAt={1020} fadeIn={20} fadeOut={15}>
        <div style={{
          position: 'absolute',
          bottom: 140,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            fontFamily: fonts.body,
            fontSize: 20,
            fontWeight: 600,
            color: '#FFFFFF',
            textShadow: '0 2px 12px rgba(0,0,0,0.7)',
          }}>
            Download Porizo — it's free
          </div>
          <div style={{
            fontFamily: fonts.body,
            fontSize: 14,
            color: '#FFFFFF',
            opacity: 0.7,
            textShadow: '0 1px 6px rgba(0,0,0,0.5)',
          }}>
            Available on the App Store
          </div>
        </div>
      </Fade>

      {/* 4. Closing CTA — bold Porizo + download during counselor closing */}
      <Fade startAt={1040} endAt={1130} fadeIn={20} fadeOut={10}>
        <div style={{
          position: 'absolute',
          bottom: 300,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            fontFamily: fonts.display,
            fontSize: 52,
            fontWeight: 700,
            color: colors.gold,
            textShadow: '0 2px 20px rgba(0,0,0,0.5)',
            letterSpacing: '0.06em',
          }}>
            Porizo
          </div>
          <div style={{
            fontFamily: fonts.body,
            fontSize: 18,
            fontWeight: 600,
            color: '#FFFFFF',
            background: `${colors.gold}CC`,
            padding: '10px 28px',
            borderRadius: 12,
          }}>
            Download free on the App Store
          </div>
        </div>
      </Fade>

      {/* ═══ END CARD: CTA (frames 1130-1350) ═══ */}
      <Fade startAt={1130} endAt={1350} fadeIn={15} fadeOut={0}>
        <EndCard
          tagline={config.endTagline}
          startAt={1140}
        />
      </Fade>

      {/* ─── Audio Layer 2: Background music (starts at frame 220) ─── */}
      <Sequence from={220}>
        <Audio
          src={staticFile('audio/warm-piano.mp3')}
          volume={bgMusicVolume}
        />
      </Sequence>

      {/* ─── Audio Layer 3: Porizo sample song (starts at frame 900) ─── */}
      <Sequence from={900}>
        <Audio
          src={staticFile('audio/acoustic-indie.mp3')}
          volume={sampleSongVolume}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
