import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  Audio,
  Img,
  staticFile,
  useCurrentFrame,
  interpolate,
} from 'remotion';
import {PhotoScene} from '../components/PhotoScene';
import {TextReveal} from '../components/TextReveal';
import {EndCard} from '../components/EndCard';
import {colors, fonts, warmPalette} from '../tokens';

/**
 * Ad-FathersDay-Product — 9:16 Reels video (1080×1920, 13s / 390f @ 30fps)
 *
 * The MOTION version of the winning static ad FD_v2_A_Product (CPI A$3.08).
 * Same hero image, copy, and gold-serif brand language as the still that
 * converts — built for Meta Reels placement (Opportunity-Score rec: add a
 * fullscreen 9:16 video with audio).
 *
 * Scene 1 (0–165)   bike photo, Ken-Burns zoom, kicker + "Memories, in a song."
 * Scene 2 (165–290) darkened photo + animated "now playing" song card
 * Scene 3 (290–390) Porizo end card (logo + App Store CTA)
 */

const HERO = 'stock/drive-home/04-father-daughter-bike.png';

/** Animated "now playing" card — implies the personalized song is playing. */
const SongCard: React.FC = () => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 22], [60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const progress = interpolate(frame, [10, 125], [0.04, 0.62], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bars = Array.from({length: 30}, (_, i) => {
    const h = 14 + Math.abs(Math.sin(frame * 0.18 + i * 0.55)) * 46;
    return h;
  });

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div
        style={{
          transform: `translateY(${rise}px)`,
          opacity,
          width: 760,
          background: 'rgba(20,14,9,0.82)',
          border: `1px solid ${warmPalette.accent}55`,
          borderRadius: 34,
          padding: '40px 44px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
          {/* album thumb */}
          <div
            style={{
              width: 132,
              height: 132,
              borderRadius: 22,
              overflow: 'hidden',
              flex: '0 0 auto',
              border: `1px solid ${warmPalette.accent}40`,
            }}
          >
            <Img
              src={staticFile(HERO)}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          </div>
          <div style={{flex: 1}}>
            <div
              style={{
                fontFamily: fonts.body,
                fontSize: 22,
                letterSpacing: '0.18em',
                color: warmPalette.accent,
                marginBottom: 8,
              }}
            >
              NOW PLAYING
            </div>
            <div
              style={{
                fontFamily: fonts.display,
                fontSize: 52,
                color: colors.textPrimary,
                lineHeight: 1.05,
              }}
            >
              For Dad
            </div>
            <div
              style={{
                fontFamily: fonts.body,
                fontSize: 26,
                color: colors.textSecondary,
                marginTop: 6,
              }}
            >
              made by Maya · 0:48
            </div>
          </div>
        </div>

        {/* waveform */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 64,
            marginTop: 30,
          }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: h,
                borderRadius: 4,
                background:
                  i / bars.length < progress
                    ? warmPalette.warmGlow
                    : `${warmPalette.accent}55`,
              }}
            />
          ))}
        </div>
      </div>

      {/* subhead under the card */}
      <div
        style={{
          opacity,
          marginTop: 40,
          maxWidth: 820,
          textAlign: 'center',
          fontFamily: fonts.body,
          fontSize: 32,
          lineHeight: 1.35,
          color: colors.textPrimary,
          textShadow: '0 2px 18px rgba(0,0,0,0.6)',
        }}
      >
        A personalized song — sung in your voice.
      </div>
    </AbsoluteFill>
  );
};

export const AdFathersDayProduct: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: colors.background}}>
      {/* ─── Scene 1: hero photo + headline ─── */}
      <Sequence from={0} durationInFrames={165}>
        <PhotoScene
          src={HERO}
          zoom="in"
          overlay={0.46}
          overlayColor={warmPalette.bg}
          brightness={0.9}
          duration={165}
        />
        <TextReveal
          text="PORIZO · SONG GIFT MAKER"
          startAt={10}
          duration={150}
          fontSize={28}
          fontFamily={fonts.body}
          color={warmPalette.accent}
          y={-770}
          textShadow="0 2px 16px rgba(0,0,0,0.7)"
        />
        <TextReveal
          text="Memories,"
          startAt={34}
          duration={130}
          fontSize={92}
          fontFamily={fonts.display}
          color={colors.white}
          y={430}
          textShadow="0 3px 24px rgba(0,0,0,0.8)"
        />
        <TextReveal
          text="in a song."
          startAt={52}
          duration={112}
          fontSize={92}
          fontFamily={fonts.display}
          color={warmPalette.warmGlow}
          y={545}
          textShadow="0 3px 24px rgba(0,0,0,0.8)"
        />
      </Sequence>

      {/* ─── Scene 2: now-playing song card ─── */}
      <Sequence from={165} durationInFrames={125}>
        <PhotoScene
          src={HERO}
          zoom="in"
          overlay={0.7}
          overlayColor={warmPalette.bg}
          brightness={0.8}
          duration={125}
        />
        <SongCard />
      </Sequence>

      {/* ─── Scene 3: brand end card + CTA ─── */}
      <Sequence from={290} durationInFrames={100}>
        <EndCard tagline="Forget flowers. Make him a song." />
      </Sequence>

      {/* ─── Music bed ─── */}
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={(f) =>
          interpolate(f, [0, 30, 360, 390], [0, 0.5, 0.5, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </AbsoluteFill>
  );
};
