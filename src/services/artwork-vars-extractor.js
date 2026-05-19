// src/services/artwork-vars-extractor.js
/**
 * Lyrics → bounded-vocab artwork vars (Haiku 4.5 picker).
 *
 * Reads finalized lyrics + occasion, asks Haiku to pick slot values from the
 * curated menus in `artwork-vocab`. Validates every picked value; any pick
 * not in the menu is replaced with the occasion default. Total failures
 * (Haiku timeout, network, parse error) collapse to the occasion default.
 *
 * See docs/superpowers/specs/2026-05-18-artwork-generator-redesign-design.md §6, §10.
 */

const { generateText } = require("./llm-provider");
const {
  LIGHTING,
  PALETTE,
  DENSITY,
  IMPERFECTION,
  BACKDROP,
  SPECIES_BY_OCCASION,
  isValidSlot,
  getDefault,
  OCCASIONS,
} = require("./artwork-vocab");

const HAIKU_TIMEOUT_MS_DEFAULT = 8000;

function buildSystemPrompt() {
  return `You are an artwork art director. You will be given song lyrics and an occasion. Pick six artwork variables that emotionally match the lyrics. You MUST pick from the provided menus only. Output ONLY a single JSON object with keys: species, lighting, palette, density, imperfection, backdrop. No commentary, no markdown fences.`;
}

function buildUserPrompt({ lyrics, occasion }) {
  const speciesMenu = SPECIES_BY_OCCASION[occasion]
    .map((s) => `"${s}"`)
    .join(", ");
  const lightingMenu = Object.keys(LIGHTING)
    .map((k) => `"${k}"`)
    .join(", ");
  const paletteMenu = Object.keys(PALETTE)
    .map((k) => `"${k}"`)
    .join(", ");
  const densityMenu = Object.keys(DENSITY)
    .map((k) => `"${k}"`)
    .join(", ");
  const imperfectionMenu = IMPERFECTION.map((p) => `"${p}"`).join(", ");
  const backdropMenu = Object.keys(BACKDROP)
    .map((k) => `"${k}"`)
    .join(", ");

  return `Occasion: ${occasion}

Lyrics:
${lyrics}

Pick artwork variables that emotionally match these lyrics. Output a single JSON object.

Menus (you MUST pick from these exact values):
- species (the flower or tree for this artwork): ${speciesMenu}
- lighting: ${lightingMenu}
- palette: ${paletteMenu}
- density: ${densityMenu}
- imperfection: ${imperfectionMenu}
- backdrop: ${backdropMenu}

Output JSON only.`;
}

function parseHaikuResponse(rawText, occasion) {
  const defaults = getDefault(occasion);
  let parsed;
  try {
    // Tolerate models that wrap JSON in ```json fences despite the instruction
    const cleaned = String(rawText || "")
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      ...defaults,
      picked_by: "fallback_parse_error",
      picked_at: new Date().toISOString(),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      ...defaults,
      picked_by: "fallback_parse_error",
      picked_at: new Date().toISOString(),
    };
  }

  const out = { ...defaults };
  for (const slot of [
    "lighting",
    "palette",
    "density",
    "backdrop",
    "imperfection",
  ]) {
    if (parsed[slot] && isValidSlot(slot, parsed[slot])) {
      out[slot] = parsed[slot];
    }
    // else: keep default
  }
  if (parsed.species && isValidSlot("species", parsed.species, occasion)) {
    out.species = parsed.species;
  }
  out.picked_by = "haiku";
  out.picked_at = new Date().toISOString();
  return out;
}

async function extractArtworkVars({
  lyrics,
  occasion,
  haikuClient,
  timeoutMs = HAIKU_TIMEOUT_MS_DEFAULT,
  logger = console,
}) {
  if (!OCCASIONS.includes(occasion)) {
    throw new Error(`extractArtworkVars: unknown occasion ${occasion}`);
  }
  if (!lyrics || typeof lyrics !== "string") {
    logger.warn(`[artwork-vars] empty lyrics for ${occasion}; using defaults`);
    return {
      ...getDefault(occasion),
      picked_by: "fallback_empty_lyrics",
      picked_at: new Date().toISOString(),
    };
  }

  // Default Haiku client uses llm-provider; tests can stub it.
  const client =
    haikuClient ||
    (async ({ prompt, systemPrompt }) =>
      generateText({
        prompt,
        systemPrompt,
        providers: ["anthropic"],
        // taskType "vars_extractor" routes to the dedicated Haiku 4.5 lane in
        // llm-provider (claude-haiku-4-5-20251001). "simple" still points at
        // Haiku 3 for other callers (memory-questions, blog-editorial-review,
        // v3 writer fallback). Spec §6.4 mandates Haiku 4.5 here for the
        // emotion → bounded-vocab slot picking; "lyrics" routes to Sonnet 4
        // which is wrong (too slow, too expensive for a slot classifier).
        // See spec §10 line 305 — extractor MUST stay in a Haiku lane for the
        // latency budget (preview p95 < 90s assumes parallel-with-MUSIC_PLAN).
        taskType: "vars_extractor",
        temperature: 0.4,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
        logLabel: "artwork-vars-extractor",
      }));

  const userPrompt = buildUserPrompt({ lyrics, occasion });
  const systemPrompt = buildSystemPrompt();

  const callPromise = client({ prompt: userPrompt, systemPrompt });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("haiku_timeout")), timeoutMs),
  );

  let raw;
  try {
    const result = await Promise.race([callPromise, timeoutPromise]);
    raw = result && (result.text || result.output || "");
  } catch (err) {
    logger.warn(
      `[artwork-vars] Haiku failed for ${occasion}: ${err.message}; using defaults`,
    );
    return {
      ...getDefault(occasion),
      picked_by: "fallback_occasion_default",
      picked_at: new Date().toISOString(),
    };
  }

  return parseHaikuResponse(raw, occasion);
}

module.exports = {
  extractArtworkVars,
  parseHaikuResponse,
  buildSystemPrompt,
  buildUserPrompt,
  HAIKU_TIMEOUT_MS_DEFAULT,
};
