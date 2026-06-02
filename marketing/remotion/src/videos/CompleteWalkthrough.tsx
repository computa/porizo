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
import {fonts} from '../tokens';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const appUrl = 'apps.apple.com/app/porizo-song-gift-maker/id6744547877';

const assets = {
  login: staticFile('app/complete-walkthrough/01-login.jpg'),
  occasion: staticFile('app/complete-walkthrough/02-occasion.jpg'),
  recipient: staticFile('app/complete-walkthrough/03-recipient.jpg'),
  story: staticFile('app/complete-walkthrough/04-story.jpg'),
  lyrics: staticFile('app/complete-walkthrough/05-lyrics.jpeg'),
  generation: staticFile('app/complete-walkthrough/06-generation.jpg'),
  reveal: staticFile('app/complete-walkthrough/07-reveal.jpeg'),
  nowPlayingVideo: staticFile('app/complete-walkthrough/08-nowplaying.mp4'),
};

const steps = [
  {
    label: 'Login',
    title: 'Sign in',
    detail: 'Start with Apple or phone number.',
    start: 0,
    end: 110,
    mode: 'image',
    src: assets.login,
  },
  {
    label: 'Story',
    title: 'Create the story',
    detail: 'Choose the occasion, recipient, and memory.',
    start: 110,
    end: 280,
    mode: 'montage',
    src: [assets.occasion, assets.recipient, assets.story],
  },
  {
    label: 'Lyrics',
    title: 'Review lyrics',
    detail: 'Porizo shapes the memory into song-ready lyrics.',
    start: 280,
    end: 400,
    mode: 'image',
    src: assets.lyrics,
  },
  {
    label: 'Generate',
    title: 'Generate the song',
    detail: 'Create the full song gift from the story.',
    start: 400,
    end: 520,
    mode: 'generation',
    src: assets.generation,
  },
  {
    label: 'Reveal',
    title: 'Reveal the gift',
    detail: 'Open the finished song gift page.',
    start: 520,
    end: 640,
    mode: 'image',
    src: assets.reveal,
  },
  {
    label: 'Now Playing',
    title: 'Play and share',
    detail: 'Listen with lyrics, then send it.',
    start: 640,
    end: 760,
    mode: 'video',
    src: assets.nowPlayingVideo,
  },
] as const;

const Logo: React.FC = () => (
  <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
    <Img
      src={staticFile('app/brand/app-icon.png')}
      style={{
        width: 66,
        height: 66,
        borderRadius: 18,
        boxShadow: '0 14px 36px rgba(201,95,61,0.22)',
      }}
    />
    <div>
      <div style={{fontFamily: fonts.display, fontSize: 38, lineHeight: 1, color: '#2b2019'}}>
        Porizo
      </div>
      <div style={{fontFamily: fonts.body, fontSize: 16, color: '#8a7164', marginTop: 4}}>
        complete walkthrough
      </div>
    </div>
  </div>
);

const useActiveStep = () => {
  const frame = useCurrentFrame();
  return steps.find((step) => frame >= step.start && frame < step.end) ?? steps[steps.length - 1];
};

const StepCopy: React.FC = () => {
  const frame = useCurrentFrame();
  const step = useActiveStep();

  return (
    <div style={{position: 'absolute', left: 72, right: 72, top: 166}}>
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
        {step.label}
      </div>
      <div style={{position: 'relative', height: 170}}>
        {steps.map((item) => {
          const local = frame - item.start;
          const opacity =
            item.start === 0
              ? interpolate(local, [0, item.end - item.start - 16, item.end - item.start], [1, 1, 0], clamp)
              : item === steps[steps.length - 1]
                ? interpolate(local, [0, 16], [0, 1], clamp)
                : interpolate(local, [0, 16, item.end - item.start - 16, item.end - item.start], [0, 1, 1, 0], clamp);
          const y = interpolate(local, [0, 18], [24, 0], {...clamp, easing: Easing.out(Easing.cubic)});
          return (
            <div
              key={item.label}
              style={{
                position: 'absolute',
                inset: 0,
                opacity,
                transform: `translateY(${y}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: fonts.display,
                  fontSize: 70,
                  lineHeight: 1,
                  color: '#2b2019',
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontFamily: fonts.body,
                  fontSize: 27,
                  lineHeight: 1.36,
                  color: '#766156',
                  marginTop: 18,
                  maxWidth: 850,
                }}
              >
                {item.detail}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PhoneContent: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <>
      {steps.map((step) => {
        const local = frame - step.start;
        const duration = step.end - step.start;
        const isLast = step === steps[steps.length - 1];
        const opacity =
          step.start === 0
            ? interpolate(local, [0, duration - 14, duration], [1, 1, 0], clamp)
            : isLast
              ? interpolate(local, [0, 14], [0, 1], clamp)
              : interpolate(local, [0, 14, duration - 14, duration], [0, 1, 1, 0], clamp);

        if (step.mode === 'montage') {
          const srcs = step.src;
          const index = Math.min(srcs.length - 1, Math.floor(Math.max(0, local) / Math.ceil(duration / srcs.length)));
          return (
            <Img
              key={step.label}
              src={srcs[index]}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity,
              }}
            />
          );
        }

        if (step.mode === 'video') {
          return (
            <div key={step.label} style={{position: 'absolute', inset: 0, opacity}}>
              <OffthreadVideo
                src={step.src}
                muted
                startFrom={520}
                style={{width: '100%', height: '100%', objectFit: 'cover'}}
              />
            </div>
          );
        }

        return (
          <div key={step.label} style={{position: 'absolute', inset: 0, opacity}}>
            <Img
              src={step.src}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {step.mode === 'generation' && (
              <div
                style={{
                  position: 'absolute',
                  left: 42,
                  right: 42,
                  bottom: 70,
                  borderRadius: 26,
                  background: 'rgba(43,32,25,0.90)',
                  color: '#fffaf5',
                  padding: '23px 28px',
                  fontFamily: fonts.body,
                  fontSize: 24,
                  fontWeight: 850,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>Generating your song</span>
                <span style={{letterSpacing: 5}}>
                  {Array.from({length: 4})
                    .map((_, index) => (Math.floor(local / 8) % 4 >= index ? '•' : '·'))
                    .join('')}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

const PhoneFrame: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, durationInFrames: 34, config: {damping: 220}});

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 500,
        width: 452,
        height: 982,
        transform: `translateX(-50%) translateY(${interpolate(enter, [0, 1], [44, 0])}px)`,
        borderRadius: 70,
        padding: 12,
        background: '#17110e',
        boxShadow: '0 38px 92px rgba(43,32,25,0.25)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 58,
          overflow: 'hidden',
          background: '#fff8f1',
        }}
      >
        <PhoneContent />
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: -8,
          width: 154,
          height: 36,
          transform: 'translateX(-50%)',
          borderRadius: 999,
          background: '#0c0907',
        }}
      />
    </div>
  );
};

const ProgressRail: React.FC = () => {
  const frame = useCurrentFrame();
  const active = steps.findIndex((step) => frame >= step.start && frame < step.end);
  const progress = interpolate(frame, [0, 760], [0, 1], clamp);

  return (
    <div style={{position: 'absolute', left: 70, right: 70, bottom: 76}}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 23,
        }}
      >
        {steps.map((step, index) => (
          <div
            key={step.label}
            style={{
              width: 146,
              height: 46,
              borderRadius: 999,
              background: index === active ? '#2b2019' : 'rgba(43,32,25,0.07)',
              color: index === active ? '#fffaf5' : '#8a7164',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.body,
              fontSize: 15,
              fontWeight: 850,
              textAlign: 'center',
            }}
          >
            {step.label}
          </div>
        ))}
      </div>
      <div style={{height: 6, borderRadius: 6, background: 'rgba(43,32,25,0.12)', overflow: 'hidden'}}>
        <div style={{height: '100%', width: `${progress * 100}%`, background: '#c95f3d'}} />
      </div>
    </div>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - 760;
  const opacity = interpolate(local, [0, 18], [0, 1], clamp);
  const y = interpolate(local, [0, 22], [44, 0], {...clamp, easing: Easing.out(Easing.cubic)});

  return (
    <AbsoluteFill style={{background: '#fff9f3', opacity, justifyContent: 'center', padding: 78}}>
      <div style={{transform: `translateY(${y}px)`}}>
        <Logo />
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 78,
            lineHeight: 1.04,
            color: '#2b2019',
            marginTop: 70,
            maxWidth: 850,
          }}
        >
          Create the song gift in minutes.
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 29,
            lineHeight: 1.42,
            color: '#766156',
            marginTop: 28,
            maxWidth: 810,
          }}
        >
          Download Porizo and turn a memory into a song they can replay.
        </div>
        <div
          style={{
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
        <div style={{marginTop: 20, fontFamily: fonts.body, fontSize: 19, color: '#9a8478'}}>
          {appUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const CompleteWalkthrough: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: 'linear-gradient(180deg, #fff9f3 0%, #f3e2d7 100%)'}}>
      <Audio
        src={staticFile('audio/lofi-beat.mp3')}
        loop
        volume={interpolate(frame, [0, 16, 820, 870], [0, 0.24, 0.24, 0], clamp)}
      />
      <div style={{position: 'absolute', left: 72, top: 70}}>
        <Logo />
      </div>
      <StepCopy />
      <PhoneFrame />
      <ProgressRail />
      {frame >= 760 && <Outro />}
    </AbsoluteFill>
  );
};
