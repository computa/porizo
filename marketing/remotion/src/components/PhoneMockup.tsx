import React from 'react';
import {useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {colors} from '../tokens';

interface PhoneMockupProps {
  children: React.ReactNode;
  startAt?: number;
  scale?: number;
  x?: number;
  y?: number;
}

/** iPhone-style frame that wraps app screen content */
export const PhoneMockup: React.FC<PhoneMockupProps> = ({
  children,
  startAt = 0,
  scale = 0.85,
  x = 0,
  y = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startAt;

  if (localFrame < 0) return null;

  const entrance = spring({
    frame: localFrame,
    fps,
    config: {damping: 18, stiffness: 60, mass: 1},
  });

  const opacity = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const phoneY = interpolate(entrance, [0, 1], [60, 0]);

  const phoneWidth = 320;
  const phoneHeight = 692;
  const borderRadius = 44;
  const bezelWidth = 8;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) translate(${x}px, ${y + phoneY}px) scale(${scale})`,
        opacity,
        width: phoneWidth + bezelWidth * 2,
        height: phoneHeight + bezelWidth * 2,
        borderRadius: borderRadius + bezelWidth,
        background: '#2A2A2A',
        boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(212,165,116,0.08)`,
        padding: bezelWidth,
      }}
    >
      {/* Screen */}
      <div
        style={{
          width: phoneWidth,
          height: phoneHeight,
          borderRadius,
          overflow: 'hidden',
          background: colors.background,
          position: 'relative',
        }}
      >
        {/* Status bar */}
        <div style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: colors.background,
        }}>
          <span style={{color: colors.textPrimary, fontSize: 14, fontWeight: 600}}>9:41</span>
          <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
            <div style={{width: 16, height: 10, border: `1px solid ${colors.textSecondary}`, borderRadius: 2, position: 'relative'}}>
              <div style={{position: 'absolute', right: 1, top: 1, bottom: 1, left: 1, background: colors.textPrimary, borderRadius: 1, width: '80%'}} />
            </div>
          </div>
        </div>

        {/* Dynamic island */}
        <div style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 120,
          height: 34,
          borderRadius: 20,
          background: '#000',
        }} />

        {/* Content area */}
        <div style={{
          position: 'relative',
          height: phoneHeight - 48,
          overflow: 'hidden',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};
