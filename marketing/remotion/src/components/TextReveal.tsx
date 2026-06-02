import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {fonts, colors} from '../tokens';

interface TextRevealProps {
  text: string;
  startAt?: number;
  duration?: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  maxWidth?: number;
  textAlign?: 'left' | 'center' | 'right';
  y?: number;
  textShadow?: string;
}

export const TextReveal: React.FC<TextRevealProps> = ({
  text,
  startAt = 0,
  duration = 30,
  fontSize = 48,
  color = colors.textPrimary,
  fontFamily = fonts.display,
  fontWeight = 'normal',
  fontStyle = 'normal',
  maxWidth = 800,
  textAlign = 'center',
  y = 0,
  textShadow,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startAt;

  if (localFrame < 0 || localFrame > duration + 30) return null;

  const opacity = interpolate(
    localFrame,
    [0, 12, duration, duration + 20],
    [0, 1, 1, 0],
    {extrapolateRight: 'clamp'}
  );

  const translateY = spring({
    frame: localFrame,
    fps,
    config: {damping: 20, stiffness: 80, mass: 0.8},
  });

  const yOffset = interpolate(translateY, [0, 1], [30, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) translateY(${y + yOffset}px)`,
        opacity,
        fontFamily,
        fontSize,
        fontWeight,
        fontStyle,
        color,
        textAlign,
        maxWidth,
        lineHeight: 1.3,
        letterSpacing: '-0.02em',
        ...(textShadow ? {textShadow} : {}),
      }}
    >
      {text}
    </div>
  );
};

/** Typewriter-style text that appears character by character */
export const TypewriterText: React.FC<{
  text: string;
  startAt?: number;
  charsPerFrame?: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  x?: number;
  y?: number;
  maxWidth?: number;
  cursor?: boolean;
}> = ({
  text,
  startAt = 0,
  charsPerFrame = 0.8,
  fontSize = 24,
  color = colors.textPrimary,
  fontFamily = fonts.body,
  x = 0,
  y = 0,
  maxWidth = 600,
  cursor = true,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startAt;

  if (localFrame < 0) return null;

  const charsVisible = Math.min(
    Math.floor(localFrame * charsPerFrame),
    text.length
  );
  const visibleText = text.slice(0, charsVisible);
  const showCursor = cursor && charsVisible < text.length && localFrame % 16 < 10;

  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(50% + ${x}px)`,
        top: `calc(50% + ${y}px)`,
        transform: 'translate(-50%, -50%)',
        fontFamily,
        fontSize,
        color,
        maxWidth,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      {visibleText}
      {showCursor && (
        <span style={{
          display: 'inline-block',
          width: 2,
          height: fontSize * 1.1,
          backgroundColor: color,
          marginLeft: 2,
          verticalAlign: 'text-bottom',
        }} />
      )}
    </div>
  );
};
