import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {colors, fonts} from '../tokens';

interface EndCardProps {
  tagline?: string;
  startAt?: number;
}

export const EndCard: React.FC<EndCardProps> = ({
  tagline = 'Your voice, their song.',
  startAt = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startAt;

  if (localFrame < 0) return null;

  const logoScale = spring({
    frame: localFrame,
    fps,
    config: {damping: 15, stiffness: 80, mass: 0.6},
  });

  const taglineOpacity = interpolate(localFrame, [20, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const ctaOpacity = interpolate(localFrame, [40, 55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const glowPulse = 0.08 + Math.sin(localFrame * 0.06) * 0.04;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: colors.background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      {/* Subtle gold radial glow */}
      <div style={{
        position: 'absolute',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${colors.gold}${Math.round(glowPulse * 255).toString(16).padStart(2, '0')} 0%, transparent 60%)`,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />

      {/* Logo text */}
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 72,
          color: colors.gold,
          letterSpacing: '0.05em',
          transform: `scale(${interpolate(logoScale, [0, 1], [0.7, 1])})`,
          opacity: interpolate(logoScale, [0, 1], [0, 1]),
        }}
      >
        Porizo
      </div>

      {/* Tagline */}
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 22,
          color: colors.textSecondary,
          opacity: taglineOpacity,
          letterSpacing: '0.02em',
        }}
      >
        {tagline}
      </div>

      {/* CTA */}
      <div
        style={{
          marginTop: 20,
          opacity: ctaOpacity,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 16,
            fontWeight: 600,
            color: colors.black,
            background: colors.gold,
            padding: '12px 32px',
            borderRadius: 14,
          }}
        >
          Download free on the App Store
        </div>
      </div>
    </div>
  );
};
