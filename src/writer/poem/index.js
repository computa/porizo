/**
 * Story-driven poem generator
 *
 * Generates poems from confirmed story context.
 */

const fs = require("fs");
const path = require("path");
const { generateText, isAvailable } = require("../../services/llm-provider");

const PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

function renderTemplate(template, variables) {
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return output;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter((line) => line.length > 0 || line === "");
}

async function generatePoemFromStory({
  narrative,
  primitives,
  motifs,
  recipient_name,
  occasion,
  tone,
  style,
}) {
  if (!narrative || !narrative.trim()) {
    throw new Error("STORY_NARRATIVE_MISSING");
  }

  if (!isAvailable()) {
    const error = new Error("AI_UNAVAILABLE");
    error.code = "AI_UNAVAILABLE";
    throw error;
  }

  const prompt = renderTemplate(PROMPT_TEMPLATE, {
    recipient_name: recipient_name || "",
    occasion: occasion || "",
    tone: tone || "heartfelt",
    style: style || "free verse",
    narrative: narrative.trim(),
    primitives: JSON.stringify(primitives || {}, null, 2),
    motifs: Array.isArray(motifs) && motifs.length > 0 ? motifs.join(", ") : "none",
  });

  const response = await generateText({
    prompt,
    taskType: "lyrics",
    temperature: 0.7,
  });

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (err) {
    throw new Error("POEM_RESPONSE_PARSE_FAILED");
  }

  const lines = normalizeLines(parsed.lines);
  if (lines.length === 0) {
    throw new Error("POEM_RESPONSE_EMPTY");
  }

  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    lines,
    provider: response.provider,
    model: response.model,
  };
}

module.exports = {
  generatePoemFromStory,
};
