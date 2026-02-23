/**
 * OG Image Variant Dispatcher
 *
 * Maps variant names to generator functions for both songs and poems.
 * Provides preview generation (400x210 thumbnails) and generator lookup.
 */

const SONG_VARIANTS = {
  spotlight:     () => require("./song-og-variants").generateSongOgSpotlight,
  envelope:      () => require("./song-og-variants").generateSongOgEnvelope,
  greeting_card: () => require("./song-og-variants").generateSongOgGreetingCard,
};

const POEM_VARIANTS = {
  open_book:     () => require("./poem-og-variants").generatePoemOgOpenBook,
  verse_window:  () => require("./poem-og-variants").generatePoemOgVerseWindow,
  whisper:       () => require("./poem-og-variants").generatePoemOgWhisper,
};

const SONG_VARIANT_LABELS = {
  spotlight: "Spotlight",
  envelope: "Gilt Envelope",
  greeting_card: "Greeting Card",
};

const POEM_VARIANT_LABELS = {
  open_book: "Open Book",
  verse_window: "Verse Window",
  whisper: "Whisper",
};

const SONG_VARIANT_NAMES = Object.keys(SONG_VARIANTS);
const POEM_VARIANT_NAMES = Object.keys(POEM_VARIANTS);

const { requireSharp: _requireSharp } = require("../utils/sharp-loader");
function requireSharp() { return _requireSharp("OgVariantDispatcher"); }

/**
 * Get the generator function for a song variant.
 * @param {string|null} variant - Variant name (e.g. "spotlight")
 * @returns {Function|null} Generator function or null if variant unknown/null
 */
function getSongOgGenerator(variant) {
  if (!variant || !SONG_VARIANTS[variant]) return null;
  return SONG_VARIANTS[variant]();
}

/**
 * Get the generator function for a poem variant.
 * @param {string|null} variant - Variant name (e.g. "open_book")
 * @returns {Function|null} Generator function or null if variant unknown/null
 */
function getPoemOgGenerator(variant) {
  if (!variant || !POEM_VARIANTS[variant]) return null;
  return POEM_VARIANTS[variant]();
}

/**
 * Generate a low-res song OG preview thumbnail (400x210 JPEG).
 * @returns {Promise<Buffer|null>} JPEG buffer or null if sharp unavailable
 */
async function generateSongOgPreview(variant, params) {
  const sharp = requireSharp();
  if (!sharp) return null;
  const gen = getSongOgGenerator(variant);
  if (!gen) return null;
  const fullBuf = await gen(params);
  if (!fullBuf) return null;
  return sharp(fullBuf).resize(400, 210).jpeg({ quality: 70 }).toBuffer();
}

/**
 * Generate a low-res poem OG preview thumbnail (400x210 PNG).
 * @returns {Promise<Buffer|null>} PNG buffer or null if sharp unavailable
 */
async function generatePoemOgPreview(variant, params) {
  const sharp = requireSharp();
  if (!sharp) return null;
  const gen = getPoemOgGenerator(variant);
  if (!gen) return null;
  const fullBuf = await gen(params);
  if (!fullBuf) return null;
  return sharp(fullBuf).resize(400, 210).png({ quality: 80 }).toBuffer();
}

module.exports = {
  getSongOgGenerator,
  getPoemOgGenerator,
  generateSongOgPreview,
  generatePoemOgPreview,
  SONG_VARIANT_NAMES,
  POEM_VARIANT_NAMES,
  SONG_VARIANT_LABELS,
  POEM_VARIANT_LABELS,
};
