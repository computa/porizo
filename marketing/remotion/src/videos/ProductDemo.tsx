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
import {colors, fonts, FPS} from '../tokens';

type SceneProps = {
  start: number;
  end: number;
  children: React.ReactNode;
};

const appUrl = 'https://apps.apple.com/app/porizo-song-gift-maker/id6744547877';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const scenes = [
  {
    start: 0,
    end: 96,
    eyebrow: 'Porizo',
    title: 'Turn a moment into a song gift.',
    detail: 'Create a personal song for birthdays, Mother\'s Day, anniversaries, and more.',
    image: 'app/screens/01-splash.jpeg',
  },
  {
    start: 96,
    end: 210,
    eyebrow: 'Step 1',
    title: 'Pick the occasion.',
    detail: 'Start with the moment and who the song is for.',
    image: 'app/screens/03-create-choice.jpeg',
  },
  {
    start: 210,
    end: 330,
    eyebrow: 'Step 2',
    title: 'Tell the story.',
    detail: 'Add the names, memories, tone, and details that make it specific.',
    image: 'app/screens/07-story-chat.jpeg',
  },
  {
    start: 330,
    end: 450,
    eyebrow: 'Step 3',
    title: 'Choose the voice.',
    detail: 'Use an AI voice or your enrolled voice when your profile is ready.',
    image: 'app/screens/08-voice-profile.jpeg',
  },
  {
    start: 450,
    end: 600,
    eyebrow: 'Step 4',
    title: 'Preview the finished gift.',
    detail: 'A complete song page your recipient can open, play, and remember.',
    image: 'app/screens/04-create-song.jpeg',
  },
] as const;

const Scene: React.FC<SceneProps> = ({start, end, children}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [start, start + 14, end - 14, end],
    [0, 1, 1, 0],
    clamp
  );

  if (frame < start - 1 || frame > end + 1) return null;

  return (
    <AbsoluteFill style={{opacity}}>
      {children}
    </AbsoluteFill>
  );
};

const BrandLockup: React.FC<{compact?: boolean}> = ({compact = false}) => {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: compact ? 14 : 18}}>
      <Img
        src={staticFile('app/brand/app-icon.png')}
        style={{
          width: compact ? 70 : 88,
          height: compact ? 70 : 88,
          borderRadius: compact ? 18 : 22,
          boxShadow: '0 18px 48px rgba(198, 96, 61, 0.24)',
        }}
      />
      <div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: compact ? 38 : 52,
            lineHeight: 1,
            color: '#2d211a',
          }}
        >
          Porizo
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: compact ? 16 : 19,
            color: '#7a675c',
            marginTop: 5,
          }}
        >
          Song Gift Maker
        </div>
      </div>
    </div>
  );
};

const Background: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(180deg, #fff9f3 0%, #f4e7dc 42%, #1f1713 42%, #18110e 100%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 800,
          background:
            'linear-gradient(120deg, rgba(230, 119, 75, 0.10), rgba(255, 255, 255, 0) 62%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 56,
          right: 56,
          bottom: 74,
          height: 1,
          background: 'rgba(255,255,255,0.16)',
        }}
      />
    </AbsoluteFill>
  );
};

const PhoneFrame: React.FC<{src: string; start: number; side?: 'left' | 'right'}> = ({
  src,
  start,
  side = 'right',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - start;
  const enter = spring({
    frame: localFrame,
    fps,
    config: {damping: 200},
    durationInFrames: 34,
  });
  const float = Math.sin(frame * 0.018) * 7;
  const imageY = interpolate(localFrame, [0, 115], [0, -36], clamp);
  const x = side === 'right' ? 200 : -188;
  const rotate = side === 'right' ? 2.4 : -2.2;

  return (
    <div
      style={{
        position: 'absolute',
        top: 334,
        left: '50%',
        width: 418,
        height: 906,
        transform: `translateX(-50%) translateX(${x}px) translateY(${interpolate(
          enter,
          [0, 1],
          [90, float]
        )}px) rotate(${rotate}deg) scale(${interpolate(enter, [0, 1], [0.88, 1])})`,
        opacity: enter,
        borderRadius: 58,
        padding: 12,
        background: '#111',
        boxShadow: '0 36px 90px rgba(32, 20, 14, 0.38)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: 48,
          background: '#fbf7f0',
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            width: '100%',
            height: 'auto',
            transform: `translateY(${imageY}px)`,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 23,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 114,
          height: 32,
          borderRadius: 18,
          background: '#060606',
        }}
      />
    </div>
  );
};

const SceneCopy: React.FC<{
  start: number;
  eyebrow: string;
  title: string;
  detail: string;
  align?: 'top' | 'bottom';
}> = ({start, eyebrow, title, detail, align = 'top'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - start;
  const enter = spring({
    frame: localFrame,
    fps,
    config: {damping: 200},
    durationInFrames: 28,
  });
  const y = interpolate(enter, [0, 1], [34, 0]);
  const dark = align === 'bottom';

  return (
    <div
      style={{
        position: 'absolute',
        top: align === 'top' ? 132 : undefined,
        bottom: align === 'bottom' ? 150 : undefined,
        left: 64,
        right: 64,
        transform: `translateY(${y}px)`,
        opacity: enter,
        color: dark ? '#f9f0e8' : '#2d211a',
      }}
    >
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 22,
          fontWeight: 800,
          color: dark ? '#ee9a72' : '#c6603d',
          textTransform: 'uppercase',
          marginBottom: 16,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 70,
          lineHeight: 1.05,
          maxWidth: 700,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 27,
          lineHeight: 1.4,
          color: dark ? '#cdbfb5' : '#705e52',
          maxWidth: 710,
          marginTop: 24,
        }}
      >
        {detail}
      </div>
    </div>
  );
};

const StepRail: React.FC<{start: number; active: number}> = ({start, active}) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [start, start + 20], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 64,
        right: 64,
        top: 1262,
        display: 'flex',
        gap: 12,
        opacity: reveal,
      }}
    >
      {['Pick', 'Story', 'Voice', 'Share'].map((label, index) => (
        <div
          key={label}
          style={{
            flex: 1,
            height: 70,
            borderRadius: 20,
            background: index <= active ? '#c6603d' : 'rgba(255,255,255,0.12)',
            color: index <= active ? '#fffaf5' : '#a99b91',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.body,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
};

const GiftCard: React.FC<{start: number}> = ({start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - start;
  const enter = spring({
    frame: localFrame,
    fps,
    config: {damping: 200},
    durationInFrames: 34,
  });
  const waveProgress = interpolate(localFrame, [10, 104], [0, 1], clamp);

  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 206,
        borderRadius: 36,
        background: '#fff8f1',
        padding: '34px 34px 32px',
        transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`,
        opacity: enter,
        boxShadow: '0 26px 72px rgba(0,0,0,0.22)',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
        <div
          style={{
            width: 94,
            height: 94,
            borderRadius: 24,
            background: 'linear-gradient(135deg, #e9784e, #be5839)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Img src={staticFile('app/brand/brandmark.png')} style={{width: 60, height: 60}} />
        </div>
        <div>
          <div
            style={{
              fontFamily: fonts.body,
              fontSize: 31,
              fontWeight: 850,
              color: '#2d211a',
            }}
          >
            For Mom
          </div>
          <div
            style={{
              fontFamily: fonts.body,
              fontSize: 20,
              color: '#806d61',
              marginTop: 7,
            }}
          >
            A finished song gift, ready to share
          </div>
        </div>
      </div>
      <div style={{display: 'flex', gap: 5, alignItems: 'center', height: 88, marginTop: 28}}>
        {Array.from({length: 54}).map((_, i) => {
          const height = 18 + Math.abs(Math.sin(i * 0.47)) * 38 + Math.abs(Math.cos(i * 0.31)) * 16;
          return (
            <div
              key={i}
              style={{
                width: 7,
                height,
                borderRadius: 6,
                background: i / 54 < waveProgress ? '#c6603d' : '#e6d7ce',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 18,
          width: 216,
          height: 58,
          borderRadius: 18,
          background: '#2d211a',
          color: '#fffaf5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.body,
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        Play song
      </div>
    </div>
  );
};

const EndScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - 780;
  const logo = spring({
    frame: localFrame,
    fps,
    config: {damping: 200},
    durationInFrames: 34,
  });
  const cta = interpolate(localFrame, [28, 52], [0, 1], clamp);

  return (
    <Scene start={780} end={960}>
      <AbsoluteFill style={{background: '#fff9f3', justifyContent: 'center', padding: 74}}>
        <div style={{transform: `translateY(${interpolate(logo, [0, 1], [28, 0])}px)`, opacity: logo}}>
          <BrandLockup />
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 76,
            lineHeight: 1.05,
            color: '#2d211a',
            marginTop: 62,
            maxWidth: 820,
          }}
        >
          Make the gift they replay.
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 29,
            lineHeight: 1.42,
            color: '#6f5c50',
            marginTop: 28,
            maxWidth: 790,
          }}
        >
          Create a free personalized song gift in the Porizo app.
        </div>
        <div
          style={{
            opacity: cta,
            marginTop: 66,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 18,
          }}
        >
          <div
            style={{
              background: '#c6603d',
              color: '#fffaf5',
              borderRadius: 26,
              padding: '22px 34px',
              fontFamily: fonts.body,
              fontSize: 28,
              fontWeight: 850,
              boxShadow: '0 18px 42px rgba(198,96,61,0.28)',
            }}
          >
            Download on the App Store
          </div>
          <div style={{fontFamily: fonts.body, color: '#9a887d', fontSize: 20}}>
            {appUrl.replace('https://', '')}
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

export const ProductDemo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Audio
        src={staticFile('audio/warm-piano.mp3')}
        volume={interpolate(frame, [0, 18, 918, 960], [0, 0.34, 0.34, 0], clamp)}
      />
      <Background />

      {scenes.map((scene, index) => (
        <Scene key={scene.title} start={scene.start} end={scene.end}>
          <SceneCopy
            start={scene.start + 8}
            eyebrow={scene.eyebrow}
            title={scene.title}
            detail={scene.detail}
            align={index < 3 ? 'top' : 'bottom'}
          />
          <PhoneFrame
            src={scene.image}
            start={scene.start + 16}
            side={index % 2 === 0 ? 'right' : 'left'}
          />
          {index > 0 && <StepRail start={scene.start + 20} active={Math.min(index - 1, 3)} />}
        </Scene>
      ))}

      <Scene start={600} end={792}>
        <AbsoluteFill style={{background: '#18110e'}}>
          <div
            style={{
              position: 'absolute',
              top: 108,
              left: 64,
              right: 64,
            }}
          >
            <BrandLockup compact />
          </div>
          <SceneCopy
            start={612}
            eyebrow="The payoff"
            title="Send a gift with a song attached."
            detail="A playable link, a personal message, and a reason to open the app again."
            align="bottom"
          />
          <GiftCard start={628} />
        </AbsoluteFill>
      </Scene>

      <EndScene />
    </AbsoluteFill>
  );
};
