import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Audio,
  staticFile,
} from "remotion";
import { colors, fonts } from "../tokens";
import { PhoneMockup } from "../components/PhoneMockup";
import { PreviewPlayerScreen } from "../components/PorizoScreens";
import { EndCard } from "../components/EndCard";
import { Fade, Vignette } from "../components/SceneTransition";
import { ChatMessage } from "../components/ChatMessage";
import { Particles } from "../components/PhotoScene";

/**
 * Hook25 — 25s attention-first product explainer.
 * Beat map (30fps / 750 frames):
 *   0-75    cold-open hook (gold flash, mega type)
 *   75-165  gift roast (rapid strikethrough cuts)
 *   165-225 the turn ("I gave her a SONG" + waveform burst)
 *   225-465 how it works (chips → writing progress → player, one phone)
 *   465-585 payoff (karaoke lyric + reaction texts)
 *   585-645 value slam triplet
 *   645-750 end card
 * No voice-clone claims anywhere.
 */

/** Full-screen mega text slam with punch-zoom and decaying shake */
const MegaSlam: React.FC<{
  text: string;
  startAt: number;
  duration: number;
  fontSize?: number;
  color?: string;
  bg?: string;
  serif?: boolean;
  shake?: boolean;
  sub?: string;
  strike?: boolean;
}> = ({
  text,
  startAt,
  duration,
  fontSize = 92,
  color = colors.textPrimary,
  bg,
  serif = false,
  shake = false,
  sub,
  strike = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const localFrame = frame - startAt;
  if (localFrame < 0 || localFrame >= duration) return null;

  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 11, stiffness: 190, mass: 0.6 },
  });
  const scale = interpolate(pop, [0, 1], [1.45, 1]);
  const shakeAmp = shake
    ? interpolate(localFrame, [0, 8], [9, 0], { extrapolateRight: "clamp" })
    : 0;
  const dx = Math.sin(localFrame * 7.3) * shakeAmp;
  const dy = Math.cos(localFrame * 8.1) * shakeAmp;
  const strikeW = strike
    ? interpolate(localFrame, [8, 18], [0, 110], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <AbsoluteFill
      style={{
        background: bg ?? "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          textAlign: "center",
          width: Math.min(width * 0.9, 1400),
        }}
      >
        <div
          style={{
            position: "relative",
            display: "inline-block",
            fontFamily: serif ? fonts.display : fonts.body,
            fontStyle: serif ? "italic" : "normal",
            fontSize,
            fontWeight: 800,
            lineHeight: 1.12,
            color,
            letterSpacing: "-0.01em",
          }}
        >
          {text}
          {strike && (
            <div
              style={{
                position: "absolute",
                top: "52%",
                left: "-5%",
                width: `${strikeW}%`,
                height: Math.max(6, fontSize * 0.09),
                background: colors.gold,
                borderRadius: 4,
                transform: "rotate(-4deg)",
              }}
            />
          )}
        </div>
        {sub && (
          <div
            style={{
              marginTop: 26,
              fontFamily: fonts.body,
              fontSize: fontSize * 0.42,
              fontWeight: 600,
              color: color === colors.black ? "#3D2A14" : colors.textSecondary,
              opacity: interpolate(localFrame, [6, 14], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Full-width animated waveform burst */
const WaveBurst: React.FC<{ startAt: number; duration: number }> = ({
  startAt,
  duration,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const localFrame = frame - startAt;
  if (localFrame < 0 || localFrame >= duration) return null;

  const grow = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fade = interpolate(localFrame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bars = 48;

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: 0,
        width,
        height: height * 0.28,
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: (width / bars) * 0.35,
        opacity: 0.5 * fade,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const h =
          (0.25 +
            Math.abs(Math.sin(i * 0.9)) * 0.4 +
            Math.abs(Math.sin(localFrame * 0.28 + i * 0.7)) * 0.35) *
          height *
          0.26 *
          grow;
        return (
          <div
            key={i}
            style={{
              width: (width / bars) * 0.5,
              height: h,
              borderRadius: 6,
              background: colors.gold,
            }}
          />
        );
      })}
    </div>
  );
};

/** Chip that pops into the story input screen */
const Chip: React.FC<{ text: string; startAt: number }> = ({
  text,
  startAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - startAt;
  if (localFrame < 0) return null;
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 160, mass: 0.5 },
  });
  return (
    <div
      style={{
        alignSelf: "flex-start",
        padding: "10px 16px",
        borderRadius: 20,
        background: colors.surfaceLight,
        border: `1px solid ${colors.gold}66`,
        color: colors.textPrimary,
        fontFamily: fonts.body,
        fontSize: 16,
        fontWeight: 600,
        transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])})`,
        opacity: pop,
        transformOrigin: "bottom left",
      }}
    >
      {text}
    </div>
  );
};

/** In-phone: "what makes her special" chips + CTA button */
const ChipsScreen: React.FC<{ ctaAt: number }> = ({ ctaAt }) => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame * 0.35) * 0.03;
  const ctaOn = frame >= ctaAt;
  return (
    <div
      style={{
        height: "100%",
        padding: "28px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: colors.background,
      }}
    >
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 24,
          color: colors.textPrimary,
          marginBottom: 6,
        }}
      >
        What makes <span style={{ color: colors.gold }}>Mom</span> special?
      </div>
      <Chip text="packs my lunch. still." startAt={252} />
      <Chip text="calls every Sunday" startAt={282} />
      <Chip text="her terrible dancing 💃" startAt={312} />
      <div style={{ flex: 1 }} />
      {ctaOn && (
        <div
          style={{
            padding: "16px 0",
            borderRadius: 16,
            background: colors.gold,
            color: colors.black,
            fontFamily: fonts.body,
            fontSize: 18,
            fontWeight: 700,
            textAlign: "center",
            transform: `scale(${pulse})`,
            marginBottom: 18,
          }}
        >
          Make her song →
        </div>
      )}
    </div>
  );
};

/** In-phone: fake render progress */
const WritingScreen: React.FC<{ startAt: number }> = ({ startAt }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startAt;
  const pct = interpolate(localFrame, [0, 42], [0, 100], {
    extrapolateRight: "clamp",
  });
  const stage =
    localFrame < 15
      ? "Writing her lyrics…"
      : localFrame < 30
        ? "Composing the melody…"
        : "Recording vocals…";
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: colors.background,
        padding: "0 28px",
      }}
    >
      <div
        style={{
          fontSize: 44,
          transform: `rotate(${Math.sin(localFrame * 0.3) * 12}deg)`,
        }}
      >
        🎵
      </div>
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 17,
          fontWeight: 600,
          color: colors.textPrimary,
        }}
      >
        {stage}
      </div>
      <div
        style={{
          width: "100%",
          height: 8,
          borderRadius: 4,
          background: colors.surfaceLight,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: colors.gold,
            borderRadius: 4,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 13,
          color: colors.textSecondary,
        }}
      >
        {Math.round(pct)}% — takes minutes, not weeks
      </div>
    </div>
  );
};

/** Karaoke lyric with gold sweep */
const KaraokeLine: React.FC<{
  text: string;
  startAt: number;
  duration: number;
}> = ({ text, startAt, duration }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const localFrame = frame - startAt;
  if (localFrame < 0 || localFrame >= duration) return null;
  const sweep = interpolate(localFrame, [6, duration - 22], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fade = interpolate(
    localFrame,
    [0, 8, duration - 10, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const style: React.CSSProperties = {
    fontFamily: fonts.display,
    fontStyle: "italic",
    fontSize: width > height ? 66 : 78,
    fontWeight: 700,
    lineHeight: 1.35,
    textAlign: "center",
  };
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fade,
      }}
    >
      <div style={{ position: "relative", width: Math.min(width * 0.9, 1400) }}>
        <div style={{ ...style, color: colors.textTertiary }}>{text}</div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 ${100 - sweep}% 0 0)`,
          }}
        >
          <div style={{ ...style, color: colors.gold }}>{text}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Hook25: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const isLandscape = width > height;

  // Phone-section caption placement: above the phone in 9:16, beside it in 16:9
  const phoneX = isLandscape ? 260 : 0;
  const captionStyle: React.CSSProperties = isLandscape
    ? {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(calc(-50% - 500px), -50%)",
        width: 620,
      }
    : {
        position: "absolute",
        top: 70,
        left: "50%",
        transform: "translateX(-50%)",
        width: width * 0.9,
      };

  const phoneCaption = (text: string, from: number, to: number) => {
    if (frame < from || frame >= to) return null;
    const o = interpolate(frame, [from, from + 8, to - 8, to], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <div
        style={{
          ...captionStyle,
          opacity: o,
          textAlign: "center",
          fontFamily: fonts.body,
          fontSize: isLandscape ? 58 : 64,
          fontWeight: 800,
          color: colors.textPrimary,
          lineHeight: 1.2,
        }}
      >
        {text}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ background: colors.background }}>
      <Audio
        src={staticFile("audio/lofi-beat.mp3")}
        volume={interpolate(frame, [0, 4, 700, 750], [0, 0.5, 0.5, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
      />

      {/* ── BEAT 0: cold-open hook ── */}
      <MegaSlam
        text="I made my mom cry."
        startAt={0}
        duration={38}
        fontSize={isLandscape ? 110 : 92}
        color={colors.black}
        bg={colors.gold}
        shake
      />
      <MegaSlam
        text="with a 3-minute song."
        startAt={38}
        duration={37}
        fontSize={isLandscape ? 104 : 86}
        color={colors.gold}
        bg={colors.background}
        shake
        serif
      />

      {/* ── BEAT 1: gift roast ── */}
      <MegaSlam
        text="Flowers?"
        startAt={75}
        duration={30}
        fontSize={isLandscape ? 104 : 88}
        sub="dead by Friday 🥀"
        strike
        shake
      />
      <MegaSlam
        text="A card?"
        startAt={105}
        duration={30}
        fontSize={isLandscape ? 104 : 88}
        sub="junk drawer by Sunday"
        strike
        shake
      />
      <MegaSlam
        text="A gift card?"
        startAt={135}
        duration={30}
        fontSize={isLandscape ? 104 : 88}
        sub="be serious."
        strike
        shake
      />

      {/* ── BEAT 2: the turn ── */}
      <WaveBurst startAt={168} duration={57} />
      <MegaSlam
        text="So I gave her a SONG."
        startAt={165}
        duration={60}
        fontSize={isLandscape ? 112 : 90}
        color={colors.gold}
        serif
        shake
      />
      {frame >= 165 && frame < 225 && (
        <Particles count={6} color={colors.gold} speed={0.15} size={3} />
      )}

      {/* ── BEAT 3: how it works — one phone, three states ── */}
      <Fade startAt={225} endAt={465} fadeIn={8} fadeOut={10}>
        <AbsoluteFill>
          <PhoneMockup
            startAt={228}
            scale={isLandscape ? 1.15 : 2.1}
            x={phoneX}
            y={isLandscape ? 0 : 80}
          >
            {frame < 358 ? (
              <ChipsScreen ctaAt={336} />
            ) : frame < 404 ? (
              <WritingScreen startAt={358} />
            ) : (
              <PreviewPlayerScreen
                songTitle="A Song for Mom"
                recipientName="Mom"
                isPlaying
              />
            )}
          </PhoneMockup>
          {phoneCaption("Type 3 things about her.", 236, 356)}
          {phoneCaption("Porizo turns them into a REAL song.", 366, 462)}
          <Vignette intensity={0.35} />
        </AbsoluteFill>
      </Fade>

      {/* ── BEAT 4: payoff ── */}
      <KaraokeLine
        text="“Sunday morning, my phone rings — it’s you…”"
        startAt={465}
        duration={62}
      />
      <Fade startAt={527} endAt={588} fadeIn={6} fadeOut={8}>
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 420,
              transform: `scale(${isLandscape ? 1.5 : 2.2})`,
            }}
          >
            <ChatMessage
              text="WHO MADE THIS"
              sender="Mom"
              isMe={false}
              startAt={531}
            />
            <ChatMessage
              text="I've played it 11 times already 😭"
              sender="Mom"
              isMe={false}
              startAt={550}
            />
            <ChatMessage
              text="took me 3 minutes in Porizo"
              isMe={true}
              startAt={569}
            />
          </div>
        </AbsoluteFill>
      </Fade>

      {/* ── BEAT 5: value slam + close ── */}
      <MegaSlam
        text="Cheaper than flowers."
        startAt={588}
        duration={20}
        fontSize={isLandscape ? 92 : 76}
      />
      <MegaSlam
        text="Faster than shipping."
        startAt={608}
        duration={20}
        fontSize={isLandscape ? 92 : 76}
      />
      <MegaSlam
        text="Kept forever."
        startAt={628}
        duration={22}
        fontSize={isLandscape ? 100 : 84}
        color={colors.gold}
        serif
        shake
      />

      <Fade startAt={650} endAt={750} fadeIn={10} fadeOut={3}>
        <AbsoluteFill>
          <Particles count={6} color={colors.gold} speed={0.05} size={2} />
          <EndCard tagline="Song Gift Maker" startAt={656} />
        </AbsoluteFill>
      </Fade>
    </AbsoluteFill>
  );
};
