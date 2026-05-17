const VALID_OCCASIONS = new Set([
  "birthday",
  "mothers_day",
  "anniversary",
  "thank_you",
  "i_love_you",
  "wedding",
  "graduation",
  "celebration",
  "apology",
  "encouragement",
  "advice",
  "bereavement",
  "friendship",
  "get_well",
  "custom",
]);

const VALID_STYLES = new Set(["paper-art", "watercolor", "photographic"]);

const FRAME_CONTRACT = [
  "real physical still-life photographed in camera, not a digital illustration",
  "cream ivory background with subtle warm radial glow",
  "single centered occasion-specific subject occupying the upper 60% of frame",
  "bottom 25% reserved as soft low-detail negative space for text overlay",
  "warm directional studio light from upper-left casting soft natural shadows",
  "natural material imperfections, asymmetry, dust, fiber, glaze, or petal texture visible",
  "9:16 portrait aspect ratio",
  "no text, no letters, no numbers, no handwriting, no glyphs, no signage",
  "no signatures, no watermarks, no captions, no labels, no UI elements, no QR codes, no barcodes",
  "no people, no faces, no hands",
  "no logos, no brand marks, no trademarks",
  "no app names, no personal names, no dedication text",
  "no synthetic smoothness, no warped geometry, no impossible shadows, no duplicated petals, no plastic rendered look",
  "no scenes, no landscapes, no environments; single subject only",
].join(", ");

const STYLES = {
  "paper-art":
    "macro product photograph of a real handmade paper sculpture, hand-cut layered cotton cardstock with visible fibers, tiny knife-cut irregularities, slight glue shadows, and dimensional paper depths like a luxury greeting card photographed in a studio",
  watercolor:
    "photograph of a real hand-painted watercolor card on textured cold-press paper, organic pigment bleed, granulation, paper buckling at the wet edges, and restrained brushwork visible as physical paint on paper",
  photographic:
    "editorial still-life photograph with real objects, shallow depth of field, natural lens falloff, soft window light, tactile material texture, and minimal composition styled by a premium gift-product art director",
};

const OCCASION_SUBJECTS = {
  birthday:
    "a single oversized blooming peony arranged like a birthday keepsake, layered petals opening from the center in warm coral and peach tones graduating to pale cream at the tips, a few tiny preserved blossoms and fern fronds around the base",
  mothers_day:
    "a compact mother's day bouquet of pale pink ranunculus, dusty miller, tiny chamomile, and lavender sprigs, bound by hand with cream linen ribbon, soft blush pink, sage green, and ivory palette",
  anniversary:
    "two slender flowering branches gently intertwined at the stems, covered in tiny white five-petaled blossoms, deep rose and burgundy tones in the leaves, suggesting two lives twined together",
  thank_you:
    "a small thank-you gift parcel wrapped in unbleached natural paper, tied with cotton twine, a single fresh eucalyptus sprig tucked under the bow, warm cream, kraft brown, and muted sage palette",
  i_love_you:
    "an organic heart shape carefully assembled from real fallen rose petals in graduating crimson and dusty rose tones, individual curled petal edges visible, intimate and restrained",
  wedding:
    "a small bridal bouquet of white garden roses and seeded eucalyptus, ivory ranunculus, wrapped in silk ribbon, palette of pure white, cream, and soft sage, classic and timeless",
  graduation:
    "a circular graduation laurel wreath of olive leaves with a narrow cream ribbon and subtle antique-gold highlights on the leaf tips, suggesting achievement and honor without using a cap or diploma",
  celebration:
    "a refined cluster of softly curling paper streamers and small matte confetti pieces in warm metallic gold, blush, and cream, arranged mid-fall, joyful but quiet",
  apology:
    "a single fresh white tulip with a slight bend in the stem, leaves visible, set against a soft cool grey backdrop with the warm ivory base showing through, palette of pure white, cool grey, and pale jade",
  encouragement:
    "a single rising stem with three buds at different stages of opening — bud, half-bloom, full bloom — suggesting growth and progress, warm golden-coral tones on cream",
  advice:
    "an open leather-bound journal lying flat with a vintage fountain pen resting across it, a single small pressed flower between the pages, palette of warm cognac, cream, and aged paper",
  bereavement:
    "a single white calla lily with elegant curving form, deep green stem visible, against a soft dove-grey background that shades into warm ivory, dignified and quiet, palette restricted to pure white, charcoal stem-green, and warm grey",
  friendship:
    "two small ceramic songbirds in matching warm terracotta nestled side by side on a slender wooden branch with a few green leaves, intimate scale and tone, palette of warm clay, sage, and cream",
  get_well:
    "a single handcrafted ceramic teacup with visible glaze texture, steam rising in soft delicate curls, a sprig of fresh chamomile and a slice of lemon resting on the saucer, palette of warm honey, cream, and pale yellow",
  custom:
    "a neutral personalized-gift still-life with one small cream bloom, a folded linen ribbon, and a smooth river stone arranged in warm peach, ivory, sage, and soft gold tones",
};

function buildPrompt({ occasion, style }) {
  if (!VALID_OCCASIONS.has(occasion)) {
    throw new Error(`Invalid occasion: ${occasion}`);
  }
  if (!VALID_STYLES.has(style)) {
    throw new Error(`Invalid style: ${style}`);
  }
  return `${OCCASION_SUBJECTS[occasion]}. ${STYLES[style]}. ${FRAME_CONTRACT}.`;
}

function listAllPrompts() {
  const result = [];
  for (const occasion of VALID_OCCASIONS) {
    for (const style of VALID_STYLES) {
      result.push({
        occasion,
        style,
        prompt: buildPrompt({ occasion, style }),
      });
    }
  }
  return result;
}

module.exports = {
  VALID_OCCASIONS,
  VALID_STYLES,
  buildPrompt,
  listAllPrompts,
};
