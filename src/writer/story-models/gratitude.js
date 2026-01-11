/**
 * Gratitude/Thank You Story Arc Model
 *
 * Focus: What they DID, how it CHANGED things, who they ARE
 *
 * This model extracts the specific actions and their impact,
 * making the receiver understand exactly what they did and why it mattered.
 */

const {
  createFindGaps,
  createIsStoryComplete,
  createAnchorExtractor,
  hasElement,
} = require("./base");

const STORY_ELEMENTS = {
  context: {
    id: "context",
    name: "Context",
    description: "What was happening in your life when they helped",
    priority: 7,
    questionHints: [
      "What was going on in your life?",
      "What situation were you in?",
      "What were you facing?",
    ],
    anchorWords: ["was", "going", "through", "time", "when", "during", "struggling", "needed"],
    exampleQuestion: "What was going on in your life when {recipient} helped you?",
  },

  their_action: {
    id: "their_action",
    name: "Their Action",
    description: "What SPECIFICALLY did they do - the concrete action",
    priority: 10, // Essential for gratitude
    questionHints: [
      "What exactly did they do?",
      "What was their specific action?",
      "How did they help?",
    ],
    anchorWords: ["did", "helped", "gave", "showed", "took", "came", "stayed", "listened"],
    exampleQuestion: "What specifically did {recipient} do for you?",
  },

  impact: {
    id: "impact",
    name: "Impact",
    description: "How did their action change things for you",
    priority: 10, // Essential - the heart of gratitude
    questionHints: [
      "How did that change things?",
      "What difference did it make?",
      "What happened because of what they did?",
    ],
    anchorWords: ["changed", "made", "because", "now", "able", "could", "finally", "helped me"],
    exampleQuestion: "How did what {recipient} did change things for you?",
  },

  without_them: {
    id: "without_them",
    name: "Without Them",
    description: "What would have happened if they hadn't been there",
    priority: 8,
    questionHints: [
      "What would have happened otherwise?",
      "Where would you be without them?",
      "What if they hadn't helped?",
    ],
    anchorWords: ["without", "wouldn't", "couldn't", "never", "if not", "otherwise"],
    exampleQuestion: "Where would you be if {recipient} hadn't been there?",
  },

  who_they_are: {
    id: "who_they_are",
    name: "Who They Are",
    description: "What this action reveals about their character",
    priority: 9,
    questionHints: [
      "What does this say about them?",
      "What kind of person are they?",
      "What quality made them do this?",
    ],
    anchorWords: ["kind", "always", "person", "never", "type", "that's", "who", "they're"],
    exampleQuestion: "What does this say about who {recipient} is as a person?",
  },

  your_feeling: {
    id: "your_feeling",
    name: "Your Feeling",
    description: "How you feel now because of them - the emotional truth",
    priority: 9,
    questionHints: [
      "How do you feel now?",
      "What does it mean to you?",
      "How do you feel when you think about it?",
    ],
    anchorWords: ["feel", "grateful", "thankful", "blessed", "lucky", "appreciate", "means"],
    exampleQuestion: "How do you feel now, looking back at what {recipient} did?",
  },

  relationship: {
    id: "relationship",
    name: "Relationship & Intent",
    description: "Who they are to you and what you want them to feel",
    priority: 6, // Nice to have, not essential
    questionHints: [
      "How would you describe your relationship?",
      "What do you hope they feel when they hear this?",
    ],
    anchorWords: ["friend", "colleague", "mentor", "boss", "teacher", "neighbor", "family"],
    exampleQuestion: "How would you describe your relationship with {recipient}?",
    optional: true,
  },
};

const PRIORITY_ORDER = [
  "context",
  "their_action",
  "impact",
  "without_them",
  "who_they_are",
  "your_feeling",
  "relationship", // Optional - asked if time permits
];

const MINIMUM_REQUIRED = ["their_action", "impact", "who_they_are"];

const MAX_QUESTIONS = 6;

// Create arc-specific functions from base module
const findGaps = createFindGaps({ STORY_ELEMENTS, PRIORITY_ORDER });
const isStoryComplete = createIsStoryComplete({ MINIMUM_REQUIRED, PRIORITY_ORDER, MAX_QUESTIONS });

// Anchor indicators for gratitude story - actions and their impact
const extractAnchors = createAnchorExtractor([
  {
    type: "action",
    element: "their_action",
    indicators: {
      helped: "Tell me more about how they helped.",
      gave: "Tell me more about what they gave.",
      showed: "Tell me more about what they showed you.",
      stayed: "Tell me more about how they stayed.",
      listened: "Tell me more about how they listened.",
    },
  },
  {
    type: "impact",
    element: "impact",
    indicators: {
      changed: "What exactly changed because of that?",
      "made me": "How did that make you feel?",
      finally: "What were you finally able to do?",
      able: "What were you able to do because of that?",
    },
  },
]);

function getArcContext() {
  return {
    arcName: "gratitude",
    arcDisplayName: "Thank You Story",
    arcDescription: "A story of kindness, impact, and the character behind the action",
    emotionalGoal: "Make the receiver understand exactly what they did and why it mattered",
    toneGuidance: "Sincere, specific, action-focused",
    avoidPhrases: [
      "thank you so much",
      "you're the best",
      "I appreciate you",
      "you're so kind",
    ],
    seekPhrases: [
      "the specific thing they did",
      "how life changed because of it",
      "what it says about who they are",
      "where you'd be without them",
    ],
  };
}

module.exports = {
  STORY_ELEMENTS,
  PRIORITY_ORDER,
  MINIMUM_REQUIRED,
  MAX_QUESTIONS,
  hasElement,
  findGaps,
  isStoryComplete,
  extractAnchors,
  getArcContext,
};
