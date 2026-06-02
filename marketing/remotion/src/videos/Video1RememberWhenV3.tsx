import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Audio,
  staticFile,
} from 'remotion';
import {colors, fonts, sunnyWarmPalette, FPS} from '../tokens';
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
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

const P = sunnyWarmPalette;

// Contrast shadows for text on photos vs solid backgrounds
const PHOTO_SHADOW = '0 2px 20px rgba(255,255,255,0.9), 0 1px 6px rgba(255,255,255,0.7)';
const PHOTO_ACCENT_SHADOW = '0 2px 16px rgba(255,248,240,0.8), 0 0px 40px rgba(224,122,75,0.3)';
const SOLID_SHADOW = '0 1px 8px rgba(0,0,0,0.06)';

// Dark text guaranteed readable on any bright photo
const DARK = '#1A0800';
// Deep accent that pops on light backgrounds
const ACCENT_DEEP = '#C0582A';

/**
 * Video 1 V3: "Remember When" — Sunny Edition
 * 55 seconds at 30fps = 1650 frames
 */
export const Video1RememberWhenV3: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: P.bg}}>
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1560, 1650],
          [0, 0.4, 0.4, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Sunny flowers / garden (0-135) ═══ */}
      <Fade startAt={0} endAt={135} fadeIn={8} fadeOut={15}>
        <PhotoScene
          src="photos/sunny-flowers.jpg"
          zoom="in"
          overlay={0.2}
          overlayColor="#FFFFFF"
          brightness={1.1}
          duration={135}
        >
          <Particles count={12} color={P.warmGlow} speed={0.15} size={2} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 2: "You used to write her love letters." (110-285) ═══
           Photo: sunny-couple-walk — bright outdoor, needs strong dark text + shadow */}
      <Fade startAt={110} endAt={285} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/sunny-couple-walk.jpg"
          zoom="out"
          overlay={0.35}
          overlayColor="#FFF8F0"
          brightness={1.0}
          startAt={110}
          duration={175}
        >
          <Particles count={15} color={P.accent} speed={0.2} size={2} />

          <TextReveal
            text="You used to write her"
            startAt={130}
            duration={70}
            fontSize={54}
            color={DARK}
            y={-40}
            textShadow={PHOTO_SHADOW}
          />
          <TextReveal
            text="love letters."
            startAt={155}
            duration={100}
            fontSize={62}
            color={ACCENT_DEEP}
            y={30}
            fontStyle="italic"
            textShadow={PHOTO_ACCENT_SHADOW}
          />
          <GoldLine y={70} startAt={170} width={180} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: "When was the last time..." (265-435) ═══
           Photo: sunny-couple-sunset — warm tones, dark text with warm shadow */}
      <Fade startAt={265} endAt={435} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/sunny-couple-sunset.jpg"
          zoom="in"
          overlay={0.35}
          overlayColor="#FFF0E6"
          brightness={1.0}
          startAt={265}
          duration={170}
        >
          <TextReveal
            text="When was the last time"
            startAt={285}
            duration={55}
            fontSize={50}
            color={DARK}
            y={-60}
            textShadow={PHOTO_SHADOW}
          />
          <TextReveal
            text="you told her..."
            startAt={320}
            duration={50}
            fontSize={50}
            color={DARK}
            y={0}
            textShadow={PHOTO_SHADOW}
          />
          <GoldLine y={35} startAt={340} width={120} />
          <TextReveal
            text="in a way she'd never forget?"
            startAt={360}
            duration={60}
            fontSize={52}
            color={ACCENT_DEEP}
            y={80}
            fontStyle="italic"
            textShadow={PHOTO_ACCENT_SHADOW}
          />

          <Particles count={10} color={P.warmGlow} speed={0.1} size={2} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: Opens Porizo (415-600) ═══
           Solid gradient bg — controlled, lighter shadow enough */}
      <Fade startAt={415} endAt={600} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={P.bg} color2={P.softLight} />
          <Particles count={8} color={P.accent} speed={0.1} size={2} />

          <PhoneMockup startAt={420} scale={0.9} y={-20}>
            <OccasionScreen selectedOccasion="anniversary" highlightDelay={40} />
          </PhoneMockup>

          <TextReveal
            text="Your voice."
            startAt={510}
            duration={80}
            fontSize={46}
            color={ACCENT_DEEP}
            y={420}
            textShadow={SOLID_SHADOW}
          />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 5: Recording voice (585-780) ═══
           Solid gradient — controlled background */}
      <Fade startAt={585} endAt={780} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={P.softLight} color2={P.bg} />
          <Particles count={6} color={P.warmGlow} speed={0.15} size={2} />

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
            color={ACCENT_DEEP}
            y={420}
            textShadow={SOLID_SHADOW}
          />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Story input (765-960) ═══
           Solid gradient — controlled */}
      <Fade startAt={765} endAt={960} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={P.bg} color2={P.softLight} />

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
            color={ACCENT_DEEP}
            y={420}
            textShadow={SOLID_SHADOW}
          />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Preview plays (945-1140) ═══ */}
      <Fade startAt={945} endAt={1140} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={P.softLight} color2={P.bg} />

          <PhoneMockup startAt={950} scale={0.9} y={-20}>
            <PreviewPlayerScreen
              songTitle="A Song for Margaret"
              recipientName="Margaret"
              isPlaying={true}
            />
          </PhoneMockup>

          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 500,
            height: 900,
            borderRadius: 80,
            background: `radial-gradient(ellipse, ${P.warmGlow}20 0%, transparent 50%)`,
            pointerEvents: 'none',
          }} />
          <Particles count={10} color={P.accent} speed={0.2} size={2} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 8: Her reaction (1125-1350) ═══
           Photo: sunny-golden-hour — very bright, needs maximum contrast */}
      <Fade startAt={1125} endAt={1350} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/sunny-golden-hour.jpg"
          zoom="in"
          overlay={0.4}
          overlayColor="#FFF8F0"
          brightness={0.95}
          startAt={1125}
          duration={225}
        >
          <TextReveal
            text="She pressed play."
            startAt={1145}
            duration={45}
            fontSize={52}
            color={DARK}
            y={-100}
            textShadow={PHOTO_SHADOW}
          />
          <TextReveal
            text="Her eyes filled with tears."
            startAt={1200}
            duration={45}
            fontSize={52}
            color={DARK}
            y={-40}
            fontStyle="italic"
            textShadow={PHOTO_SHADOW}
          />
          <GoldLine y={0} startAt={1220} width={200} />
          <TextReveal
            text="She reached across the table"
            startAt={1260}
            duration={50}
            fontSize={48}
            color={ACCENT_DEEP}
            y={50}
            textShadow={PHOTO_ACCENT_SHADOW}
          />
          <TextReveal
            text="and took his hand."
            startAt={1295}
            duration={55}
            fontSize={54}
            color={ACCENT_DEEP}
            y={110}
            fontStyle="italic"
            textShadow={PHOTO_ACCENT_SHADOW}
          />

          <Particles count={15} color={P.warmGlow} speed={0.15} size={2.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 9: Closing line (1335-1510) ═══
           Solid gradient — dark text on cream, very readable */}
      <Fade startAt={1335} endAt={1510} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={P.bg} color2={P.softLight} />
          <Particles count={20} color={P.accent} speed={0.1} size={2} />

          <TextReveal
            text="Some things are too important"
            startAt={1355}
            duration={55}
            fontSize={52}
            color={DARK}
            y={-40}
            textShadow={SOLID_SHADOW}
          />
          <GoldLine y={0} startAt={1380} width={250} />
          <TextReveal
            text="for a greeting card."
            startAt={1395}
            duration={80}
            fontSize={60}
            color={ACCENT_DEEP}
            y={50}
            fontStyle="italic"
            textShadow={SOLID_SHADOW}
          />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 10: End Card (1495-1650) ═══ */}
      <Fade startAt={1495} endAt={1650} fadeIn={15} fadeOut={3}>
        <AbsoluteFill style={{background: P.bg}}>
          <Particles count={25} color={P.accent} speed={0.08} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1500} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
