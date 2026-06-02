import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Audio,
  staticFile,
} from 'remotion';
import {colors, fonts, urbanPalette, FPS} from '../tokens';
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

/**
 * Video 2 V2: "Say It Different" — Minimalist, memory-forward
 * 50 seconds at 30fps = 1500 frames
 *
 * Clean screens. One thought at a time. Let the emotion land.
 */
export const Video2SayItDifferentV2: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: urbanPalette.bg}}>
      <Audio
        src={staticFile('audio/lofi-beat.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1410, 1500],
          [0, 0.35, 0.35, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Staring at phone (0-150) ═══ */}
      <Fade startAt={0} endAt={150} fadeIn={8} fadeOut={20}>
        <PhotoScene
          src="photos/guy-phone.jpg"
          zoom="in"
          overlay={0.6}
          overlayColor="#0A0A14"
          brightness={0.6}
          duration={150}
        >
          <div style={{
            position: 'absolute',
            bottom: '28%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 280,
          }}>
            <div style={{
              background: `${colors.surface}CC`,
              borderRadius: 22,
              padding: '12px 16px',
              border: `0.5px solid ${colors.border}`,
            }}>
              {(() => {
                const cycle = frame % 80;
                let text = '';
                if (cycle < 20) text = 'h';
                else if (cycle < 30) text = 'he';
                else if (cycle < 40) text = 'hey';
                else if (cycle < 55) text = 'hey';
                else if (cycle < 65) text = 'he';
                else if (cycle < 72) text = 'h';
                return (
                  <span style={{
                    fontFamily: fonts.body,
                    fontSize: 15,
                    color: text ? colors.textPrimary : colors.textTertiary,
                  }}>
                    {text || 'Message...'}
                    <span style={{
                      display: 'inline-block',
                      width: 2,
                      height: 17,
                      background: urbanPalette.neon,
                      marginLeft: 1,
                      verticalAlign: 'text-bottom',
                      opacity: frame % 20 < 12 ? 1 : 0,
                    }} />
                  </span>
                );
              })()}
            </div>
          </div>
          <Vignette intensity={0.7} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 2: What he remembers about her (130-310) ═══ */}
      <Fade startAt={130} endAt={310} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/girl-smile.jpg"
          zoom="out"
          overlay={0.55}
          overlayColor="#0A0A14"
          brightness={0.6}
          startAt={130}
          duration={180}
        >
          {[
            {text: 'The way she laughs', delay: 0, y: -60},
            {text: 'How she steals his fries', delay: 50, y: 20},
            {text: '"You make me feel safe"', delay: 100, y: 100},
          ].map((mem, i) => {
            const memFrame = frame - 175 - mem.delay;
            const opacity = memFrame > 0
              ? interpolate(memFrame, [0, 20, 80, 110], [0, 0.85, 0.85, 0], {extrapolateRight: 'clamp'})
              : 0;
            return (
              <div key={i} style={{
                position: 'absolute',
                top: `calc(50% + ${mem.y}px)`,
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontFamily: fonts.display,
                fontSize: i === 2 ? 34 : 30,
                color: urbanPalette.glow,
                opacity,
                fontStyle: 'italic',
                textAlign: 'center',
              }}>
                {mem.text}
              </div>
            );
          })}
          <Particles count={4} color={urbanPalette.glow} speed={0.1} size={2} />
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: Failed attempts (290-440) ═══ */}
      <Fade startAt={290} endAt={440} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/urban-night.jpg"
          zoom="in"
          overlay={0.65}
          overlayColor="#0A0A14"
          brightness={0.5}
          startAt={290}
          duration={150}
        >
          {[
            {text: 'Would you maybe want to...', delay: 0},
            {text: "I think you're really...", delay: 30},
            {text: 'So I was wondering if...', delay: 60},
          ].map((msg, i) => {
            const msgFrame = frame - 320 - msg.delay;
            const opacity = msgFrame > 0
              ? interpolate(msgFrame, [0, 10, 35, 55], [0, 0.8, 0.8, 0.15], {extrapolateRight: 'clamp'})
              : 0;
            const strikethrough = msgFrame > 30;
            return (
              <div key={i} style={{
                position: 'absolute',
                top: `calc(38% + ${i * 65}px)`,
                left: '50%',
                transform: 'translateX(-50%)',
                fontFamily: fonts.body,
                fontSize: 20,
                color: colors.textSecondary,
                opacity,
                textDecoration: strikethrough ? 'line-through' : 'none',
                textDecorationColor: urbanPalette.glow,
                padding: '12px 20px',
                background: `${colors.surface}AA`,
                borderRadius: 14,
                whiteSpace: 'nowrap',
              }}>
                {msg.text}
              </div>
            );
          })}
          <Vignette intensity={0.6} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: The turn (420-570) ═══ */}
      <Fade startAt={420} endAt={570} fadeIn={20} fadeOut={20}>
        <AbsoluteFill>
          <GradientBg color1="#0A0A14" color2={urbanPalette.bg} />
          <TextReveal text="What if you didn't" startAt={450} duration={50} fontSize={40} color={urbanPalette.softLight} y={-40} />
          <TextReveal text="need words at all?" startAt={490} duration={70} fontSize={48} color={urbanPalette.accent} y={40} fontStyle="italic" />
          <GoldLine y={85} startAt={510} width={200} />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 5: Porizo flow — compressed (555-760) ═══ */}
      <Fade startAt={555} endAt={760} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={urbanPalette.bg} color2="#0A0A14" />
          {frame < 650 ? (
            <PhoneMockup startAt={560} scale={0.85} y={-20}>
              <OccasionScreen selectedOccasion="i love you" highlightDelay={25} />
            </PhoneMockup>
          ) : (
            <PhoneMockup startAt={650} scale={0.85} y={-20}>
              <StoryInputScreen
                recipientName="Amara"
                occasion="I Love You"
                message="Amara, every time you laugh at something stupid I said, I forget what I was even saying."
                typingStart={665}
                placeholder="What do you love most about Amara?"
              />
            </PhoneMockup>
          )}
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Preview (745-900) ═══ */}
      <Fade startAt={745} endAt={900} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0A0A14" color2={urbanPalette.bg} />
          <PhoneMockup startAt={750} scale={0.85} y={-30}>
            <PreviewPlayerScreen songTitle="A Song for Amara" recipientName="Amara" isPlaying={true} />
          </PhoneMockup>
          <Particles count={5} color={urbanPalette.accent} speed={0.15} size={2} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Chat share (885-1080) ═══ */}
      <Fade startAt={885} endAt={1080} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/girl-smile.jpg"
          zoom="in"
          overlay={0.72}
          overlayColor="#0A0A14"
          brightness={0.4}
          startAt={885}
          duration={195}
        >
          <div style={{
            position: 'absolute',
            top: '25%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage text="I made you something." isMe={true} startAt={905} />
            <ChatMessage
              text="Listen to this"
              isMe={true}
              startAt={935}
              linkPreview={{title: 'A Song for Amara', subtitle: 'porizo.co/share'}}
            />
            <ChatMessage text="Wait is that YOUR voice??" sender="Amara" isMe={false} startAt={985} />
          </div>
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 8: "Pick me up at 8" (1065-1300) ═══ */}
      <Fade startAt={1065} endAt={1300} fadeIn={20} fadeOut={20}>
        <AbsoluteFill>
          <GradientBg color1={urbanPalette.bg} color2="#0A0A14" />

          <div style={{
            position: 'absolute',
            top: '35%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage text="Pick me up at 8 :)" sender="Amara" isMe={false} startAt={1090} />
          </div>

          <TextReveal text="Sometimes the right words" startAt={1160} duration={50} fontSize={34} color={urbanPalette.softLight} y={120} />
          <TextReveal text="aren't words at all." startAt={1200} duration={80} fontSize={44} color={urbanPalette.accent} y={190} fontStyle="italic" />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 9: End Card (1350-1500) ═══ */}
      <Fade startAt={1350} endAt={1500} fadeIn={15} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={8} color={urbanPalette.accent} speed={0.06} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1355} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
