import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Audio,
  staticFile,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import {colors, fonts} from '../tokens';
import {Fade, Vignette} from '../components/SceneTransition';

/**
 * "The Drive Home" V4 — 50s (1500 frames @ 30fps)
 *
 * HeyGen Agent visuals (muted) + Porizo song (Cafeteria Light) + branding + CTAs.
 * Best of both worlds: AI-generated cinematic footage with our actual product audio.
 *
 * Timeline:
 *   0-1260:    HeyGen video plays (42s) with Porizo song as audio
 *   1260-1380: "She recorded it in 2 minutes" reveal
 *   1380-1500: End card: Porizo logo + CTA
 *
 * The HeyGen video is 42s. We extend with our branded end sequence to 50s total.
 */

export const AdDriveHomeV4: React.FC = () => {
  const frame = useCurrentFrame();

  // HeyGen video ends at frame 1260 (42s * 30fps)
  const heygenEnd = 1260;

  return (
    <AbsoluteFill style={{background: '#0A0604'}}>

      {/* ═══ BASE: HeyGen video — MUTED ═══ */}
      <OffthreadVideo
        src={staticFile('stock/drive-home/heygen-base.mp4')}
        volume={0}
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
      />

      {/* ═══ BRANDING: Porizo logo — top-left throughout video ═══ */}
      <Fade startAt={30} endAt={heygenEnd} fadeIn={20} fadeOut={15}>
        <div style={{
          position: 'absolute', top: 60, left: 40,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            fontFamily: fonts.display, fontSize: 28, fontWeight: 700,
            color: colors.gold, letterSpacing: '0.06em',
            textShadow: '0 2px 12px rgba(0,0,0,0.7)',
          }}>
            Porizo
          </div>
        </div>
      </Fade>

      {/* ═══ CTA 1: Early hint (8-14s / frames 240-420) ═══ */}
      <Fade startAt={240} endAt={420} fadeIn={15} fadeOut={15}>
        <div style={{
          position: 'absolute', bottom: 100, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            fontFamily: fonts.body, fontSize: 15, fontWeight: 600,
            color: '#FFFFFF', background: 'rgba(0,0,0,0.5)',
            padding: '8px 20px', borderRadius: 10,
            backdropFilter: 'blur(8px)',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            Made with Porizo
          </div>
        </div>
      </Fade>

      {/* ═══ CTA 2: Mid-point download prompt (20-28s / frames 600-840) ═══ */}
      <Fade startAt={600} endAt={840} fadeIn={15} fadeOut={15}>
        <div style={{
          position: 'absolute', bottom: 100, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            fontFamily: fonts.body, fontSize: 16, fontWeight: 600,
            color: colors.black, background: colors.gold,
            padding: '10px 24px', borderRadius: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            Create a song like this
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 12, color: '#FFFFFF', opacity: 0.7,
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
          }}>
            Download Porizo — Free
          </div>
        </div>
      </Fade>

      {/* ═══ CTA 3: Emotional peak download (34-40s / frames 1020-1200) ═══ */}
      <Fade startAt={1020} endAt={1200} fadeIn={15} fadeOut={15}>
        <div style={{
          position: 'absolute', bottom: 100, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            fontFamily: fonts.body, fontSize: 17, fontWeight: 600,
            color: colors.black, background: colors.gold,
            padding: '10px 28px', borderRadius: 12,
            boxShadow: '0 4px 20px rgba(212,165,116,0.3)',
          }}>
            Sing them a song — Download Porizo
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 12, color: '#FFFFFF', opacity: 0.7,
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
          }}>
            Available on the App Store
          </div>
        </div>
      </Fade>

      {/* ═══ SCENE: The reveal (42-46s / frames 1260-1380) ═══ */}
      <Fade startAt={heygenEnd} endAt={1380} fadeIn={15} fadeOut={15}>
        <AbsoluteFill style={{
          background: '#0A0604',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 28,
        }}>
          <div style={{
            fontFamily: fonts.display, fontSize: 32, color: '#FFFFFF',
            textAlign: 'center', lineHeight: 1.6,
            opacity: interpolate(frame, [heygenEnd + 15, heygenEnd + 35], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
          }}>
            She recorded it in 2 minutes.
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 20, color: colors.textSecondary,
            opacity: interpolate(frame, [heygenEnd + 50, heygenEnd + 70], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            }),
          }}>
            He'll remember it forever.
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ═══ END CARD (46-50s / frames 1380-1500) ═══ */}
      <Fade startAt={1380} endAt={1500} fadeIn={12} fadeOut={0}>
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
            opacity: interpolate(frame, [1395, 1415], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
            transform: `scale(${interpolate(frame, [1395, 1415], [0.8, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`,
          }}>
            Porizo
          </div>
          <div style={{
            fontFamily: fonts.body, fontSize: 22, color: colors.textSecondary,
            opacity: interpolate(frame, [1420, 1440], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}>
            Your moment, in a song.
          </div>
          <div style={{
            marginTop: 20,
            opacity: interpolate(frame, [1445, 1465], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
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

      {/* ═══ VIGNETTE ═══ */}
      <Vignette intensity={0.3} />

      {/* ═══ AUDIO: Cafeteria Light — our actual Porizo song ═══ */}
      <Audio
        src={staticFile('audio/cafeteria-light-trimmed.mp3')}
        volume={(f) => interpolate(
          f, [0, 15, 1260, 1380],
          [0, 0.75, 0.75, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        )}
      />
    </AbsoluteFill>
  );
};
