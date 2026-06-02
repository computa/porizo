import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {colors, fonts} from '../tokens';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const appUrl = 'apps.apple.com/app/porizo-song-gift-maker/id6744547877';

const gallery = [
  {
    label: 'Choose the moment',
    src: 'app/screens/03-create-choice.jpeg',
  },
  {
    label: 'Write the memory',
    src: 'app/screens/07-story-chat.jpeg',
  },
  {
    label: 'Pick the voice',
    src: 'app/screens/08-voice-profile.jpeg',
  },
  {
    label: 'Send the song',
    src: 'app/screens/04-create-song.jpeg',
  },
] as const;

const FadeIn: React.FC<{
  start: number;
  end: number;
  children: React.ReactNode;
}> = ({start, end, children}) => {
  const frame = useCurrentFrame();
  if (frame < start - 1 || frame > end + 1) return null;
  const opacity = interpolate(frame, [start, start + 12, end - 12, end], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

const LogoBadge: React.FC<{small?: boolean}> = ({small = false}) => {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: small ? 10 : 16}}>
      <Img
        src={staticFile('app/brand/app-icon.png')}
        style={{
          width: small ? 54 : 76,
          height: small ? 54 : 76,
          borderRadius: small ? 15 : 20,
          boxShadow: '0 12px 30px rgba(217,103,65,0.28)',
        }}
      />
      <div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: small ? 28 : 42,
            color: '#2b2019',
            lineHeight: 1,
          }}
        >
          Porizo
        </div>
        {!small && (
          <div style={{fontFamily: fonts.body, fontSize: 17, color: '#8a7164', marginTop: 5}}>
            memory-to-song gifts
          </div>
        )}
      </div>
    </div>
  );
};

const ProductVideoWindow: React.FC<{start: number}> = ({start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame - start;
  const enter = spring({
    frame: local,
    fps,
    durationInFrames: 34,
    config: {damping: 200},
  });
  const scale = interpolate(enter, [0, 1], [0.92, 1]);
  const y = interpolate(enter, [0, 1], [58, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 402,
        height: 1058,
        transform: `translateY(${y}px) scale(${scale})`,
        opacity: enter,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          width: 432,
          height: 936,
          transform: 'translateX(-50%)',
          borderRadius: 66,
          padding: 12,
          background: '#16110e',
          boxShadow: '0 36px 90px rgba(35,21,14,0.28)',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 54,
            overflow: 'hidden',
            background: '#d8663f',
          }}
        >
          <Img
            src={staticFile('app/screens/iphone-reveal-screen.jpeg')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          right: 110,
          top: 948,
          borderRadius: 28,
          background: 'rgba(255,248,241,0.94)',
          padding: '24px 26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div>
          <div style={{fontFamily: fonts.body, fontWeight: 850, fontSize: 26, color: '#2b2019'}}>
            Reveal screen
          </div>
          <div style={{fontFamily: fonts.body, fontSize: 18, color: '#806a5f', marginTop: 5}}>
            the memory becomes playable
          </div>
        </div>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            background: '#c95f3d',
            color: '#fffaf5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            fontWeight: 900,
            fontFamily: fonts.body,
          }}
        >
          Play
        </div>
      </div>
    </div>
  );
};

const BigHeadline: React.FC<{
  start: number;
  eyebrow: string;
  title: string;
  detail?: string;
  dark?: boolean;
}> = ({start, eyebrow, title, detail, dark = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame - start;
  const enter = spring({
    frame: local,
    fps,
    durationInFrames: 30,
    config: {damping: 200},
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: dark ? 110 : 116,
        transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 22,
          fontWeight: 900,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: '#c95f3d',
          marginBottom: 18,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 72,
          lineHeight: 1.03,
          color: dark ? '#fff9f3' : '#2b2019',
          maxWidth: 880,
        }}
      >
        {title}
      </div>
      {detail && (
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 27,
            lineHeight: 1.42,
            color: dark ? '#d5c5bb' : '#766156',
            maxWidth: 820,
            marginTop: 26,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
};

const ScreenshotCard: React.FC<{
  index: number;
  src: string;
  label: string;
  start: number;
}> = ({index, src, label, start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame - start - index * 9;
  const enter = spring({
    frame: local,
    fps,
    durationInFrames: 28,
    config: {damping: 200},
  });
  const row = Math.floor(index / 2);
  const col = index % 2;
  const left = col === 0 ? 72 : 560;
  const top = row === 0 ? 414 : 912;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: 448,
        height: 430,
        borderRadius: 34,
        overflow: 'hidden',
        background: '#fff8f1',
        transform: `translateY(${interpolate(enter, [0, 1], [54, 0])}px) rotate(${col === 0 ? -1.5 : 1.5}deg)`,
        opacity: enter,
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: 348,
          objectFit: 'cover',
          objectPosition: 'top center',
        }}
      />
      <div
        style={{
          height: 82,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          fontFamily: fonts.body,
          fontSize: 22,
          fontWeight: 850,
          color: '#2b2019',
        }}
      >
        {label}
      </div>
    </div>
  );
};

const SongCard: React.FC<{start: number}> = ({start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame - start;
  const enter = spring({
    frame: local,
    fps,
    durationInFrames: 32,
    config: {damping: 200},
  });
  const playhead = interpolate(local, [24, 164], [0, 1], clamp);

  return (
    <div
      style={{
        position: 'absolute',
        left: 74,
        right: 74,
        top: 520,
        borderRadius: 44,
        background: '#fff8f1',
        padding: 38,
        transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`,
        opacity: enter,
        boxShadow: '0 34px 90px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
        <Img
          src={staticFile('app/brand/app-icon.png')}
          style={{width: 98, height: 98, borderRadius: 25}}
        />
        <div>
          <div style={{fontFamily: fonts.body, fontSize: 30, fontWeight: 900, color: '#2b2019'}}>
            A song for Mum
          </div>
          <div style={{fontFamily: fonts.body, fontSize: 20, color: '#806a5f', marginTop: 8}}>
            generated from a real memory
          </div>
        </div>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, height: 134, marginTop: 34}}>
        {Array.from({length: 66}).map((_, i) => {
          const height = 20 + Math.abs(Math.sin(i * 0.39)) * 46 + Math.abs(Math.cos(i * 0.24)) * 22;
          return (
            <div
              key={i}
              style={{
                width: 8,
                height,
                borderRadius: 8,
                background: i / 66 <= playhead ? '#c95f3d' : '#e9d9ce',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 10,
          height: 74,
          borderRadius: 24,
          background: '#2b2019',
          color: '#fffaf5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.body,
          fontSize: 25,
          fontWeight: 900,
        }}
      >
        Share the song gift
      </div>
    </div>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame - 690;
  const enter = spring({
    frame: local,
    fps,
    durationInFrames: 38,
    config: {damping: 200},
  });
  const cta = interpolate(local, [36, 62], [0, 1], clamp);

  return (
    <FadeIn start={690} end={870}>
      <AbsoluteFill style={{background: '#fff9f3', justifyContent: 'center', padding: 78}}>
        <div style={{opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [42, 0])}px)`}}>
          <LogoBadge />
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 78,
            lineHeight: 1.04,
            color: '#2b2019',
            marginTop: 64,
            maxWidth: 850,
          }}
        >
          Preserve the memory before it fades.
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 28,
            lineHeight: 1.42,
            color: '#766156',
            marginTop: 28,
            maxWidth: 820,
          }}
        >
          Download Porizo and turn a story into a song they can replay.
        </div>
        <div
          style={{
            opacity: cta,
            marginTop: 62,
            background: '#c95f3d',
            color: '#fffaf5',
            borderRadius: 28,
            padding: '24px 34px',
            fontFamily: fonts.body,
            fontSize: 29,
            fontWeight: 900,
            width: 'fit-content',
            boxShadow: '0 18px 48px rgba(201,95,61,0.28)',
          }}
        >
          Download Porizo app
        </div>
        <div
          style={{
            opacity: cta,
            marginTop: 20,
            fontFamily: fonts.body,
            fontSize: 19,
            color: '#9a8478',
          }}
        >
          {appUrl}
        </div>
      </AbsoluteFill>
    </FadeIn>
  );
};

const TimelineTicks: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 870], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        bottom: 72,
        height: 6,
        borderRadius: 6,
        background: 'rgba(43,32,25,0.12)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: '#c95f3d',
        }}
      />
    </div>
  );
};

export const ProductDemoProof: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#fff9f3'}}>
      <Audio
        src={staticFile('audio/lofi-beat.mp3')}
        loop
        volume={interpolate(frame, [0, 16, 820, 870], [0, 0.27, 0.27, 0], clamp)}
      />

      <FadeIn start={0} end={156}>
        <AbsoluteFill style={{background: 'linear-gradient(180deg, #fff9f3 0%, #f3e2d7 100%)'}}>
          <div style={{position: 'absolute', left: 72, top: 78}}>
            <LogoBadge small />
          </div>
          <BigHeadline
            start={16}
            eyebrow="Product walkthrough"
            title="How to preserve a memory in a song."
            detail="Porizo helps you turn names, moments, and personal details into a song gift someone can replay."
          />
          <ProductVideoWindow start={42} />
        </AbsoluteFill>
      </FadeIn>

      <FadeIn start={144} end={396}>
        <AbsoluteFill style={{background: '#fff9f3'}}>
          <BigHeadline
            start={156}
            eyebrow="Four steps"
            title="From memory to playable gift."
          />
          {gallery.map((item, index) => (
            <ScreenshotCard
              key={item.label}
              index={index}
              src={item.src}
              label={item.label}
              start={196}
            />
          ))}
        </AbsoluteFill>
      </FadeIn>

      <FadeIn start={382} end={560}>
        <AbsoluteFill style={{background: 'linear-gradient(180deg, #fff7f0 0%, #f0ded1 100%)'}}>
          <BigHeadline
            start={398}
            eyebrow="The result"
            title="The memory becomes a song they can open."
            detail="Porizo creates a playable song gift page with the music, message, and share link in one place."
          />
          <SongCard start={430} />
        </AbsoluteFill>
      </FadeIn>

      <FadeIn start={548} end={704}>
        <AbsoluteFill
          style={{
            background: '#fff9f3',
            padding: 74,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontFamily: fonts.body,
              fontSize: 23,
              fontWeight: 900,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              color: '#c95f3d',
              marginBottom: 24,
            }}
          >
            What they keep
          </div>
          {['The story behind the moment.', 'A song made around the person.', 'A gift they can replay anytime.'].map(
            (line, index) => {
              const local = frame - 572 - index * 18;
              const opacity = interpolate(local, [0, 16], [0, 1], clamp);
              const y = interpolate(local, [0, 16], [28, 0], {...clamp, easing: Easing.out(Easing.cubic)});
              return (
                <div
                  key={line}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 22,
                    marginTop: index === 0 ? 0 : 28,
                    opacity,
                    transform: `translateY(${y}px)`,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      background: '#c95f3d',
                      color: '#fffaf5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: fonts.body,
                      fontSize: 24,
                      fontWeight: 900,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 56,
                      lineHeight: 1.08,
                      color: '#2b2019',
                    }}
                  >
                    {line}
                  </div>
                </div>
              );
            }
          )}
        </AbsoluteFill>
      </FadeIn>

      <EndCard />
      <TimelineTicks />
    </AbsoluteFill>
  );
};
