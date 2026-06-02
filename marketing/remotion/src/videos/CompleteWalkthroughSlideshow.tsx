import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {FPS, fonts} from '../tokens';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const appUrl = 'apps.apple.com/app/porizo-song-gift-maker/id6744547877';

const slideDuration = 88;
const transition = 14;

const assets = {
  login: staticFile('app/complete-walkthrough/01-login.jpg'),
  occasion: staticFile('app/complete-walkthrough/02-occasion.jpg'),
  recipient: staticFile('app/complete-walkthrough/03-recipient.jpg'),
  story: staticFile('app/complete-walkthrough/04-story.jpg'),
  lyrics: staticFile('app/complete-walkthrough/05-lyrics.jpeg'),
  generation: staticFile('app/complete-walkthrough/06-generation.jpg'),
  reveal: staticFile('app/complete-walkthrough/07-reveal.jpeg'),
  nowPlayingVideo: staticFile('app/complete-walkthrough/08-nowplaying.mp4'),
  icon: staticFile('app/brand/app-icon.png'),
};

const slides = [
  {
    eyebrow: 'Step 1',
    title: 'Sign in to start',
    body: 'Open Porizo and start a song gift in seconds.',
    src: assets.login,
    kind: 'image',
  },
  {
    eyebrow: 'Step 2',
    title: 'Choose the moment',
    body: 'Pick the occasion, recipient, and mood for the gift.',
    src: [assets.occasion, assets.recipient],
    kind: 'duo',
  },
  {
    eyebrow: 'Step 3',
    title: 'Add the memory',
    body: 'Share the story, details, and feelings that should become the song.',
    src: assets.story,
    kind: 'image',
  },
  {
    eyebrow: 'Step 4',
    title: 'Review the lyrics',
    body: 'Porizo turns your memory into lyrics you can check before generation.',
    src: assets.lyrics,
    kind: 'image',
  },
  {
    eyebrow: 'Step 5',
    title: 'Generate and reveal',
    body: 'Create the finished song gift and open the reveal screen.',
    src: [assets.generation, assets.reveal],
    kind: 'duo',
  },
  {
    eyebrow: 'Step 6',
    title: 'Play and share',
    body: 'Listen with lyrics, save it, then send the song to someone you love.',
    src: assets.nowPlayingVideo,
    kind: 'video',
  },
] as const;

const Logo: React.FC = () => (
  <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
    <Img
      src={assets.icon}
      style={{
        width: 66,
        height: 66,
        borderRadius: 18,
        boxShadow: '0 14px 34px rgba(201,95,61,0.22)',
      }}
    />
    <div>
      <div style={{fontFamily: fonts.display, fontSize: 40, lineHeight: 1, color: '#2b2019'}}>
        Porizo
      </div>
      <div style={{fontFamily: fonts.body, fontSize: 16, color: '#8a7164', marginTop: 4}}>
        product slideshow
      </div>
    </div>
  </div>
);

const PhoneFrame: React.FC<{children: React.ReactNode; scale?: number}> = ({children, scale = 1}) => (
  <div
    style={{
      width: 390 * scale,
      height: 846 * scale,
      borderRadius: 58 * scale,
      padding: 10 * scale,
      background: '#17110e',
      boxShadow: '0 32px 86px rgba(43,32,25,0.20)',
      position: 'relative',
    }}
  >
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 48 * scale,
        overflow: 'hidden',
        background: '#fff8f1',
        position: 'relative',
      }}
    >
      {children}
    </div>
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: -6 * scale,
        width: 132 * scale,
        height: 30 * scale,
        transform: 'translateX(-50%)',
        borderRadius: 999,
        background: '#0c0907',
      }}
    />
  </div>
);

const ScreenMedia: React.FC<{slide: (typeof slides)[number]; local: number}> = ({slide, local}) => {
  if (slide.kind === 'video') {
    return (
      <PhoneFrame>
        <OffthreadVideo
          src={slide.src}
          muted
          startFrom={500}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </PhoneFrame>
    );
  }

  if (slide.kind === 'duo') {
    const swap = Math.floor(local / 42) % 2;
    return (
      <PhoneFrame>
        {slide.src.map((src, index) => (
          <Img
            key={src}
            src={src}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: index === swap ? 1 : 0,
              transition: 'opacity 160ms linear',
            }}
          />
        ))}
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <Img src={slide.src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
    </PhoneFrame>
  );
};

const Slide: React.FC<{index: number}> = ({index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const start = index * slideDuration;
  const local = frame - start;
  const slide = slides[index];
  const enter = spring({frame: Math.max(0, local), fps, durationInFrames: 30, config: {damping: 220}});
  const opacity =
    index === 0
      ? interpolate(local, [0, slideDuration - transition, slideDuration], [1, 1, 0], clamp)
      : index === slides.length - 1
        ? interpolate(local, [0, transition], [0, 1], clamp)
        : interpolate(local, [0, transition, slideDuration - transition, slideDuration], [0, 1, 1, 0], clamp);
  const textY = interpolate(enter, [0, 1], [28, 0]);
  const mediaY = interpolate(enter, [0, 1], [44, 0]);

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          top: 78,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Logo />
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 20,
            color: '#9a8478',
            fontWeight: 800,
          }}
        >
          {index + 1}/{slides.length}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          top: 218,
          transform: `translateY(${textY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 21,
            fontWeight: 900,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: '#c95f3d',
            marginBottom: 18,
          }}
        >
          {slide.eyebrow}
        </div>
        <div style={{fontFamily: fonts.display, fontSize: 78, lineHeight: 1.03, color: '#2b2019'}}>
          {slide.title}
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 29,
            lineHeight: 1.36,
            color: '#766156',
            marginTop: 22,
            maxWidth: 850,
          }}
        >
          {slide.body}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 610,
          transform: `translateX(-50%) translateY(${mediaY}px)`,
        }}
      >
        <ScreenMedia slide={slide} local={local} />
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const total = slides.length * slideDuration;
  const progress = interpolate(frame, [0, total - 1], [0, 1], clamp);

  return (
    <div style={{position: 'absolute', left: 72, right: 72, bottom: 64}}>
      <div style={{height: 7, borderRadius: 999, background: 'rgba(43,32,25,0.12)', overflow: 'hidden'}}>
        <div style={{height: '100%', width: `${progress * 100}%`, background: '#c95f3d'}} />
      </div>
    </div>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const start = slides.length * slideDuration;
  const local = frame - start;
  const opacity = interpolate(local, [0, 16], [0, 1], clamp);
  const y = interpolate(local, [0, 24], [42, 0], {...clamp, easing: Easing.out(Easing.cubic)});

  return (
    <AbsoluteFill
      style={{
        background: '#fff9f3',
        opacity,
        justifyContent: 'center',
        padding: 78,
      }}
    >
      <div style={{transform: `translateY(${y}px)`}}>
        <Logo />
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 82,
            lineHeight: 1.04,
            color: '#2b2019',
            marginTop: 72,
            maxWidth: 870,
          }}
        >
          Preserve the memory before it fades.
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 30,
            lineHeight: 1.42,
            color: '#766156',
            marginTop: 28,
            maxWidth: 840,
          }}
        >
          Download Porizo and turn a story into a song they can replay.
        </div>
        <div
          style={{
            marginTop: 58,
            background: '#c95f3d',
            color: '#fffaf5',
            borderRadius: 28,
            padding: '24px 36px',
            fontFamily: fonts.body,
            fontSize: 30,
            fontWeight: 900,
            width: 'fit-content',
            boxShadow: '0 18px 48px rgba(201,95,61,0.28)',
          }}
        >
          Download Porizo app
        </div>
        <div style={{marginTop: 20, fontFamily: fonts.body, fontSize: 19, color: '#9a8478'}}>
          {appUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const CompleteWalkthroughSlideshow: React.FC = () => {
  const frame = useCurrentFrame();
  const outroStart = slides.length * slideDuration;
  return (
    <AbsoluteFill style={{background: 'linear-gradient(180deg, #fff9f3 0%, #f1dfd3 100%)'}}>
      <Audio
        src={staticFile('audio/lofi-beat.mp3')}
        loop
        volume={interpolate(frame, [0, 16, 22 * FPS, 24 * FPS], [0, 0.22, 0.22, 0], clamp)}
      />
      {slides.map((_, index) => (
        <Slide key={index} index={index} />
      ))}
      {frame < outroStart && <Progress />}
      {frame >= outroStart && <Outro />}
    </AbsoluteFill>
  );
};
