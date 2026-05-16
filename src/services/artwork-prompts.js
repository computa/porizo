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
  "cream ivory background with subtle warm radial glow",
  "single centered emotional subject occupying the upper 60% of frame",
  "bottom 25% reserved as soft low-detail negative space for text overlay",
  "warm directional studio light from upper-left casting soft natural shadows",
  "9:16 portrait aspect ratio",
  "no text, no letters, no numbers, no signage",
  "no people, no faces, no hands",
  "no logos, no brand marks, no trademarks",
  "no scenes, no landscapes, no environments — single subject only",
].join(", ");

const STYLES = {
  "paper-art":
    "intricate paper-craft sculpture, hand-cut layered cardstock with visible grain and small asymmetries, multiple paper depths casting real soft shadows, dimensional construction like a luxury greeting card, premium handmade craft feel",
  watercolor:
    "loose hand-painted watercolor on textured cold-press paper, organic pigment bleed at edges, subtle granulation in mid-tones, restrained brushwork suggesting a hand-painted card rather than an illustration",
  photographic:
    "editorial still-life photograph, shallow depth of field with subject sharply in focus, soft window light, minimal composition styled by a gift-product art director, real physical objects with material texture",
};

const OCCASION_SUBJECTS = {
  birthday:
    "a single oversized blooming peony with layered petals opening from the center, in warm coral and peach tones graduating to pale cream at the petal tips, a few small scattered blossoms and delicate fern fronds around the base",
  mothers_day:
    "a gathered nosegay of mixed garden flowers — pale pink ranunculus, dusty miller, small sprigs of lavender — bound with cream linen ribbon, palette of soft blush pink, sage green, and ivory",
  anniversary:
    "two slender flowering branches gently intertwined at the stems, covered in tiny white five-petaled blossoms, deep rose and burgundy tones in the leaves, suggesting two lives twined together",
  thank_you:
    "a small handmade gift parcel wrapped in unbleached natural paper, tied with twine, a single fresh eucalyptus sprig tucked under the bow, palette of warm cream, kraft brown, and muted sage",
  i_love_you:
    "an organic heart shape composed entirely of fallen rose petals in graduating crimson and dusty rose tones, individual petals visible at the edges, deeply emotional and intimate",
  wedding:
    "a small bridal bouquet of white garden roses and seeded eucalyptus, ivory ranunculus, wrapped in silk ribbon, palette of pure white, cream, and soft sage, classic and timeless",
  graduation:
    "a circular laurel wreath of olive leaves with subtle golden highlights on the tips, suggesting achievement and honor without being literal, palette of warm olive green and antique gold on cream",
  celebration:
    "a cluster of softly curling paper streamers and small confetti pieces in warm metallic gold, blush, and cream, frozen mid-fall, joyful but refined — not loud",
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
    "an abstract organic arrangement of layered paper leaves and a single small unspecified bloom at the center, in universally warm tones of peach, cream, and soft gold",
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
