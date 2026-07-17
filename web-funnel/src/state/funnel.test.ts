import { describe, expect, it } from "vitest";
import {
  buildTrackRequest,
  createInitialState,
  funnelReducer,
  occasionKey,
  parseStoredState,
  serializeState,
  type FunnelState,
} from "./funnel";

describe("funnel state", () => {
  it("advances, preserves answers during edit, and returns to the prior live step", () => {
    let state = createInitialState();
    state = funnelReducer(state, {
      type: "answer",
      step: "recipient",
      value: "sarah",
    });
    state = funnelReducer(state, { type: "advance" });
    state = funnelReducer(state, {
      type: "answer",
      step: "relationship",
      value: "Mum",
    });
    state = funnelReducer(state, { type: "advance" });
    state = funnelReducer(state, { type: "edit", step: "recipient" });

    expect(state.activeStep).toBe("recipient");
    expect(state.returnStep).toBe("occasion");
    expect(state.answers.relationship).toBe("Mum");

    state = funnelReducer(state, {
      type: "answer",
      step: "recipient",
      value: "Sarah",
    });
    state = funnelReducer(state, { type: "advance" });
    expect(state.activeStep).toBe("occasion");
  });

  it("can recover moderation back to sound instead of an empty theater", () => {
    let state: FunnelState = {
      ...createInitialState(),
      activeStep: "theater",
      furthestStep: "theater",
    };
    state = funnelReducer(state, {
      type: "edit",
      step: "memory",
      returnTo: "sound",
    });
    state = funnelReducer(state, { type: "advance" });

    expect(state.activeStep).toBe("sound");
  });

  it("restores valid progress and rejects corrupt storage", () => {
    const state = funnelReducer(createInitialState(), {
      type: "answer",
      step: "recipient",
      value: "Sarah",
    });
    expect(parseStoredState(serializeState(state))?.answers.recipient).toBe(
      "Sarah",
    );
    expect(parseStoredState("not-json")).toBeNull();
    expect(parseStoredState('{"version":99}')).toBeNull();
    expect(
      parseStoredState(
        '{"version":1,"activeStep":"recipient","answers":{},"artifacts":{}}',
      ),
    ).toBeNull();
    const corruptLyrics = JSON.parse(serializeState(state)) as Record<
      string,
      unknown
    >;
    corruptLyrics.artifacts = { previewGenerations: 1, lyrics: "not-an-array" };
    expect(parseStoredState(JSON.stringify(corruptLyrics))).toBeNull();
  });

  it("preserves the source timestamp when another tab restores state", () => {
    const source = {
      ...createInitialState(),
      savedAt: 1234,
      activeStep: "memory" as const,
      furthestStep: "memory" as const,
    };

    expect(
      funnelReducer(createInitialState(), { type: "restore", state: source })
        .savedAt,
    ).toBe(1234);
  });

  it("maps the completed quiz to the exact track-create contract", () => {
    const state = {
      ...createInitialState(),
      answers: {
        recipient: "Sarah",
        relationship: "Mum",
        occasion: "I Love You ❤️",
        occasionDate: "July 26",
        memory: "She sang in the kitchen every Sunday morning.",
        specialPhrase: "Love you to the moon",
        genre: "Acoustic",
        mood: "Warm",
        voice: "Female voice",
      },
    };

    expect(buildTrackRequest(state)).toEqual({
      recipient_name: "Sarah",
      relationship_type: "Mum",
      // Canonical enum key, not the emoji display label — the backend artwork
      // path requires the key (iOS sends keys; the funnel used to leak labels).
      occasion: "i_love_you",
      specific_memory: "She sang in the kitchen every Sunday morning.",
      special_phrases: "Love you to the moon",
      message: "I made this song for you, Sarah.",
      style: "Acoustic, warm",
      voice_gender: "female",
      voice_mode: "ai_voice",
    });
  });
});

describe("occasionKey", () => {
  const cases: Array<[string, string]> = [
    ["I Love You ❤️", "i_love_you"],
    ["Celebration 🎉", "celebration"],
    ["Birthday 🎂", "birthday"],
    ["Thank You 🙏", "thank_you"],
    ["Encouragement 💪", "encouragement"],
    ["Anniversary 💑", "anniversary"],
    ["Mother's Day 💐", "mothers_day"],
    ["Wedding 💒", "wedding"],
    ["Graduation 🎓", "graduation"],
    ["Friendship 👫", "friendship"],
    ["Get Well 💊", "get_well"],
    ["Custom ✨", "custom"],
    ["Apology 💐", "apology"],
    ["Advice 🧭", "advice"],
    ["Bereavement 🕊️", "bereavement"],
  ];

  it.each(cases)("maps %s to the enum key %s", (label, key) => {
    expect(occasionKey(label)).toBe(key);
  });

  it("passes an already-canonical key through unchanged", () => {
    expect(occasionKey("i_love_you")).toBe("i_love_you");
    expect(occasionKey("birthday")).toBe("birthday");
  });

  it("falls back to custom for an unrecognized occasion", () => {
    expect(occasionKey("Something Weird 🤔")).toBe("custom");
    expect(occasionKey("")).toBe("custom");
  });
});
