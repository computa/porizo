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
const PROMPT_TEMPLATE_VERSION = "v2.2.0-photoreal-flora-rich";

const CAMERA =
  "Photographed on Fuji X-T5 with 90mm macro at f/2.8, ISO 200, 1/250s.";
// Wider lens framing in v2.2 to accommodate the denser arrangements without
// cropping the bouquet edges. Lower negative space now anchors the bundle's
// weight rather than dominating the frame.
const COMPOSITION =
  "Composition: lush arrangement fills the upper 75% of frame; remaining 25% is soft out-of-focus negative space at the bottom anchoring the bundle.";

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

  // v2.2 phrasing — density leads, species is the subject of the cluster.
  // Previous "{species} in {density} composition" let Flux anchor on a singular
  // species noun and treat the density as background flavor; the new shape
  // commits to the bundle up front and pluralizes naturally.
  return [
    `A photorealistic close-up of ${densityPhrase} — the subject is ${speciesPhrase} blooms and stems, ${lightingPhrase}, in a ${palettePhrase}.`,
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
