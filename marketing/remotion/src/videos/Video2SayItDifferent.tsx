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
  RecordingScreen,
  StoryInputScreen,
  PreviewPlayerScreen,
} from '../components/PorizoScreens';
import {EndCard} from '../components/EndCard';
import {Fade, GradientBg, Vignette} from '../components/SceneTransition';
import {ChatMessage} from '../components/ChatMessage';
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

/**
 * Video 2: "Say It Different" — Young Guy Asking a Girl Out
 * 50 seconds at 30fps = 1500 frames
 */
export const Video2SayItDifferent: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: urbanPalette.bg}}>
      {/* Background music — lo-fi beat */}
      <Audio
        src={staticFile('audio/lofi-beat.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1410, 1500],
          [0, 0.35, 0.35, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Guy staring at phone (0-135) ═══ */}
      <Fade startAt={0} endAt={135} fadeIn={8} fadeOut={15}>
        <PhotoScene
          src="photos/guy-phone.jpg"
          zoom="in"
          overlay={0.65}
          overlayColor="#0A0A14"
          brightness={0.6}
          duration={135}
        >
          {/* Chat typing animation overlay */}
          <div style={{
            position: 'absolute',
            bottom: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 280,
          }}>
            <div style={{
              background: `${colors.surface}CC`,
              borderRadius: 22,
              padding: '12px 16px',
              border: `0.5px solid ${colors.border}`,
              backdropFilter: 'blur(10px)',
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

          <Particles count={10} color={urbanPalette.neon} speed={0.15} size={2} />
          <Vignette intensity={0.7} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 2: "You've been trying to find the right words" (110-255) ═══ */}
      <Fade startAt={110} endAt={255} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/girl-smile.jpg"
          zoom="out"
          overlay={0.7}
          overlayColor="#0A0A14"
          brightness={0.5}
          startAt={110}
          duration={145}
        >
          <TextReveal
            text="You've been trying to find"
            startAt={130}
            duration={50}
            fontSize={50}
            color={urbanPalette.softLight}
            y={-40}
          />
          <TextReveal
            text="the right words."
            startAt={170}
            duration={60}
            fontSize={56}
            color={urbanPalette.neon}
            y={30}
            fontStyle="italic"
          />
          <GoldLine y={70} startAt={185} width={160} />

          <Particles count={12} color={urbanPalette.glow} speed={0.2} size={2} />
          <Vignette intensity={0.6} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: Failed attempts (240-375) ═══ */}
      <Fade startAt={240} endAt={375} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/urban-night.jpg"
          zoom="in"
          overlay={0.7}
          overlayColor="#0A0A14"
          brightness={0.5}
          startAt={240}
          duration={135}
        >
          <div style={{
            position: 'absolute',
            top: '25%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            width: 320,
          }}>
            {[
              {text: 'Would you maybe want to...', delay: 0},
              {text: "I think you're really...", delay: 25},
              {text: 'So I was wondering if...', delay: 50},
            ].map((msg, i) => {
              const msgFrame = frame - 260 - msg.delay;
              const opacity = msgFrame > 0
                ? interpolate(msgFrame, [0, 10, 30, 50], [0, 0.8, 0.8, 0.2], {extrapolateRight: 'clamp'})
                : 0;
              const strikethrough = msgFrame > 25;

              return (
                <div
                  key={i}
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 17,
                    color: colors.textSecondary,
                    opacity,
                    textDecoration: strikethrough ? 'line-through' : 'none',
                    textDecorationColor: urbanPalette.glow,
                    padding: '12px 16px',
                    background: `${colors.surface}BB`,
                    borderRadius: 14,
                    backdropFilter: 'blur(8px)',
                    border: `0.5px solid ${colors.border}`,
                  }}
                >
                  {msg.text}
                </div>
              );
            })}
          </div>

          <TextReveal
            text="What if you didn't need words at all?"
            startAt={335}
            duration={40}
            fontSize={44}
            color={urbanPalette.accent}
            y={280}
            fontStyle="italic"
          />

          <Particles count={8} color={urbanPalette.glow} speed={0.1} size={2} />
          <Vignette intensity={0.6} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: Opens Porizo (360-525) ═══ */}
      <Fade startAt={360} endAt={525} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0A0A14" color2={urbanPalette.bg} />
          <Particles count={8} color={urbanPalette.accent} speed={0.1} size={2} />
          <PhoneMockup startAt={365} scale={0.9} y={-20}>
            <OccasionScreen selectedOccasion="i love you" highlightDelay={35} />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 5: Recording (510-690) ═══ */}
      <Fade startAt={510} endAt={690} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={urbanPalette.bg} color2="#0A0A14" />
          <Particles count={6} color={urbanPalette.neon} speed={0.12} size={2} />
          <PhoneMockup startAt={515} scale={0.9} y={-20}>
            <RecordingScreen
              progress={interpolate(frame, [530, 670], [0.1, 0.8], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
              phraseIndex={Math.min(8, Math.floor(interpolate(frame, [530, 670], [1, 7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})))}
            />
          </PhoneMockup>
          <TextReveal text="Just be you." startAt={600} duration={70} fontSize={44} color={urbanPalette.accent} y={420} />
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Story input (675-870) ═══ */}
      <Fade startAt={675} endAt={870} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0A0A14" color2={urbanPalette.bg} />
          <PhoneMockup startAt={680} scale={0.9} y={-20}>
            <StoryInputScreen
              recipientName="Amara"
              occasion="I Love You"
              message="Amara, every time you laugh at something stupid I said, I forget what I was even saying."
              typingStart={710}
              placeholder="What do you love most about Amara?"
            />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Preview — "That's ME?" (855-1035) ═══ */}
      <Fade startAt={855} endAt={1035} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={urbanPalette.bg} color2="#0A0A14" />
          <Particles count={12} color={urbanPalette.accent} speed={0.2} size={2} />
          <PhoneMockup startAt={860} scale={0.9} y={-40}>
            <PreviewPlayerScreen songTitle="A Song for Amara" recipientName="Amara" isPlaying={true} />
          </PhoneMockup>
          <TextReveal text="Wait... that's ME?" startAt={930} duration={70} fontSize={48} color={urbanPalette.softLight} y={400} fontStyle="italic" />
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 8: Chat share (1020-1200) ═══ */}
      <Fade startAt={1020} endAt={1200} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/girl-smile.jpg"
          zoom="in"
          overlay={0.75}
          overlayColor="#0A0A14"
          brightness={0.4}
          startAt={1020}
          duration={180}
        >
          <div style={{
            position: 'absolute',
            top: '25%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage text="I made you something." isMe={true} startAt={1040} />
            <ChatMessage
              text="Listen to this"
              isMe={true}
              startAt={1070}
              linkPreview={{title: 'A Song for Amara', subtitle: 'porizo.co/share'}}
            />
            <ChatMessage text="..." sender="Amara" isMe={false} startAt={1110} />
            <ChatMessage text="Wait is that YOUR voice??" sender="Amara" isMe={false} startAt={1145} />
          </div>
          <Particles count={8} color={urbanPalette.glow} speed={0.15} size={2} />
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 9: "Pick me up at 8" (1185-1365) ═══ */}
      <Fade startAt={1185} endAt={1365} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={urbanPalette.bg} color2="#0A0A14" />
          <Particles count={20} color={urbanPalette.accent} speed={0.2} size={2.5} />

          <div style={{
            position: 'absolute',
            top: '35%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 16px',
          }}>
            <ChatMessage text="Pick me up at 8 :)" sender="Amara" isMe={false} startAt={1210} />
          </div>

          {/* Victory glow */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${urbanPalette.accent}14 0%, transparent 50%)`,
            opacity: interpolate(frame, [1250, 1300], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }} />

          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 10: End Card (1350-1500) ═══ */}
      <Fade startAt={1350} endAt={1500} fadeIn={15} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={25} color={urbanPalette.accent} speed={0.08} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1355} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
