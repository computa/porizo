"use strict";

const { sanitizeForPrompt } = require("../../services/content-filter");
const { sanitizeInput } = require("./text-normalization");

function serializeLyricsDraftForPrompt(lyrics) {
  if (!lyrics || typeof lyrics !== "object" || !Array.isArray(lyrics.sections)) return "";
  const sections = lyrics.sections
    .map((section) => {
      const name = sanitizeInput(section?.name || "section").toUpperCase();
      const lines = Array.isArray(section?.lines) ? section.lines : [];
      if (lines.length === 0) return "";
      return `${name}:\n${lines.map((line) => `- ${sanitizeForPrompt(typeof line === "string" ? line : (line && line.text) || "")}`).join("\n")}`;
    })
    .filter(Boolean);
  return sections.join("\n\n");
}

function summarizeExistingSections(sections = []) {
  if (!Array.isArray(sections) || sections.length === 0) return "";
  return sections
    .filter((section) => section && Array.isArray(section.lines) && section.lines.length > 0)
    .map((section) => {
      const name = sanitizeInput(section.name || "section").toUpperCase();
      const lines = section.lines
        .map((line) => sanitizeForPrompt(typeof line === "string" ? line : (line && line.text) || ""))
        .filter(Boolean);
      return lines.length > 0
        ? `${name}:\n${lines.map((line) => `- ${line}`).join("\n")}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function getSectionText(lyrics, sectionName) {
  if (!lyrics || !Array.isArray(lyrics.sections)) return "";
  const section = lyrics.sections.find((entry) => String(entry?.name || "").toLowerCase() === String(sectionName || "").toLowerCase());
  if (!section || !Array.isArray(section.lines)) return "";
  return section.lines
    .map((line) => typeof line === "string" ? line : (line && line.text) || "")
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  getSectionText,
  serializeLyricsDraftForPrompt,
  summarizeExistingSections,
};
