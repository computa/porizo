import React from 'react';
import {useCurrentFrame, interpolate} from 'remotion';

interface FadeProps {
  children: React.ReactNode;
  startAt: number;
  endAt: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** Fade a scene in and out at specific frame ranges */
export const Fade: React.FC<FadeProps> = ({
  children,
  startAt,
  endAt,
  fadeIn = 10,
  fadeOut = 10,
}) => {
  const frame = useCurrentFrame();

  if (frame < startAt - 1 || frame > endAt + 1) return null;

  // Build strictly monotonic input range — avoid duplicates when fadeIn/fadeOut is 0
  const safeIn = Math.max(fadeIn, 1);
  const safeOut = Math.max(fadeOut, 1);
  const opacity = interpolate(
    frame,
    [startAt, startAt + safeIn, endAt - safeOut, endAt],
    [fadeIn === 0 ? 1 : 0, 1, 1, fadeOut === 0 ? 1 : 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );

  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      {children}
    </div>
  );
};

/** Gradient background that can animate between colors */
export const GradientBg: React.FC<{
  color1: string;
  color2: string;
  angle?: number;
}> = ({color1, color2, angle = 135}) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(${angle}deg, ${color1} 0%, ${color2} 100%)`,
      }}
    />
  );
};

/** Film grain overlay for vintage feel */
export const FilmGrain: React.FC<{opacity?: number}> = ({opacity = 0.04}) => {
  const frame = useCurrentFrame();
  // Pseudo-random grain using frame number
  const seed = frame * 127.1;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' seed='${Math.floor(seed)}' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        backgroundSize: '150px 150px',
        pointerEvents: 'none',
      }}
    />
  );
};

/** Vignette overlay for cinematic edges */
export const Vignette: React.FC<{intensity?: number}> = ({intensity = 0.6}) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${intensity}) 100%)`,
        pointerEvents: 'none',
      }}
    />
  );
};
