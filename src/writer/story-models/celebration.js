/**
 * Celebration/Birthday Story Arc Model
 *
 * Focus: Who they ARE, their journey, their impact on your life
 *
 * This model captures the essence of a person through memories and
 * specific traits, making them feel truly known and celebrated.
 */

const STORY_ELEMENTS = {
  defining_memory: {
    id: "defining_memory",
    name: "Defining Memory",
    description: "A specific memory that shows who they really are",
    priority: 10, // Essential - stories need a scene
    questionHints: [
      "A memory that captures who they are",
      "A moment that shows their true self",
      "A story that says everything about them",
    ],
    anchorWords: ["remember", "time", "when", "once", "there was", "this one time"],
    exampleQuestion: "What's a memory of {recipient} that captures exactly who they are?",
  },

  character_trait: {
    id: "character_trait",
    name: "Character Trait",
    description: "A specific trait or quality you admire - not generic praise",
    priority: 10, // Essential for celebration
    questionHints: [
      "What quality do you admire most?",
      "What makes them unique?",
      "What do people notice about them?",
    ],
    anchorWords: ["always", "never", "way", "how", "makes", "thing about", "love that"],
    exampleQuestion: "What's the quality about {recipient} that you admire most?",
  },

  how_theyve_grown: {
    id: "how_theyve_grown",
    name: "How They've Grown",
    description: "What's changed, what's stayed the same over time",
    priority: 7,
    questionHints: [
      "How have they changed?",
      "What's stayed the same?",
      "How have they grown?",
    ],
    anchorWords: ["used to", "now", "still", "changed", "grown", "become", "same"],
    exampleQuestion: "How has {recipient} grown or changed since you've known them?",
  },

  their_impact: {
    id: "their_impact",
    name: "Their Impact",
    description: "How they've touched your life specifically",
    priority: 9,
    questionHints: [
      "How have they affected your life?",
      "What have they taught you?",
      "How are you different because of them?",
    ],
    anchorWords: ["taught", "showed", "made me", "because of", "thanks to", "helped me"],
    exampleQuestion: "How has knowing {recipient} changed your life?",
  },

  specific_admiration: {
    id: "specific_admiration",
    name: "Specific Admiration",
    description: "Something specific you admire - not 'you're amazing'",
    priority: 8,
    questionHints: [
      "What do you admire about how they handle things?",
      "What have you seen them do that impressed you?",
      "When were you proud of them?",
    ],
    anchorWords: ["proud", "impressed", "admire", "respect", "looked up", "inspired"],
    exampleQuestion: "What's something {recipient} does that you really admire?",
  },

  wish_for_them: {
    id: "wish_for_them",
    name: "Wish For Them",
    description: "What you hope for their future - receiver-focused",
    priority: 7,
    questionHints: [
      "What do you wish for them?",
      "What do you hope their future holds?",
      "What do they deserve?",
    ],
    anchorWords: ["hope", "wish", "deserve", "want for", "future", "dream"],
    exampleQuestion: "What do you hope the future holds for {recipient}?",
  },
};

const PRIORITY_ORDER = [
  "defining_memory",
  "character_trait",
  "their_impact",
  "specific_admiration",
  "how_theyve_grown",
  "wish_for_them",
];

const MINIMUM_REQUIRED = ["defining_memory", "character_trait", "their_impact"];

const MAX_QUESTIONS = 6;

function hasElement(storyContext, elementId) {
  const value = storyContext.elements?.[elementId];
  return value && value.trim().length > 10;
}

function findGaps(storyContext) {
  const gaps = [];

  for (const elementId of PRIORITY_ORDER) {
    if (!hasElement(storyContext, elementId)) {
      gaps.push({
        elementId,
        element: STORY_ELEMENTS[elementId],
        priority: STORY_ELEMENTS[elementId].priority,
      });
    }
  }

  gaps.sort((a, b) => b.priority - a.priority);
  return gaps;
}

function isStoryComplete(storyContext) {
  const missingRequired = MINIMUM_REQUIRED.filter(
    (elementId) => !hasElement(storyContext, elementId)
  );

  const filledCount = PRIORITY_ORDER.filter(
    (elementId) => hasElement(storyContext, elementId)
  ).length;

  const progress = Math.round((filledCount / PRIORITY_ORDER.length) * 100);
  const questionCount = storyContext.questionCount || 0;
  const reachedMaxQuestions = questionCount >= MAX_QUESTIONS;

  return {
    complete: missingRequired.length === 0 || reachedMaxQuestions,
    missingRequired,
    progress,
    filledElements: filledCount,
    totalElements: PRIORITY_ORDER.length,
    reachedMaxQuestions,
  };
}

function extractAnchors(answer) {
  const anchors = [];
  const lowerAnswer = answer.toLowerCase();

  // Look for memory indicators
  const memoryIndicators = ["remember", "time", "when", "once", "moment"];
  for (const word of memoryIndicators) {
    if (lowerAnswer.includes(word)) {
      anchors.push({
        word,
        type: "memory",
        followUp: `Tell me more about that moment.`,
      });
    }
  }

  // Look for trait indicators
  const traitIndicators = ["always", "never", "way they", "how they"];
  for (const phrase of traitIndicators) {
    if (lowerAnswer.includes(phrase)) {
      anchors.push({
        word: phrase,
        type: "trait",
        followUp: `Can you give me an example of that?`,
      });
    }
  }

  return anchors;
}

function getArcContext() {
  return {
    arcName: "celebration",
    arcDisplayName: "Celebration Story",
    arcDescription: "A celebration of who they are through specific memories and traits",
    emotionalGoal: "Make the receiver feel truly known and celebrated",
    toneGuidance: "Joyful, specific, memory-rich",
    avoidPhrases: [
      "happy birthday",
      "you're amazing",
      "have a great day",
      "you're the best",
    ],
    seekPhrases: [
      "a specific memory that captures them",
      "a trait shown through action",
      "how they've impacted your life",
      "what you wish for their future",
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
