/**
 * Curated slot vocabulary for lyrics-aware artwork generation.
 * Haiku picks one value per slot from these menus; any picked value not in a
 * menu is rejected and replaced with the occasion default.
 *
 * See docs/superpowers/specs/2026-05-18-artwork-generator-redesign-design.md §6.
 */

const LIGHTING = {
  morning_window: "soft north-facing window light at 9am, gentle diffuse fall",
  golden_hour: "warm low-angle golden-hour sun, 6pm late summer, long shadows",
  overcast_soft: "overcast diffuse light, no direct sun, even tonal range",
  late_afternoon_warm: "warm late afternoon light, 4pm autumn, amber cast",
  blue_hour_cool: "cool blue-hour light, 7am pre-dawn, restrained and quiet",
  midday_clean:
    "clean midday sun through a sheer linen curtain, sharp but soft",
};

const PALETTE = {
  warm_cream: "warm cream palette: #F5E6D3 cream, #E8C9A8 peach, #C99970 clay",
  dusty_rose: "dusty rose palette: #F2D7D5 blush, #D49A99 rose, #8B5F5F mauve",
  sage_ivory:
    "sage and ivory palette: #F4EDDE ivory, #B8C5A6 sage, #7A8A6E olive",
  bruised_gold:
    "bruised gold palette: #F0D89E straw, #C99A4F gold, #7D5A2A amber",
  cool_grey_blue:
    "cool grey-blue palette: #E8E8EA paper, #A6B0BA cool grey, #5C6A7A slate",
  sun_bleached:
    "sun-bleached palette: #FAF3E6 bone, #E5D3BD parchment, #C9B594 linen",
};

const DENSITY = {
  single_bloom: "a single isolated stem, intimate scale",
  intimate_cluster: "a small loose cluster of 3-5 stems, hand-gathered",
  full_bouquet: "a generous bouquet, multiple stems flowing outward",
};

const IMPERFECTION = [
  "one outer petal slightly bruised at the tip",
  "a single dewdrop visible at 2 o'clock on the largest petal",
  "left edge of the composition slightly out of focus",
  "one stem subtly shorter than the others, breaking the symmetry",
];

const BACKDROP = {
  cream_cloud:
    "soft cream cloud backdrop with subtle warm falloff at the edges",
  garden_bokeh:
    "natural garden background blurred to a soft green-and-cream bokeh",
  bare_wood_grain:
    "weathered pale-oak wood plane in shallow focus, no objects on it",
};

const SPECIES_BY_OCCASION = {
  birthday: [
    "peony",
    "ranunculus",
    "garden rose",
    "dahlia",
    "English rose",
    "lisianthus",
  ],
  mothers_day: [
    "ranunculus",
    "peony",
    "garden rose",
    "camellia",
    "magnolia",
    "sunflower",
  ],
  anniversary: [
    "garden rose pair",
    "peony",
    "magnolia",
    "dogwood branch",
    "cherry blossom",
    "gardenia",
  ],
  thank_you: [
    "eucalyptus stems",
    "sage",
    "lavender",
    "chamomile",
    "forget-me-nots",
    "sweet peas",
  ],
  i_love_you: [
    "red garden rose",
    "peony",
    "dahlia",
    "ranunculus",
    "anemone",
    "single rose stem",
  ],
  wedding: [
    "garden rose",
    "ranunculus",
    "peony",
    "lily of the valley",
    "gardenia",
    "anemone",
  ],
  graduation: [
    "sunflower",
    "daisy",
    "dahlia",
    "magnolia",
    "olive branch",
    "laurel sprig",
  ],
  celebration: [
    "dahlia",
    "daisy",
    "wildflower mix",
    "sunflower",
    "gerbera",
    "peony",
  ],
  apology: [
    "white tulip",
    "white anemone",
    "lily of the valley",
    "gardenia",
    "white peony",
    "baby's breath",
  ],
  encouragement: [
    "sunflower",
    "yellow tulip",
    "daffodil",
    "daisy",
    "iris",
    "magnolia",
  ],
  advice: [
    "ancient oak branch",
    "olive branch",
    "sage plant",
    "rosemary stem",
    "laurel",
    "ginkgo branch",
  ],
  bereavement: [
    "white calla lily",
    "white anemone",
    "white peony",
    "lily of the valley",
    "baby's breath",
    "gardenia",
  ],
  friendship: [
    "two cherry blossom branches",
    "two dogwood branches",
    "sweet pea pair",
    "two sunflowers",
    "mixed wildflower bunch",
    "lavender + sage pair",
  ],
  get_well: [
    "chamomile",
    "lavender stems",
    "yellow tulip",
    "daisy",
    "lily of the valley",
    "eucalyptus",
  ],
  custom: [
    "peony",
    "ranunculus",
    "garden rose",
    "sunflower",
    "magnolia",
    "sweet peas",
  ],
};

const OCCASIONS = Object.keys(SPECIES_BY_OCCASION);

const DEFAULTS_BY_OCCASION = {
  birthday: {
    species: "ranunculus",
    lighting: "morning_window",
    palette: "warm_cream",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  mothers_day: {
    species: "ranunculus",
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  anniversary: {
    species: "garden rose pair",
    lighting: "golden_hour",
    palette: "warm_cream",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  thank_you: {
    species: "eucalyptus stems",
    lighting: "morning_window",
    palette: "sage_ivory",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  i_love_you: {
    species: "red garden rose",
    lighting: "golden_hour",
    palette: "dusty_rose",
    density: "single_bloom",
    backdrop: "cream_cloud",
  },
  wedding: {
    species: "garden rose",
    lighting: "morning_window",
    palette: "sage_ivory",
    density: "full_bouquet",
    backdrop: "cream_cloud",
  },
  graduation: {
    species: "olive branch",
    lighting: "golden_hour",
    palette: "bruised_gold",
    density: "single_bloom",
    backdrop: "cream_cloud",
  },
  celebration: {
    species: "dahlia",
    lighting: "golden_hour",
    palette: "bruised_gold",
    density: "full_bouquet",
    backdrop: "cream_cloud",
  },
  apology: {
    species: "white tulip",
    lighting: "overcast_soft",
    palette: "cool_grey_blue",
    density: "single_bloom",
    backdrop: "cream_cloud",
  },
  encouragement: {
    species: "sunflower",
    lighting: "morning_window",
    palette: "bruised_gold",
    density: "single_bloom",
    backdrop: "cream_cloud",
  },
  advice: {
    species: "olive branch",
    lighting: "late_afternoon_warm",
    palette: "sage_ivory",
    density: "single_bloom",
    backdrop: "bare_wood_grain",
  },
  bereavement: {
    species: "white calla lily",
    lighting: "overcast_soft",
    palette: "cool_grey_blue",
    density: "single_bloom",
    backdrop: "cream_cloud",
  },
  friendship: {
    species: "two cherry blossom branches",
    lighting: "morning_window",
    palette: "warm_cream",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  get_well: {
    species: "chamomile",
    lighting: "morning_window",
    palette: "sage_ivory",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
  custom: {
    species: "peony",
    lighting: "morning_window",
    palette: "warm_cream",
    density: "intimate_cluster",
    backdrop: "cream_cloud",
  },
};

function isValidSlot(slot, value, occasion) {
  if (slot === "lighting")
    return Object.prototype.hasOwnProperty.call(LIGHTING, value);
  if (slot === "palette")
    return Object.prototype.hasOwnProperty.call(PALETTE, value);
  if (slot === "density")
    return Object.prototype.hasOwnProperty.call(DENSITY, value);
  if (slot === "backdrop")
    return Object.prototype.hasOwnProperty.call(BACKDROP, value);
  if (slot === "imperfection") return IMPERFECTION.includes(value);
  if (slot === "species") {
    if (!occasion || !SPECIES_BY_OCCASION[occasion]) return false;
    return SPECIES_BY_OCCASION[occasion].includes(value);
  }
  return false;
}

function getDefault(occasion) {
  const d = DEFAULTS_BY_OCCASION[occasion];
  if (!d) throw new Error(`No defaults defined for occasion: ${occasion}`);
  // imperfection isn't in DEFAULTS_BY_OCCASION because it's mood-agnostic;
  // the assembler picks IMPERFECTION[0] when no override is supplied.
  return { ...d, imperfection: IMPERFECTION[0] };
}

module.exports = {
  LIGHTING,
  PALETTE,
  DENSITY,
  IMPERFECTION,
  BACKDROP,
  SPECIES_BY_OCCASION,
  DEFAULTS_BY_OCCASION,
  OCCASIONS,
  isValidSlot,
  getDefault,
};
