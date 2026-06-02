import React from 'react';
import {useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {colors, fonts} from '../tokens';

interface ChatMessageProps {
  text: string;
  sender?: string;
  isMe?: boolean;
  startAt?: number;
  /** Optional link preview card */
  linkPreview?: {
    title: string;
    subtitle: string;
  };
}

/** iMessage-style chat bubble */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  text,
  sender,
  isMe = false,
  startAt = 0,
  linkPreview,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startAt;

  if (localFrame < 0) return null;

  const entrance = spring({
    frame: localFrame,
    fps,
    config: {damping: 14, stiffness: 100, mass: 0.5},
  });

  const scale = interpolate(entrance, [0, 1], [0.6, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const translateY = interpolate(entrance, [0, 1], [20, 0]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMe ? 'flex-end' : 'flex-start',
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        transformOrigin: isMe ? 'bottom right' : 'bottom left',
        marginBottom: 8,
      }}
    >
      {sender && (
        <div style={{
          fontFamily: fonts.body,
          fontSize: 11,
          color: colors.textTertiary,
          marginBottom: 3,
          paddingLeft: isMe ? 0 : 4,
          paddingRight: isMe ? 4 : 0,
        }}>
          {sender}
        </div>
      )}
      <div
        style={{
          maxWidth: 240,
          padding: linkPreview ? '0' : '10px 14px',
          borderRadius: 18,
          background: isMe ? colors.gold : colors.surface,
          color: isMe ? colors.black : colors.textPrimary,
          fontFamily: fonts.body,
          fontSize: 15,
          lineHeight: 1.4,
          overflow: 'hidden',
        }}
      >
        {linkPreview && (
          <div style={{
            background: colors.surfaceLight,
            padding: '12px 14px',
            borderBottom: `0.5px solid ${colors.border}`,
          }}>
            <div style={{
              fontFamily: fonts.body,
              fontSize: 13,
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: 2,
            }}>
              {linkPreview.title}
            </div>
            <div style={{
              fontFamily: fonts.body,
              fontSize: 11,
              color: colors.textSecondary,
            }}>
              {linkPreview.subtitle}
            </div>
          </div>
        )}
        <div style={{padding: linkPreview ? '10px 14px' : 0}}>
          {text}
        </div>
      </div>
    </div>
  );
};

/** Group chat container showing multiple messages */
export const GroupChat: React.FC<{
  children: React.ReactNode;
  startAt?: number;
}> = ({children, startAt = 0}) => {
  const frame = useCurrentFrame();
  if (frame < startAt) return null;

  return (
    <div style={{
      background: colors.background,
      height: '100%',
      padding: '60px 16px 20px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
};
