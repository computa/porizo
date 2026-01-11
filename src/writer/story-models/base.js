/**
 * Base Story Model Functions
 *
 * Shared logic for all story arc models. Each arc (love, gratitude, celebration)
 * has different elements and priorities, but the gap-finding and completion
 * logic is identical.
 *
 * This module provides factory functions that create arc-specific implementations
 * from the arc's constants (STORY_ELEMENTS, PRIORITY_ORDER, etc.).
 */

const {
  hasElement,
  findWeakElements,
} = require("../element-quality");

/**
 * Create a findGaps function for a specific story arc
 *
 * @param {Object} config - Arc configuration
 * @param {Object} config.STORY_ELEMENTS - Element definitions
 * @param {Array} config.PRIORITY_ORDER - Element priority order
 * @returns {Function} findGaps(storyContext) => Array of gaps
 */
function createFindGaps({ STORY_ELEMENTS, PRIORITY_ORDER }) {
  return function findGaps(storyContext) {
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

    // Sort by priority (highest first)
    gaps.sort((a, b) => b.priority - a.priority);

    return gaps;
  };
}

/**
 * Create an isStoryComplete function for a specific story arc
 *
 * @param {Object} config - Arc configuration
 * @param {Array} config.MINIMUM_REQUIRED - Required element IDs
 * @param {Array} config.PRIORITY_ORDER - Element priority order
 * @param {number} config.MAX_QUESTIONS - Maximum questions before forced completion
 * @returns {Function} isStoryComplete(storyContext) => completion status object
 */
function createIsStoryComplete({ MINIMUM_REQUIRED, PRIORITY_ORDER, MAX_QUESTIONS }) {
  return function isStoryComplete(storyContext) {
    const missingRequired = MINIMUM_REQUIRED.filter(
      (elementId) => !hasElement(storyContext, elementId)
    );

    const filledCount = PRIORITY_ORDER.filter(
      (elementId) => hasElement(storyContext, elementId)
    ).length;

    const progress = Math.round((filledCount / PRIORITY_ORDER.length) * 100);
    const questionCount = storyContext.questionCount || 0;
    const reachedMaxQuestions = questionCount >= MAX_QUESTIONS;

    // Find weak elements that could benefit from more detail
    const weakElements = findWeakElements(storyContext, PRIORITY_ORDER);

    // Don't force complete at MAX_QUESTIONS if we don't have minimum content
    const minRequiredFilled = MINIMUM_REQUIRED.filter(
      (elementId) => hasElement(storyContext, elementId)
    ).length;
    const minRequiredCount = MINIMUM_REQUIRED.length;
    const hasAdequateContent = minRequiredFilled >= minRequiredCount - 1;

    const complete =
      missingRequired.length === 0 ||
      (reachedMaxQuestions && hasAdequateContent);

    return {
      complete,
      missingRequired,
      progress,
      filledElements: filledCount,
      totalElements: PRIORITY_ORDER.length,
      reachedMaxQuestions,
      weakElements,
      hasAdequateContent,
    };
  };
}

/**
 * Create anchor extraction function with word boundary matching
 *
 * @param {Object} indicatorConfig - Maps indicator words to follow-up info
 * @returns {Function} Anchor extractor that returns max 1 anchor
 */
function createAnchorExtractor(indicatorGroups) {
  return function extractAnchors(answer) {
    const anchors = [];
    const lowerAnswer = answer.toLowerCase();

    for (const group of indicatorGroups) {
      const { indicators, type, element } = group;

      for (const [word, followUp] of Object.entries(indicators)) {
        const regex = new RegExp(`\\b${word}\\b`, "i");
        if (regex.test(lowerAnswer)) {
          anchors.push({
            word,
            type,
            followUp,
            element,
          });
          break; // Only one anchor per group
        }
      }
    }

    // Return max 1 anchor to avoid overwhelming
    return anchors.slice(0, 1);
  };
}

module.exports = {
  createFindGaps,
  createIsStoryComplete,
  createAnchorExtractor,
  // Re-export for convenience
  hasElement,
  findWeakElements,
};
