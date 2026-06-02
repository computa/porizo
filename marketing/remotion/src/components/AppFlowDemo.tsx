import React from 'react';
import {Sequence} from 'remotion';
import {PhoneMockup} from './PhoneMockup';
import {OccasionScreen, StoryInputScreen, PreviewPlayerScreen} from './PorizoScreens';
import {Fade} from './SceneTransition';

interface AppFlowDemoProps {
  startAt: number;
  duration: number;
  recipientName: string;
  occasion: string;
  message: string;
  songTitle: string;
}

/**
 * Animated sequence showing the Porizo song creation flow inside a PhoneMockup.
 * Uses Sequence to reset useCurrentFrame() so PorizoScreens typewriter
 * animations start from 0 relative to the demo start.
 *
 * Internal timeline (~310 frames):
 *   0-100:   OccasionScreen with occasion highlighted
 *   85-210:  StoryInputScreen with message typing
 *   195-310: PreviewPlayerScreen with song playing
 */
export const AppFlowDemo: React.FC<AppFlowDemoProps> = ({
  startAt,
  duration,
  recipientName,
  occasion,
  message,
  songTitle,
}) => {
  return (
    <Sequence from={startAt} durationInFrames={duration}>
      <PhoneMockup startAt={0} scale={0.9}>
        {/* Screen 1: Occasion picker — highlight after 15 local frames */}
        <Fade startAt={0} endAt={100} fadeIn={0} fadeOut={15}>
          <OccasionScreen selectedOccasion={occasion} highlightDelay={15} />
        </Fade>

        {/* Screen 2: Story typing — starts at local frame 90 */}
        <Fade startAt={85} endAt={210} fadeIn={12} fadeOut={15}>
          <StoryInputScreen
            recipientName={recipientName}
            occasion={occasion}
            message={message}
            typingStart={90}
          />
        </Fade>

        {/* Screen 3: Preview player with animated waveform */}
        <Fade startAt={195} endAt={duration} fadeIn={12} fadeOut={0}>
          <PreviewPlayerScreen
            songTitle={songTitle}
            recipientName={recipientName}
            isPlaying={true}
          />
        </Fade>
      </PhoneMockup>
    </Sequence>
  );
};
