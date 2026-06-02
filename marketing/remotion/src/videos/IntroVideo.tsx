import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Audio,
  staticFile,
} from 'remotion';
import {colors, fonts, FPS} from '../tokens';
import {TextReveal} from '../components/TextReveal';
import {PhoneMockup} from '../components/PhoneMockup';
import {
  OccasionScreen,
  StoryInputScreen,
  PreviewPlayerScreen,
} from '../components/PorizoScreens';
import {EndCard} from '../components/EndCard';
import {Fade, GradientBg, Vignette} from '../components/SceneTransition';
import {ChatMessage} from '../components/ChatMessage';
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

/** Scale-pop text with spring entrance */
const PopText: React.FC<{
  text: string;
  startAt: number;
  duration: number;
  fontSize?: number;
  color?: string;
  y?: number;
  italic?: boolean;
}> = ({text, startAt, duration, fontSize = 40, color = colors.textPrimary, y = 0, italic = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - startAt;
  if (localFrame < 0 || localFrame > duration) return null;

  const pop = spring({frame: localFrame, fps, config: {damping: 12, stiffness: 120, mass: 0.5}});
  const fadeOut = interpolate(localFrame, [duration - 12, duration], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <div style={{
      position: 'absolute',
      top: `calc(50% + ${y}px)`,
      left: '50%',
      transform: `translate(-50%, -50%) scale(${interpolate(pop, [0, 1], [0.7, 1])})`,
      fontFamily: italic ? fonts.display : fonts.body,
      fontStyle: italic ? 'italic' : 'normal',
      fontSize,
      fontWeight: 700,
      color,
      opacity: pop * fadeOut,
      textAlign: 'center',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
  );
};

/** Quick-cut photo with overlay */
const PhotoFlash: React.FC<{
  src: string;
  startAt: number;
  duration: number;
  zoom?: 'in' | 'out';
  children?: React.ReactNode;
}> = ({src, startAt, duration, zoom = 'in', children}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startAt;
  if (localFrame < 0 || localFrame > duration) return null;

  const opacity = interpolate(localFrame, [0, 5, duration - 10, duration], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      <PhotoScene src={src} zoom={zoom} overlay={0.55} overlayColor="#0D0805" brightness={0.65} startAt={startAt} duration={duration}>
        {children}
      </PhotoScene>
    </div>
  );
};

export const IntroVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: colors.background}}>
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={interpolate(frame, [0, 15, 1120, 1200], [0, 0.45, 0.45, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
      />

      {/* ══════════════════════════════════════════
          ACT 1: THE HOOK (0-360)
          ══════════════════════════════════════════ */}

      <PopText text="Think about someone you love." startAt={8} duration={55} fontSize={38} color={colors.textPrimary} italic />

      {/* Photo montage — clean cuts */}
      <PhotoFlash src="photos/old-couple.jpg" startAt={70} duration={55} zoom="out">
        <Vignette intensity={0.5} />
      </PhotoFlash>
      <PopText text="A lifetime together." startAt={78} duration={42} fontSize={32} y={320} color={colors.gold} />

      <PhotoFlash src="photos/girl-smile.jpg" startAt={125} duration={50} zoom="in">
        <Vignette intensity={0.5} />
      </PhotoFlash>
      <PopText text="A first date." startAt={133} duration={38} fontSize={32} y={320} color={colors.gold} />

      <PhotoFlash src="photos/friends-group.jpg" startAt={175} duration={50} zoom="out">
        <Vignette intensity={0.5} />
      </PhotoFlash>
      <PopText text="An old friendship." startAt={183} duration={38} fontSize={32} y={320} color={colors.gold} />

      {/* The pivot */}
      <Fade startAt={240} endAt={360} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <PopText text="What if your voice" startAt={260} duration={85} fontSize={42} y={-30} color={colors.textPrimary} />
          <GoldLine y={20} startAt={290} width={220} />
          <PopText text="could say what words can't?" startAt={295} duration={60} fontSize={48} y={60} color={colors.gold} italic />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ══════════════════════════════════════════
          ACT 2: THE MAGIC (340-720)
          ══════════════════════════════════════════ */}

      {/* Porizo logo */}
      <Fade startAt={340} endAt={400} fadeIn={10} fadeOut={12}>
        <AbsoluteFill style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          {(() => {
            const localFrame = frame - 348;
            if (localFrame < 0) return null;
            const s = spring({frame: localFrame, fps, config: {damping: 14, stiffness: 100, mass: 0.5}});
            return (
              <div style={{
                fontFamily: fonts.display,
                fontSize: 72,
                color: colors.gold,
                letterSpacing: '0.05em',
                transform: `scale(${interpolate(s, [0, 1], [0.6, 1])})`,
                opacity: s,
              }}>
                Porizo
              </div>
            );
          })()}
        </AbsoluteFill>
      </Fade>

      {/* Step 1: Pick the moment */}
      <Fade startAt={390} endAt={510} fadeIn={12} fadeOut={12}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={colors.background} />
          <PhoneMockup startAt={395} scale={0.82} y={-10}>
            <OccasionScreen selectedOccasion="birthday" highlightDelay={20} />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* Step 2: Tell the story */}
      <Fade startAt={500} endAt={640} fadeIn={12} fadeOut={12}>
        <AbsoluteFill>
          <GradientBg color1={colors.background} color2="#0D0805" />
          <PhoneMockup startAt={505} scale={0.82} y={-10}>
            <StoryInputScreen
              recipientName="Mom"
              occasion="Birthday"
              message="Mom, you taught me that love isn't something you say — it's something you do. Every packed lunch, every quiet sacrifice."
              typingStart={525}
              placeholder="What makes Mom special?"
            />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* Step 3: Hear YOUR voice */}
      <Fade startAt={630} endAt={720} fadeIn={12} fadeOut={12}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={colors.background} />
          <PhoneMockup startAt={635} scale={0.82} y={-10}>
            <PreviewPlayerScreen songTitle="A Song for Mom" recipientName="Mom" isPlaying={true} />
          </PhoneMockup>
          <Particles count={4} color={colors.gold} speed={0.1} size={2} />
        </AbsoluteFill>
      </Fade>

      {/* ══════════════════════════════════════════
          ACT 3: THE PAYOFF (700-1050)
          ══════════════════════════════════════════ */}

      {/* Reaction 1: Mom */}
      <Fade startAt={710} endAt={830} fadeIn={10} fadeOut={10}>
        <PhotoScene src="photos/morning-coffee.jpg" zoom="in" overlay={0.6} overlayColor="#0D0805" brightness={0.55} startAt={710} duration={120}>
          <div style={{
            position: 'absolute',
            top: '28%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage
              text="I made this for you"
              isMe={true}
              startAt={725}
              linkPreview={{title: 'A Song for Mom', subtitle: 'porizo.co/share'}}
            />
            <ChatMessage text="This is the best gift I've ever gotten" sender="Mom" isMe={false} startAt={770} />
          </div>
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* Reaction 2: The date */}
      <Fade startAt={820} endAt={920} fadeIn={8} fadeOut={10}>
        <PhotoScene src="photos/girl-smile.jpg" zoom="out" overlay={0.6} overlayColor="#0D0805" brightness={0.5} startAt={820} duration={100}>
          <div style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage text="Wait is that YOUR voice??" sender="Amara" isMe={false} startAt={838} />
            <ChatMessage text="Pick me up at 8 :)" sender="Amara" isMe={false} startAt={873} />
          </div>
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* Reaction 3: The boys */}
      <Fade startAt={910} endAt={1010} fadeIn={8} fadeOut={10}>
        <PhotoScene src="photos/campfire.jpg" zoom="in" overlay={0.6} overlayColor="#0D0805" brightness={0.5} startAt={910} duration={100}>
          <div style={{
            position: 'absolute',
            top: '28%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 8px',
          }}>
            <ChatMessage text="BRO" sender="Marcus" isMe={false} startAt={925} />
            <ChatMessage text="HOW IS THAT YOUR VOICE" sender="Tyler" isMe={false} startAt={950} />
            <ChatMessage text="yo get on FaceTime RIGHT NOW" sender="Marcus" isMe={false} startAt={975} />
          </div>
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* Emotional closer */}
      <Fade startAt={1010} endAt={1100} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <PopText text="Your voice." startAt={1025} duration={60} fontSize={50} y={-30} color={colors.textPrimary} />
          <GoldLine y={20} startAt={1050} width={200} />
          <PopText text="Their song." startAt={1055} duration={45} fontSize={56} y={60} color={colors.gold} italic />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ══════════════════════════════════════════
          OUTRO (1080-1200)
          ══════════════════════════════════════════ */}
      <Fade startAt={1080} endAt={1200} fadeIn={12} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={6} color={colors.gold} speed={0.05} size={2} />
          <EndCard tagline="Turn your moments into music." startAt={1088} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
