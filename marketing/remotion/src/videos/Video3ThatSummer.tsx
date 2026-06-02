import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Audio,
  staticFile,
} from 'remotion';
import {colors, fonts, goldenPalette, FPS} from '../tokens';
import {TextReveal} from '../components/TextReveal';
import {PhoneMockup} from '../components/PhoneMockup';
import {
  OccasionScreen,
  StoryInputScreen,
  PreviewPlayerScreen,
} from '../components/PorizoScreens';
import {EndCard} from '../components/EndCard';
import {Fade, GradientBg, FilmGrain, Vignette} from '../components/SceneTransition';
import {ChatMessage} from '../components/ChatMessage';
import {PhotoScene, Particles, GoldLine} from '../components/PhotoScene';

/**
 * Video 3: "That Summer" — Old Friends Remembering the Past
 * 55 seconds at 30fps = 1650 frames
 */
export const Video3ThatSummer: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{background: goldenPalette.bg}}>
      {/* Background music — acoustic */}
      <Audio
        src={staticFile('audio/acoustic-indie.mp3')}
        volume={interpolate(
          frame,
          [0, 30, 1560, 1650],
          [0, 0.35, 0.35, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        )}
      />

      {/* ═══ SCENE 1: Dead group chat (0-165) ═══ */}
      <Fade startAt={0} endAt={165} fadeIn={8} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={goldenPalette.bg} color2="#0D0805" />

          <TextReveal
            text="Every friend group"
            startAt={10}
            duration={55}
            fontSize={48}
            color={goldenPalette.softLight}
            y={-340}
          />
          <TextReveal
            text="has this chat."
            startAt={30}
            duration={55}
            fontSize={52}
            color={goldenPalette.accent}
            y={-285}
            fontStyle="italic"
          />

          {/* Dead group chat */}
          <div style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              padding: '0 8px',
            }}>
              <div style={{display: 'flex', marginRight: -4}}>
                {['#D4A574', '#7DD3A6', '#7B9BFF', '#FF6B8A', '#FFD699'].map((c, i) => (
                  <div key={i} style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: `${c}44`,
                    border: `2px solid ${goldenPalette.bg}`,
                    marginLeft: i > 0 ? -8 : 0,
                  }} />
                ))}
              </div>
              <div style={{fontFamily: fonts.body, fontSize: 15, fontWeight: 600, color: colors.textPrimary}}>
                The Boys
              </div>
            </div>
            <div style={{padding: '8px 16px'}}>
              <div style={{
                fontFamily: fonts.body, fontSize: 11,
                color: colors.textTertiary, textAlign: 'center', marginBottom: 12,
              }}>
                3 months ago
              </div>
              <ChatMessage text="We should definitely hang out soon" sender="Marcus" isMe={false} startAt={50} />
              <div style={{
                fontFamily: fonts.body, fontSize: 11,
                color: colors.textTertiary, marginTop: 8, textAlign: 'center',
              }}>
                Seen by everyone
              </div>
            </div>
          </div>

          <Particles count={6} color={goldenPalette.sunlight} speed={0.08} size={2} />
          <Vignette intensity={0.6} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 2: Flashback — "You shared everything" (150-315) ═══ */}
      <Fade startAt={150} endAt={315} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/friends-group.jpg"
          zoom="out"
          overlay={0.6}
          overlayColor="#140E06"
          brightness={0.6}
          startAt={150}
          duration={165}
        >
          <TextReveal
            text="You shared everything."
            startAt={170}
            duration={50}
            fontSize={54}
            color={goldenPalette.softLight}
            y={-140}
          />
          <GoldLine y={-95} startAt={190} width={200} />

          {/* Floating memory words */}
          {[
            {text: 'Road trips', delay: 30, x: -80, y: -30},
            {text: 'Late nights', delay: 50, x: 60, y: 10},
            {text: 'Inside jokes', delay: 70, x: -40, y: 50},
            {text: 'Bad decisions', delay: 90, x: 90, y: 90},
            {text: 'Best memories', delay: 110, x: -20, y: 130},
          ].map((mem, i) => {
            const memFrame = frame - 180 - mem.delay;
            const opacity = memFrame > 0
              ? interpolate(memFrame, [0, 15, 60, 80], [0, 0.6, 0.6, 0.2], {extrapolateRight: 'clamp'})
              : 0;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: `calc(50% + ${mem.y}px)`,
                  left: `calc(50% + ${mem.x}px)`,
                  transform: 'translate(-50%, -50%)',
                  fontFamily: fonts.display,
                  fontSize: 20,
                  color: goldenPalette.sunlight,
                  opacity,
                  fontStyle: 'italic',
                }}
              >
                {mem.text}
              </div>
            );
          })}

          <Particles count={15} color={goldenPalette.sunlight} speed={0.15} size={2} />
          <FilmGrain opacity={0.05} />
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 3: "Now you share memes..." (300-465) ═══ */}
      <Fade startAt={300} endAt={465} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/road-trip.jpg"
          zoom="in"
          overlay={0.65}
          overlayColor="#140E06"
          brightness={0.55}
          startAt={300}
          duration={165}
        >
          <TextReveal
            text="Now you share memes"
            startAt={320}
            duration={50}
            fontSize={48}
            color={goldenPalette.softLight}
            y={-50}
          />
          <TextReveal
            text={'and say "we should hang out."'}
            startAt={355}
            duration={50}
            fontSize={46}
            color={colors.textSecondary}
            y={10}
            fontStyle="italic"
          />
          <GoldLine y={50} startAt={380} width={180} />
          <TextReveal
            text="What if you reminded him..."
            startAt={400}
            duration={50}
            fontSize={46}
            color={goldenPalette.accent}
            y={100}
          />

          <Particles count={10} color={goldenPalette.accent} speed={0.1} size={2} />
          <Vignette intensity={0.6} />
          <FilmGrain opacity={0.04} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 4: Opens Porizo — Celebration (450-630) ═══ */}
      <Fade startAt={450} endAt={630} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={goldenPalette.bg} />
          <Particles count={8} color={goldenPalette.accent} speed={0.1} size={2} />
          <PhoneMockup startAt={455} scale={0.9} y={-20}>
            <OccasionScreen selectedOccasion="celebration" highlightDelay={35} />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 5: Story input (615-810) ═══ */}
      <Fade startAt={615} endAt={810} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1={goldenPalette.bg} color2="#0D0805" />
          <PhoneMockup startAt={620} scale={0.9} y={-20}>
            <StoryInputScreen
              recipientName="Jake"
              occasion="Celebration"
              message="Jake, remember that summer we drove to the coast with $40 and a broken AC? Best week of my life, man."
              typingStart={650}
              placeholder="What are we celebrating about Jake?"
            />
          </PhoneMockup>
          <TextReveal text="Their story. Your voice." startAt={750} duration={50} fontSize={40} color={goldenPalette.accent} y={420} />
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 6: Preview plays (795-990) ═══ */}
      <Fade startAt={795} endAt={990} fadeIn={15} fadeOut={15}>
        <AbsoluteFill>
          <GradientBg color1="#0D0805" color2={goldenPalette.bg} />
          <Particles count={10} color={goldenPalette.accent} speed={0.15} size={2} />
          <PhoneMockup startAt={800} scale={0.9} y={-20}>
            <PreviewPlayerScreen songTitle="That Summer" recipientName="Jake" isPlaying={true} />
          </PhoneMockup>
          <Vignette intensity={0.4} />
        </AbsoluteFill>
      </Fade>

      {/* ═══ SCENE 7: Group chat EXPLODES (975-1200) ═══ */}
      <Fade startAt={975} endAt={1200} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/campfire.jpg"
          zoom="in"
          overlay={0.72}
          overlayColor="#140E06"
          brightness={0.5}
          startAt={975}
          duration={225}
        >
          <div style={{
            position: 'absolute',
            top: '18%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320,
            padding: '0 8px',
          }}>
            <div style={{
              fontFamily: fonts.body, fontSize: 13,
              color: colors.textTertiary, textAlign: 'center', marginBottom: 16,
            }}>
              The Boys
            </div>
            <ChatMessage
              text="Remember that summer?"
              isMe={true}
              startAt={1000}
              linkPreview={{title: 'That Summer — A Song for Jake', subtitle: 'porizo.co/share'}}
            />
            <ChatMessage text="BRO" sender="Marcus" isMe={false} startAt={1045} />
            <ChatMessage text="HOW IS THAT YOUR VOICE" sender="Tyler" isMe={false} startAt={1075} />
            <ChatMessage text="I'm not crying. The AC is broken again." sender="Jake" isMe={false} startAt={1110} />
            <ChatMessage text="yo everyone get on FaceTime RIGHT NOW" sender="Marcus" isMe={false} startAt={1150} />
          </div>

          <Particles count={12} color={goldenPalette.sunlight} speed={0.2} size={2} />
          <Vignette intensity={0.5} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 8: Everyone connected — closing message (1185-1425) ═══ */}
      <Fade startAt={1185} endAt={1425} fadeIn={15} fadeOut={15}>
        <PhotoScene
          src="photos/friends-sunset.jpg"
          zoom="out"
          overlay={0.6}
          overlayColor="#140E06"
          brightness={0.55}
          startAt={1185}
          duration={240}
        >
          <TextReveal
            text="The best gift you can give"
            startAt={1220}
            duration={50}
            fontSize={46}
            color={goldenPalette.softLight}
            y={-60}
          />
          <TextReveal
            text="an old friend..."
            startAt={1255}
            duration={50}
            fontSize={48}
            color={goldenPalette.softLight}
            y={0}
          />
          <GoldLine y={35} startAt={1275} width={200} />
          <TextReveal
            text="is proof you still remember."
            startAt={1300}
            duration={80}
            fontSize={54}
            color={goldenPalette.accent}
            y={80}
            fontStyle="italic"
          />

          <Particles count={20} color={goldenPalette.sunlight} speed={0.12} size={2.5} />
          <Vignette intensity={0.5} />
          <FilmGrain opacity={0.04} />
        </PhotoScene>
      </Fade>

      {/* ═══ SCENE 9: End Card (1410-1650) ═══ */}
      <Fade startAt={1410} endAt={1650} fadeIn={15} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={25} color={goldenPalette.accent} speed={0.08} size={2} />
          <EndCard tagline="Your voice, their song." startAt={1420} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
