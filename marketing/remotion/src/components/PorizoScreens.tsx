import React from 'react';
import {useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {colors, fonts} from '../tokens';

/** Porizo occasion selection screen */
export const OccasionScreen: React.FC<{
  selectedOccasion?: string;
  highlightDelay?: number;
}> = ({selectedOccasion = 'anniversary', highlightDelay = 15}) => {
  const frame = useCurrentFrame();

  const occasions = [
    {emoji: '🎂', label: 'Birthday'},
    {emoji: '💍', label: 'Wedding'},
    {emoji: '❤️', label: 'Anniversary'},
    {emoji: '🙏', label: 'Thank You'},
    {emoji: '💕', label: 'I Love You'},
    {emoji: '🎓', label: 'Graduation'},
    {emoji: '🎉', label: 'Celebration'},
    {emoji: '✨', label: 'Custom'},
  ];

  return (
    <div style={{padding: '20px 16px', background: colors.background, height: '100%'}}>
      <div style={{
        fontFamily: fonts.display,
        fontSize: 22,
        color: colors.textPrimary,
        marginBottom: 24,
        textAlign: 'center',
      }}>
        What's the occasion?
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center'}}>
        {occasions.map((o, i) => {
          const isSelected = o.label.toLowerCase() === selectedOccasion.toLowerCase();
          const selectFrame = highlightDelay + i * 2;
          const highlighted = isSelected && frame > selectFrame;

          return (
            <div
              key={o.label}
              style={{
                padding: '10px 16px',
                borderRadius: 22,
                background: highlighted ? colors.gold : colors.surface,
                border: `0.5px solid ${highlighted ? colors.gold : colors.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.3s',
              }}
            >
              <span style={{fontSize: 14}}>{o.emoji}</span>
              <span style={{
                fontFamily: fonts.body,
                fontSize: 14,
                fontWeight: 500,
                color: highlighted ? colors.black : colors.textPrimary,
              }}>
                {o.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Porizo recipient name input screen */
export const NameInputScreen: React.FC<{
  name: string;
  occasion: string;
  typingStart?: number;
}> = ({name, occasion, typingStart = 0}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - typingStart;
  const charsVisible = Math.min(
    Math.max(0, Math.floor(localFrame * 0.6)),
    name.length
  );
  const visibleName = name.slice(0, charsVisible);
  const showCursor = charsVisible < name.length && localFrame % 16 < 10;

  return (
    <div style={{padding: '20px 16px', background: colors.background, height: '100%'}}>
      <div style={{
        fontFamily: fonts.display,
        fontSize: 22,
        color: colors.textPrimary,
        marginBottom: 8,
        textAlign: 'center',
      }}>
        Who is this for?
      </div>
      <div style={{
        fontFamily: fonts.body,
        fontSize: 13,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
      }}>
        {occasion}
      </div>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.gold}44`,
        borderRadius: 12,
        padding: '14px 16px',
        margin: '0 8px',
      }}>
        <span style={{
          fontFamily: fonts.body,
          fontSize: 18,
          color: visibleName ? colors.textPrimary : colors.textTertiary,
        }}>
          {visibleName || 'Their name...'}
        </span>
        {showCursor && (
          <span style={{
            display: 'inline-block',
            width: 2,
            height: 20,
            background: colors.gold,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
          }} />
        )}
      </div>
    </div>
  );
};

/** Voice recording progress screen */
export const RecordingScreen: React.FC<{
  progress?: number;
  phraseIndex?: number;
}> = ({progress = 0.6, phraseIndex = 4}) => {
  const frame = useCurrentFrame();
  const pulseScale = 1 + Math.sin(frame * 0.15) * 0.08;

  return (
    <div style={{
      padding: '20px 16px',
      background: colors.background,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
    }}>
      <div style={{
        fontFamily: fonts.display,
        fontSize: 18,
        color: colors.textPrimary,
      }}>
        Recording your voice
      </div>

      {/* Animated recording circle */}
      <div style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${colors.gold}33 0%, transparent 70%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${pulseScale})`,
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: colors.gold,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: colors.black,
          }} />
        </div>
      </div>

      {/* Progress dots */}
      <div style={{display: 'flex', gap: 8}}>
        {Array.from({length: 8}).map((_, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i < phraseIndex ? colors.gold : colors.border,
            }}
          />
        ))}
      </div>

      <div style={{
        fontFamily: fonts.body,
        fontSize: 13,
        color: colors.textSecondary,
      }}>
        Phrase {phraseIndex} of 8
      </div>
    </div>
  );
};

/** Story input screen with typewriter text */
export const StoryInputScreen: React.FC<{
  recipientName: string;
  occasion: string;
  message: string;
  typingStart?: number;
  placeholder?: string;
}> = ({
  recipientName,
  occasion,
  message,
  typingStart = 0,
  placeholder = 'Tell us your story...',
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - typingStart;
  const charsVisible = Math.min(
    Math.max(0, Math.floor(localFrame * 0.7)),
    message.length
  );
  const visibleText = message.slice(0, charsVisible);
  const showCursor = localFrame > 0 && charsVisible < message.length && localFrame % 16 < 10;

  return (
    <div style={{padding: '20px 16px', background: colors.background, height: '100%'}}>
      <div style={{
        fontFamily: fonts.display,
        fontSize: 20,
        color: colors.textPrimary,
        marginBottom: 4,
        textAlign: 'center',
      }}>
        Tell us about {recipientName}
      </div>
      <div style={{
        fontFamily: fonts.body,
        fontSize: 12,
        color: colors.gold,
        textAlign: 'center',
        marginBottom: 20,
      }}>
        {occasion}
      </div>
      <div style={{
        background: colors.surface,
        border: `0.5px solid ${colors.border}`,
        borderRadius: 12,
        padding: 16,
        minHeight: 160,
        margin: '0 4px',
      }}>
        <div style={{
          fontFamily: fonts.body,
          fontSize: 15,
          lineHeight: 1.6,
          color: visibleText ? colors.textPrimary : colors.textTertiary,
          whiteSpace: 'pre-wrap',
        }}>
          {visibleText || placeholder}
          {showCursor && (
            <span style={{
              display: 'inline-block',
              width: 2,
              height: 17,
              background: colors.gold,
              marginLeft: 1,
              verticalAlign: 'text-bottom',
            }} />
          )}
        </div>
      </div>
    </div>
  );
};

/** Preview player screen with waveform */
export const PreviewPlayerScreen: React.FC<{
  songTitle: string;
  recipientName: string;
  isPlaying?: boolean;
}> = ({songTitle, recipientName, isPlaying = true}) => {
  const frame = useCurrentFrame();

  return (
    <div style={{
      padding: '20px 16px',
      background: colors.background,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
    }}>
      {/* Album art */}
      <div style={{
        width: 200,
        height: 200,
        borderRadius: 20,
        background: `linear-gradient(135deg, ${colors.gold} 0%, ${colors.goldDark} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 8px 32px ${colors.gold}22`,
        border: `0.5px solid ${colors.gold}44`,
      }}>
        <span style={{fontSize: 64, opacity: 0.3}}>&#9835;</span>
      </div>

      {/* Song info */}
      <div style={{textAlign: 'center'}}>
        <div style={{
          fontFamily: fonts.body,
          fontSize: 16,
          fontWeight: 600,
          color: colors.textPrimary,
          marginBottom: 4,
        }}>
          {songTitle}
        </div>
        <div style={{
          fontFamily: fonts.body,
          fontSize: 13,
          color: colors.textSecondary,
        }}>
          For {recipientName}
        </div>
      </div>

      {/* Waveform */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 40,
        padding: '0 20px',
        width: '100%',
        justifyContent: 'center',
      }}>
        {Array.from({length: 40}).map((_, i) => {
          const baseHeight = 8 + Math.sin(i * 0.5) * 12 + Math.cos(i * 0.3) * 8;
          const animated = isPlaying
            ? baseHeight + Math.sin(frame * 0.2 + i * 0.4) * 6
            : baseHeight;
          return (
            <div
              key={i}
              style={{
                width: 3,
                height: Math.max(4, animated),
                borderRadius: 2,
                background: i < (frame * 0.3) % 40 ? colors.gold : colors.border,
              }}
            />
          );
        })}
      </div>

      {/* Play/pause button */}
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: colors.gold,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {isPlaying ? (
          <div style={{display: 'flex', gap: 4}}>
            <div style={{width: 4, height: 18, background: colors.black, borderRadius: 1}} />
            <div style={{width: 4, height: 18, background: colors.black, borderRadius: 1}} />
          </div>
        ) : (
          <div style={{
            width: 0, height: 0,
            borderTop: '10px solid transparent',
            borderBottom: '10px solid transparent',
            borderLeft: `16px solid ${colors.black}`,
            marginLeft: 3,
          }} />
        )}
      </div>
    </div>
  );
};
