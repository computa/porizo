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
  RecordingScreen,
  StoryInputScreen,
  PreviewPlayerScreen,
} from '../components/PorizoScreens';
import {EndCard} from '../components/EndCard';
import {Fade, GradientBg, FilmGrain, Vignette} from '../components/SceneTransition';
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

/**
 * Video 1: "Remember When" — Old Couples Rekindling Love
 * 55 seconds at 30fps = 1650 frames
 */
export const Video1RememberWhen: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: warmPalette.bg}}>
      {/* Background music — warm piano */}
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1560, 1650],
          [0, 0.4, 0.4, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Photo Album (0-135) ═══ */}
      <Fade startAt={0} endAt={135} fadeIn={8} fadeOut={15}>
        <PhotoScene
          src="photos/photo-album.jpg"
          zoom="in"
          overlay={0.55}
          overlayColor="#1A0F08"
          brightness={0.7}
          duration={135}
        >
          <Particles count={12} color={warmPalette.warmGlow} speed={0.15} size={2} />
          <Vignette intensity={0.7} />
          <FilmGrain opacity={0.05} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 2: "You used to write her love letters." (110-285) ═══ */}
      <Fade startAt={110} endAt={285} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/old-couple.jpg"
          zoom="out"
          overlay={0.6}
          overlayColor="#1A0F08"
          brightness={0.65}
          startAt={110}
          duration={175}
        >
          <Particles count={15} color={warmPalette.accent} speed={0.2} size={2} />

          <TextReveal
            text="You used to write her"
            startAt={130}
            duration={70}
            fontSize={54}
            color={warmPalette.softLight}
            y={-40}
          />
          <TextReveal
            text="love letters."
            startAt={155}
            duration={100}
            fontSize={62}
            color={warmPalette.accent}
            y={30}
            fontStyle="italic"
          />
          <GoldLine y={70} startAt={170} width={180} />

          <Vignette intensity={0.6} />
          <FilmGrain opacity={0.04} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: "When was the last time..." (265-435) ═══ */}
      <Fade startAt={265} endAt={435} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/morning-coffee.jpg"
          zoom="in"
          overlay={0.65}
          overlayColor="#0D0805"
          brightness={0.6}
          startAt={265}
          duration={170}
        >
          <TextReveal
            text="When was the last time"
            startAt={285}
            duration={55}
            fontSize={50}
            color={warmPalette.softLight}
            y={-60}
          />
          <TextReveal
            text="you told her..."
            startAt={320}
            duration={50}
            fontSize={50}
            color={warmPalette.softLight}
            y={0}
          />
          <GoldLine y={35} startAt={340} width={120} />
          <TextReveal
            text="in a way she'd never forget?"
            startAt={360}
            duration={60}
            fontSize={52}
            color={warmPalette.accent}
            y={80}
            fontStyle="italic"
          />

          <Particles count={10} color={warmPalette.warmGlow} speed={0.1} size={2} />
          <Vignette intensity={0.7} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: Opens Porizo — occasion selection (415-600) ═══ */}
      <Fade startAt={415} endAt={600} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={warmPalette.bg} />
          <Particles count={8} color={warmPalette.accent} speed={0.1} size={2} />

          <PhoneMockup startAt={420} scale={0.9} y={-20}>
            <OccasionScreen selectedOccasion="anniversary" highlightDelay={40} />
          </PhoneMockup>

          <TextReveal
            text="Your voice."
            startAt={510}
            duration={80}
            fontSize={46}
            color={warmPalette.accent}
            y={420}
          />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 5: Recording voice (585-780) ═══ */}
      <Fade startAt={585} endAt={780} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={warmPalette.bg} color2="#0D0805" />
          <Particles count={6} color={warmPalette.warmGlow} speed={0.15} size={2} />

          <PhoneMockup startAt={590} scale={0.9} y={-20}>
            <RecordingScreen
              progress={interpolate(frame, [610, 760], [0.1, 0.8], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
              phraseIndex={Math.min(8, Math.floor(interpolate(frame, [610, 760], [1, 7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})))}
            />
          </PhoneMockup>

          <TextReveal
            text="Your story."
            startAt={680}
            duration={80}
            fontSize={46}
            color={warmPalette.accent}
            y={420}
          />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Story input (765-960) ═══ */}
      <Fade startAt={765} endAt={960} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={warmPalette.bg} />

          <PhoneMockup startAt={770} scale={0.9} y={-20}>
            <StoryInputScreen
              recipientName="Margaret"
              occasion="Anniversary"
              message="Margie, 42 years ago you said yes at that little diner on 5th. I'd say yes again every morning."
              typingStart={800}
              placeholder="What does this time together mean to you?"
            />
          </PhoneMockup>

          <TextReveal
            text="Her song."
            startAt={900}
            duration={50}
            fontSize={46}
            color={warmPalette.accent}
            y={420}
          />
          <Vignette intensity={0.5} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Preview plays (945-1140) ═══ */}
      <Fade startAt={945} endAt={1140} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={warmPalette.bg} color2="#1A0F08" />

          <PhoneMockup startAt={950} scale={0.9} y={-20}>
            <PreviewPlayerScreen
              songTitle="A Song for Margaret"
              recipientName="Margaret"
              isPlaying={true}
            />
          </PhoneMockup>

          {/* Warm golden glow around phone */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 500,
            height: 900,
            borderRadius: 80,
            background: `radial-gradient(ellipse, ${warmPalette.accent}0C 0%, transparent 50%)`,
            pointerEvents: 'none',
          }} />
          <Particles count={10} color={warmPalette.accent} speed={0.2} size={2} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 8: Her reaction (1125-1350) ═══ */}
      <Fade startAt={1125} endAt={1350} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/couple-hands.jpg"
          zoom="in"
          overlay={0.6}
          overlayColor="#1A0F08"
          brightness={0.6}
          startAt={1125}
          duration={225}
        >
          <TextReveal
            text="She pressed play."
            startAt={1145}
            duration={45}
            fontSize={52}
            color={warmPalette.softLight}
            y={-100}
          />
          <TextReveal
            text="Her eyes filled with tears."
            startAt={1200}
            duration={45}
            fontSize={52}
            color={warmPalette.softLight}
            y={-40}
            fontStyle="italic"
          />
          <GoldLine y={0} startAt={1220} width={200} />
          <TextReveal
            text="She reached across the table"
            startAt={1260}
            duration={50}
            fontSize={48}
            color={warmPalette.accent}
            y={50}
          />
          <TextReveal
            text="and took his hand."
            startAt={1295}
            duration={55}
            fontSize={54}
            color={warmPalette.accent}
            y={110}
            fontStyle="italic"
          />

          <Particles count={15} color={warmPalette.warmGlow} speed={0.15} size={2.5} />
          <Vignette intensity={0.5} />
          <FilmGrain opacity={0.03} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 9: Closing line (1335-1510) ═══ */}
      <Fade startAt={1335} endAt={1510} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={warmPalette.bg} color2="#0D0805" />
          <Particles count={20} color={warmPalette.accent} speed={0.1} size={2} />

          <TextReveal
            text="Some things are too important"
            startAt={1355}
            duration={55}
            fontSize={52}
            color={warmPalette.softLight}
            y={-40}
          />
          <GoldLine y={0} startAt={1380} width={250} />
          <TextReveal
            text="for a greeting card."
            startAt={1395}
            duration={80}
            fontSize={60}
            color={warmPalette.accent}
            y={50}
            fontStyle="italic"
          />

          <Vignette intensity={0.6} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 10: End Card (1495-1650) ═══ */}
      <Fade startAt={1495} endAt={1650} fadeIn={15} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={25} color={warmPalette.accent} speed={0.08} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1500} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
