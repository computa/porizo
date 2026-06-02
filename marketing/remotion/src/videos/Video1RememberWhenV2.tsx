import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Audio,
  staticFile,
} from 'remotion';
import {colors, fonts, warmPalette, FPS} from '../tokens';
import {TextReveal} from '../components/TextReveal';
import {PhoneMockup} from '../components/PhoneMockup';
import {
  OccasionScreen,
  StoryInputScreen,
  PreviewPlayerScreen,
} from '../components/PorizoScreens';
import {EndCard} from '../components/EndCard';
import {Fade, GradientBg, Vignette} from '../components/SceneTransition';
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

/**
 * Video 1 V2: "Remember When" — Minimalist, memory-forward
 * 55 seconds at 30fps = 1650 frames
 *
 * One idea per screen. Big text. Let the photos breathe.
 */
export const Video1RememberWhenV2: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: warmPalette.bg}}>
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1560, 1650],
          [0, 0.4, 0.4, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Photo album — just the image, one line (0-180) ═══ */}
      <Fade startAt={0} endAt={180} fadeIn={8} fadeOut={20}>
        <PhotoScene
          src="photos/photo-album.jpg"
          zoom="in"
          overlay={0.45}
          overlayColor="#1A0F08"
          brightness={0.75}
          duration={180}
        >
          <TextReveal
            text="Some memories never fade."
            startAt={80}
            duration={90}
            fontSize={34}
            color={warmPalette.softLight}
            y={300}
            fontStyle="italic"
          />
          <Particles count={4} color={warmPalette.warmGlow} speed={0.06} size={2} />
          <Vignette intensity={0.7} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 2: "You used to write her love letters." (160-360) ═══ */}
      <Fade startAt={160} endAt={360} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/old-couple.jpg"
          zoom="out"
          overlay={0.5}
          overlayColor="#1A0F08"
          brightness={0.7}
          startAt={160}
          duration={200}
        >
          <TextReveal text="You used to write her" startAt={200} duration={80} fontSize={44} color={warmPalette.softLight} y={-40} />
          <TextReveal text="love letters." startAt={240} duration={100} fontSize={56} color={warmPalette.accent} y={40} fontStyle="italic" />
          <Particles count={5} color={warmPalette.accent} speed={0.1} size={2} />
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: Memory fragments — just 3, big and clean (340-560) ═══ */}
      <Fade startAt={340} endAt={560} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/morning-coffee.jpg"
          zoom="in"
          overlay={0.6}
          overlayColor="#0D0805"
          brightness={0.6}
          startAt={340}
          duration={220}
        >
          {[
            {text: 'That first dance', delay: 0, y: -80},
            {text: 'Sunday mornings', delay: 50, y: 0},
            {text: '"I choose you"', delay: 100, y: 80},
          ].map((mem, i) => {
            const memFrame = frame - 380 - mem.delay;
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
                fontSize: 36,
                color: warmPalette.warmGlow,
                opacity,
                fontStyle: 'italic',
                textAlign: 'center',
              }}>
                {mem.text}
              </div>
            );
          })}
          <Particles count={4} color={warmPalette.warmGlow} speed={0.08} size={2} />
          <Vignette intensity={0.6} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: The question (540-740) ═══ */}
      <Fade startAt={540} endAt={740} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/couple-hands.jpg"
          zoom="out"
          overlay={0.55}
          overlayColor="#1A0F08"
          brightness={0.65}
          startAt={540}
          duration={200}
        >
          <TextReveal text="When was the last time" startAt={580} duration={60} fontSize={38} color={warmPalette.softLight} y={-60} />
          <GoldLine y={-10} startAt={620} width={180} />
          <TextReveal text="you told her?" startAt={640} duration={80} fontSize={52} color={warmPalette.accent} y={40} fontStyle="italic" />
          <Vignette intensity={0.6} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 5: Porizo — occasion (720-870) ═══ */}
      <Fade startAt={720} endAt={870} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={warmPalette.bg} />
          <PhoneMockup startAt={725} scale={0.85} y={-20}>
            <OccasionScreen selectedOccasion="anniversary" highlightDelay={30} />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Story input (855-1020) ═══ */}
      <Fade startAt={855} endAt={1020} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={warmPalette.bg} color2="#0D0805" />
          <PhoneMockup startAt={860} scale={0.85} y={-20}>
            <StoryInputScreen
              recipientName="Margaret"
              occasion="Anniversary"
              message="Margie, 42 years ago you said yes at that little diner on 5th. I'd say yes again every morning."
              typingStart={880}
              placeholder="What does this time together mean to you?"
            />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Preview (1005-1170) ═══ */}
      <Fade startAt={1005} endAt={1170} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={warmPalette.bg} />
          <PhoneMockup startAt={1010} scale={0.85} y={-20}>
            <PreviewPlayerScreen songTitle="A Song for Margaret" recipientName="Margaret" isPlaying={true} />
          </PhoneMockup>
          <Particles count={5} color={warmPalette.accent} speed={0.12} size={2} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 8: Her reaction (1155-1380) ═══ */}
      <Fade startAt={1155} endAt={1380} fadeIn={20} fadeOut={20}>
        <PhotoScene
          src="photos/couple-hands.jpg"
          zoom="in"
          overlay={0.55}
          overlayColor="#1A0F08"
          brightness={0.65}
          startAt={1155}
          duration={225}
        >
          <TextReveal text="She pressed play." startAt={1185} duration={60} fontSize={42} color={warmPalette.softLight} y={-60} />
          <GoldLine y={-10} startAt={1225} width={220} />
          <TextReveal text="And reached for his hand." startAt={1260} duration={100} fontSize={48} color={warmPalette.accent} y={50} fontStyle="italic" />
          <Particles count={5} color={warmPalette.warmGlow} speed={0.1} size={2} />
          <Vignette intensity={0.4} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 9: Closing (1365-1510) ═══ */}
      <Fade startAt={1365} endAt={1510} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={warmPalette.bg} color2="#0D0805" />
          <TextReveal text="Some things are too important" startAt={1385} duration={55} fontSize={38} color={warmPalette.softLight} y={-40} />
          <GoldLine y={0} startAt={1415} width={250} />
          <TextReveal text="for a greeting card." startAt={1430} duration={70} fontSize={50} color={warmPalette.accent} y={50} fontStyle="italic" />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 10: End Card (1495-1650) ═══ */}
      <Fade startAt={1495} endAt={1650} fadeIn={15} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={8} color={warmPalette.accent} speed={0.06} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1500} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
