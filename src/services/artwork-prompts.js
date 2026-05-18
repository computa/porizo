// src/services/artwork-prompts.js
/**
 * Prompt template assembler for the lyrics-aware photoreal artwork pipeline.
 *
 * Inputs: an `occasion` and a `vars` object with slot keys
 * (species, lighting, palette, density, imperfection, backdrop). Outputs the
 * final Flux prompt string + the negative prompt.
 *
 * Slot menus and per-occasion defaults live in `artwork-vocab.js`.
 * See docs/superpowers/specs/2026-05-18-artwork-generator-redesign-design.md §5.
 */

const {
  LIGHTING,
  PALETTE,
  DENSITY,
  BACKDROP,
  OCCASIONS,
  isValidSlot,
} = require("./artwork-vocab");

// Bump this whenever the template structure changes. params_hash incorporates
// this so re-renders under a new template don't hit stale caches.
const PROMPT_TEMPLATE_VERSION = "v2.1.0-photoreal-flora";

const CAMERA =
  "Photographed on Fuji X-T5 with 90mm macro at f/2.8, ISO 200, 1/250s.";
const COMPOSITION =
  "Composition: subject occupies upper 65% of frame, lower 30% reserved as soft out-of-focus negative space.";

const NEGATIVE = [
  "no text",
  "no letters",
  "no numbers",
  "no handwriting",
  "no people",
  "no faces",
  "no hands",
  "no human-made objects",
  "no vases",
  "no ribbons",
  "no surfaces",
  "no tools",
  "no signage",
  "no watermarks",
  "no oversaturated colors",
  "no plastic finish",
  "no symmetrical perfection",
  "no AI-render gloss",
  "no duplicated petals",
  "no impossible shadows",
].join(", ");

function assemblePrompt({ occasion, vars }) {
  if (!OCCASIONS.includes(occasion)) {
    throw new Error(`unknown occasion: ${occasion}`);
  }
  for (const slot of [
    "lighting",
    "palette",
    "density",
    "backdrop",
    "imperfection",
  ]) {
    if (!isValidSlot(slot, vars[slot])) {
      throw new Error(`invalid ${slot} value: ${vars[slot]}`);
    }
  }
  if (!isValidSlot("species", vars.species, occasion)) {
    throw new Error(`invalid species value for ${occasion}: ${vars.species}`);
  }

  const speciesPhrase = vars.species; // species are literal names, no expansion needed
  const densityPhrase = DENSITY[vars.density];
  const lightingPhrase = LIGHTING[vars.lighting];
  const palettePhrase = PALETTE[vars.palette];
  const backdropPhrase = BACKDROP[vars.backdrop];
  const imperfectionPhrase = vars.imperfection;

  return [
    `${speciesPhrase} in ${densityPhrase} composition, ${lightingPhrase}, ${palettePhrase}.`,
    CAMERA,
    `Natural asymmetry: ${imperfectionPhrase}.`,
    `${backdropPhrase}.`,
    COMPOSITION,
  ].join(" ");
}

function assembleNegativePrompt() {
  return NEGATIVE;
}

module.exports = {
  PROMPT_TEMPLATE_VERSION,
  assemblePrompt,
  assembleNegativePrompt,
};
