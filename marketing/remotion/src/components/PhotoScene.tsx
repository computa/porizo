import React from 'react';
import {
  useCurrentFrame,
  interpolate,
  Img,
  staticFile,
} from 'remotion';

interface PhotoSceneProps {
  src: string;
  /** Slow zoom: 'in' starts normal and zooms in, 'out' starts zoomed and pulls out */
  zoom?: 'in' | 'out' | 'none';
  /** Dark overlay opacity 0-1 */
  overlay?: number;
  /** Overlay color */
  overlayColor?: string;
  /** Blur the photo (px) */
  blur?: number;
  /** Brightness multiplier */
  brightness?: number;
  /** Start frame for zoom animation */
  startAt?: number;
  /** Duration of the zoom */
  duration?: number;
  children?: React.ReactNode;
}

/** Full-screen photo background with cinematic effects */
export const PhotoScene: React.FC<PhotoSceneProps> = ({
  src,
  zoom = 'in',
  overlay = 0.5,
  overlayColor = '#000000',
  blur = 0,
  brightness = 0.8,
  startAt = 0,
  duration = 150,
  children,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startAt;

  const scale = zoom === 'none'
    ? 1.1
    : zoom === 'in'
      ? interpolate(localFrame, [0, duration], [1.0, 1.15], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
      : interpolate(localFrame, [0, duration], [1.15, 1.0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      <Img
        src={staticFile(src)}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
          filter: `brightness(${brightness})${blur > 0 ? ` blur(${blur}px)` : ''}`,
        }}
      />
      {/* Dark overlay for text readability */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: overlayColor,
        opacity: overlay,
      }} />
      {children}
    </div>
  );
};

/** Floating particles for visual richness */
export const Particles: React.FC<{
  count?: number;
  color?: string;
  speed?: number;
  size?: number;
}> = ({count = 20, color = '#D4A574', speed = 0.3, size = 3}) => {
  const frame = useCurrentFrame();

  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden'}}>
      {Array.from({length: count}).map((_, i) => {
        // Deterministic pseudo-random positions using index
        const baseX = ((i * 73.7 + 17.3) % 100);
        const baseY = ((i * 43.1 + 67.9) % 100);
        const drift = Math.sin(frame * speed * 0.02 + i * 1.7) * 20;
        const yDrift = -frame * speed * 0.5 + i * 50;
        const opacity = 0.15 + Math.sin(frame * 0.03 + i * 2.1) * 0.1;
        const particleSize = size + Math.sin(i * 1.3) * (size * 0.5);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${baseX}%`,
              top: `${((baseY * 10 + yDrift) % 120) - 10}%`,
              width: particleSize,
              height: particleSize,
              borderRadius: '50%',
              background: color,
              opacity,
              transform: `translateX(${drift}px)`,
              boxShadow: `0 0 ${particleSize * 2}px ${color}44`,
            }}
          />
        );
      })}
    </div>
  );
};

/** Animated gold line separator */
export const GoldLine: React.FC<{
  y?: number;
  startAt?: number;
  width?: number;
}> = ({y = 0, startAt = 0, width = 200}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startAt;
  if (localFrame < 0) return null;

  const lineWidth = interpolate(localFrame, [0, 20], [0, width], {
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(localFrame, [0, 10, 80, 100], [0, 0.6, 0.6, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{
      position: 'absolute',
      top: `calc(50% + ${y}px)`,
      left: '50%',
      transform: 'translateX(-50%)',
      width: lineWidth,
      height: 1,
      background: 'linear-gradient(90deg, transparent, #D4A574, transparent)',
      opacity,
    }} />
  );
};
