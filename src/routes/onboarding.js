"use strict";

const fs = require("fs/promises");
const path = require("path");

/**
 * Onboarding Routes
 *
 * API routes for the V2 onboarding flow.
 * Provides personalized song suggestion based on questionnaire answers.
 */

// Deterministic preview lines keyed by (relationship_type, emotional_seed).
// Mirrors the iOS FallbackSuggestion for consistency.
const SEED_PREVIEW_MAP = {
  thank_you_everything: {
    _default: "For every moment you gave without asking, {name}...",
  },
  childhood_memory: {
    _default: "Remember those days that felt like they'd last forever...",
  },
  unsaid_words: {
    _default: "There's something I've been meaning to tell you, {name}...",
  },
  first_met: {
    _default: "From the very first moment I knew, {name}...",
  },
  inside_joke: {
    _default: "Nobody else would understand, but we always will...",
  },
  always_remember: {
    _default: "Hold onto this, {name} — it's yours forever...",
  },
  growing_up: {
    _default: "Side by side through everything, {name}...",
  },
  survived_together: {
    _default: "We made it through, and that's what matters...",
  },
  how_we_met: {
    _default: "Who knew that day would change everything, {name}...",
  },
  always_laugh: {
    _default: "Every time I think of it, I can't help but smile...",
  },
  changed_everything: {
    _default: "That moment when everything shifted, {name}...",
  },
  proud: {
    _default: "If you could see yourself through my eyes, {name}...",
  },
  made_me_smile: {
    _default: "That look on your face, {name} — I'll never forget it...",
  },
  pass_on: {
    _default: "Carry this with you always, {name}...",
  },
  treasured_memory: {
    _default: "Some moments become part of who we are, {name}...",
  },
  always_admired: {
    _default: "The way you see the world, {name} — it inspires me...",
  },
  preserve_moment: {
    _default: "Before time takes this away, let me say it now...",
  },
};

function generateTemplateSuggestion({ recipient_name, relationship_type, emotional_seed, occasion }) {
  const name = recipient_name || "them";
  const seedKey = emotional_seed || "";
  const occasionLabel = occasion
    ? occasion.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Special";

  const title = occasion
    ? `${occasionLabel} Song for ${name}`
    : `A Song for ${name}`;

  const seedLabel = seedKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const emotionalAngle = occasion
    ? `A ${occasionLabel.toLowerCase()} song for ${name} about ${seedLabel.toLowerCase()}`
    : `A song for ${name} about ${seedLabel.toLowerCase()}`;

  // Look up preview line from map, falling back to generic
  const seedEntry = SEED_PREVIEW_MAP[seedKey];
  const previewTemplate = seedEntry
    ? seedEntry[relationship_type] || seedEntry._default
    : `This one's for you, ${name} — every word, every note...`;

  const previewLine = previewTemplate.replace(/\{name\}/g, name);

  return {
    title,
    emotional_angle: emotionalAngle,
    preview_line: previewLine,
    source: "template",
  };
}

function registerOnboardingRoutes(app, { sendError }) {
  app.get("/api/onboarding/graph.json", async (request, reply) => {
    try {
      const graphPath = path.join(process.cwd(), "PorizoApp", "PorizoApp", "Resources", "onboarding-graph.json");
      const data = await fs.readFile(graphPath, "utf8");
      reply.type("application/json");
      return reply.send(JSON.parse(data));
    } catch (err) {
      request.log.error({ err }, "[Onboarding] Graph load error");
      return sendError(reply, 500, "Failed to load onboarding graph");
    }
  });

  /**
   * POST /api/onboarding/suggest
   *
   * Generate a personalized song suggestion from onboarding answers.
   * Returns a deterministic template immediately. LLM enhancement is a future upgrade.
   */
  app.post("/api/onboarding/suggest", {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const { recipient_name, relationship_type, emotional_seed, occasion } = request.body || {};

      if (!recipient_name || !relationship_type || !emotional_seed) {
        return sendError(reply, 400, "Missing required fields: recipient_name, relationship_type, emotional_seed");
      }

      // Input length validation — prevent abuse on public endpoint
      const MAX_FIELD_LEN = 200;
      if (typeof recipient_name !== 'string' || recipient_name.length > MAX_FIELD_LEN
          || typeof relationship_type !== 'string' || relationship_type.length > MAX_FIELD_LEN
          || typeof emotional_seed !== 'string' || emotional_seed.length > MAX_FIELD_LEN
          || (occasion && (typeof occasion !== 'string' || occasion.length > MAX_FIELD_LEN))) {
        return sendError(reply, 400, "Invalid input: fields must be strings under 200 characters");
      }

      const suggestion = generateTemplateSuggestion({
        recipient_name,
        relationship_type,
        emotional_seed,
        occasion: occasion || null,
      });

      return reply.send(suggestion);
    } catch (err) {
      if (reply.sent) return;
      request.log.error({ err }, "[Onboarding] Suggest error");
      return sendError(reply, 500, "Failed to generate suggestion");
    }
  });
}

module.exports = { registerOnboardingRoutes };
