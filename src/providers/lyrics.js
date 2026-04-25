/**
 * Lyrics generation API wrapper
 *
 * Canonical implementation lives in src/writer/songwriter.js.
 * This module re-exports the public API for compatibility.
 */

const songwriter = require("../writer/songwriter");

module.exports = {
  generateLyrics: songwriter.generateLyrics,
  isAIAvailable: songwriter.isAIAvailable,
  buildSongwriterPrompt: songwriter.buildSongwriterPrompt,
  buildLyrics: songwriter.buildLyrics,
  sanitizeInput: songwriter.sanitizeInput,
  validateStyle: songwriter.validateStyle,
  validateSingability: songwriter.validateSingability,
  anchorMessage: songwriter.anchorMessage,
  validateRecipientAnchor: songwriter.validateRecipientAnchor,
  repairRecipientAnchor: songwriter.repairRecipientAnchor,
  validateAndRepairLyrics: songwriter.validateAndRepairLyrics,
  assessRequiredDetailCoverage: songwriter.assessRequiredDetailCoverage,
  countSyllables: songwriter.countSyllables,
  MUSIC_STYLES: songwriter.MUSIC_STYLES,
  RELATIONSHIP_DESCRIPTORS: songwriter.RELATIONSHIP_DESCRIPTORS,
  TARGET_DURATION_SECONDS: songwriter.TARGET_DURATION_SECONDS,
};
