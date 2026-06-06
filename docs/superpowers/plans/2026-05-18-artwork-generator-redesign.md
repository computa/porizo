# Artwork Generator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `gpt-image-2` paper-art/watercolor/photographic artwork generator with a photoreal botanical-only generator powered by Flux 1.1 Pro Ultra + bounded-vocab lyrics-aware prompting via Haiku, producing a single square 2048² canonical asset whose text is overlaid at runtime by every consuming surface.

**Architecture:** Lyrics finalize → Haiku reads lyrics and picks slot values from a curated vocabulary (`species`, `lighting`, `palette`, `density`, `imperfection`, `backdrop`) → `assemblePrompt(vars)` produces a Flux-tuned prompt → Replicate calls `flux-1.1-pro-ultra` → 2048² JPEG written to canonical path. OpenAI `gpt-image-2` stays as a typed fallback. iOS surfaces use a `BlurBackdropArtwork` SwiftUI view that places the square art in front of a blurred-and-dimmed copy of itself; web player letterboxes the same asset; share/export still composites title text but at export time, not generation time. Free tier consumes a hand-curated library of 5 Flux-generated variants per occasion (75 images, one-time bootstrap).

**Tech Stack:** Node.js + Fastify backend; Replicate API (Flux); Anthropic API (Haiku 4.5); OpenAI Images API (fallback); PostgreSQL 15 (prod), SQLite via sql.js (tests); SwiftUI; sharp for image normalization; ffmpeg unused on this path.

**Source spec:** `docs/superpowers/specs/2026-05-18-artwork-generator-redesign-design.md` (committed as `ec54112`).

---

## Pre-flight notes

- Latest migration number on disk: 112. **This plan uses 113.**
- Anthropic SDK is already wired via `src/services/llm-provider.js` (`generateWithAnthropic`, `createAnthropicClient`). No new dependency.
- Replicate HTTP helpers (`fetchJson`, `waitForPrediction`, `normalizeOutputUrl`) live in `src/providers/replicate.js`. The Flux adapter reuses them.
- Tests use `node:test` + `node:assert/strict`. Run via `npm test` or `node --test test/**/*.test.js`.
- Database access object exposes `.isPostgres`, `.prepare(sql).get/all/run(...)`, and migration files auto-run on boot via `runMigrations()` in `src/database/index.js`.

---

## Task 1: Database migration 113

Adds `artwork_vars_json`, `artwork_provider`, `artwork_prompt_version` to `track_versions`. (`tracks.artwork_provider` already exists from migration 109; this adds the per-version column the new pipeline writes.)

**Files:**

- Create: `migrations/113_artwork_redesign.sql`
- Create: `migrations/pg/113_artwork_redesign.sql`
- Test: `test/database/migration-113.test.js`

- [ ] **Step 1: Write the failing migration test**

```js
// test/database/migration-113.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("../utils/db-helpers");

test("migration 113 adds artwork_vars_json column to track_versions", async () => {
  const db = await createTestDb();
  const cols = db.prepare("PRAGMA table_info(track_versions)").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes("artwork_vars_json"), "artwork_vars_json missing");
  assert.ok(names.includes("artwork_provider"), "artwork_provider missing");
  assert.ok(
    names.includes("artwork_prompt_version"),
    "artwork_prompt_version missing",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/database/migration-113.test.js`
Expected: FAIL with "artwork_vars_json missing"

- [ ] **Step 3: Create the SQLite migration**

```sql
-- migrations/113_artwork_redesign.sql
-- Migration 113: Lyrics-aware bounded-vocab artwork (SQLite mirror for test suite)

ALTER TABLE track_versions ADD COLUMN artwork_vars_json TEXT;
ALTER TABLE track_versions ADD COLUMN artwork_provider TEXT;
ALTER TABLE track_versions ADD COLUMN artwork_prompt_version TEXT;
```

- [ ] **Step 4: Create the PostgreSQL migration**

```sql
-- migrations/pg/113_artwork_redesign.sql
-- Migration 113: Lyrics-aware bounded-vocab artwork (PostgreSQL)
-- Adds per-version artwork vars, provider attribution, and prompt template version.

ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_vars_json JSONB;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_provider TEXT;
ALTER TABLE track_versions ADD COLUMN IF NOT EXISTS artwork_prompt_version TEXT;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/database/migration-113.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add migrations/113_artwork_redesign.sql migrations/pg/113_artwork_redesign.sql test/database/migration-113.test.js
git commit -m "feat(db): migration 113 — add artwork vars/provider/prompt_version columns

Co-authored by Ambrose Obimma"
```

---

## Task 2: Slot vocabulary module

The single source of truth for what slot values exist, what their prompt phrasing is, and which per-occasion defaults apply when Haiku fails. Pure data + lookup helpers.

**Files:**

- Create: `src/services/artwork-vocab.js`
- Test: `test/services/artwork-vocab.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/services/artwork-vocab.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LIGHTING,
  PALETTE,
  DENSITY,
  IMPERFECTION,
  BACKDROP,
  SPECIES_BY_OCCASION,
  DEFAULTS_BY_OCCASION,
  isValidSlot,
  getDefault,
  OCCASIONS,
} = require("../../src/services/artwork-vocab");

test("LIGHTING has all 6 keys with non-empty phrases", () => {
  const expected = [
    "morning_window",
    "golden_hour",
    "overcast_soft",
    "late_afternoon_warm",
    "blue_hour_cool",
    "midday_clean",
  ];
  for (const key of expected) {
    assert.ok(LIGHTING[key], `missing key: ${key}`);
    assert.ok(LIGHTING[key].length > 10, `phrase too short for ${key}`);
  }
  assert.equal(Object.keys(LIGHTING).length, 6);
});

test("PALETTE has all 6 keys with hex codes in phrase", () => {
  const expected = [
    "warm_cream",
    "dusty_rose",
    "sage_ivory",
    "bruised_gold",
    "cool_grey_blue",
    "sun_bleached",
  ];
  for (const key of expected) {
    assert.ok(PALETTE[key], `missing key: ${key}`);
    assert.match(
      PALETTE[key],
      /#[0-9A-Fa-f]{6}/,
      `palette ${key} missing hex code`,
    );
  }
});

test("DENSITY has 3 keys", () => {
  assert.deepEqual(
    Object.keys(DENSITY).sort(),
    ["full_bouquet", "intimate_cluster", "single_bloom"].sort(),
  );
});

test("IMPERFECTION has 4 phrase options as array", () => {
  assert.ok(Array.isArray(IMPERFECTION));
  assert.equal(IMPERFECTION.length, 4);
  for (const phrase of IMPERFECTION) assert.ok(phrase.length > 10);
});

test("BACKDROP has 3 keys", () => {
  assert.deepEqual(
    Object.keys(BACKDROP).sort(),
    ["bare_wood_grain", "cream_cloud", "garden_bokeh"].sort(),
  );
});

test("SPECIES_BY_OCCASION has all 15 occasions with 4-6 species each", () => {
  const expectedOccasions = [
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
  ];
  for (const occ of expectedOccasions) {
    const arr = SPECIES_BY_OCCASION[occ];
    assert.ok(Array.isArray(arr), `${occ} missing species array`);
    assert.ok(
      arr.length >= 4 && arr.length <= 6,
      `${occ} has ${arr.length} species (want 4-6)`,
    );
  }
});

test("DEFAULTS_BY_OCCASION has complete defaults for each of 15 occasions", () => {
  for (const occ of OCCASIONS) {
    const d = DEFAULTS_BY_OCCASION[occ];
    assert.ok(d, `no defaults for ${occ}`);
    for (const slot of [
      "species",
      "lighting",
      "palette",
      "density",
      "backdrop",
    ]) {
      assert.ok(d[slot], `${occ} missing default ${slot}`);
    }
  }
});

test("isValidSlot accepts known values and rejects unknown", () => {
  assert.equal(isValidSlot("lighting", "golden_hour"), true);
  assert.equal(isValidSlot("lighting", "nonsense"), false);
  assert.equal(isValidSlot("palette", "warm_cream"), true);
  assert.equal(isValidSlot("density", "full_bouquet"), true);
  assert.equal(isValidSlot("backdrop", "cream_cloud"), true);
});

test("isValidSlot species check uses occasion-scoped menu", () => {
  assert.equal(isValidSlot("species", "ranunculus", "mothers_day"), true);
  assert.equal(
    isValidSlot("species", "white calla lily", "mothers_day"),
    false,
  );
  assert.equal(isValidSlot("species", "white calla lily", "bereavement"), true);
});

test("getDefault returns default vars for a known occasion", () => {
  const d = getDefault("mothers_day");
  assert.equal(d.species, "ranunculus");
  assert.equal(d.lighting, "morning_window");
  assert.equal(d.palette, "dusty_rose");
  assert.equal(d.density, "intimate_cluster");
  assert.equal(d.backdrop, "cream_cloud");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/artwork-vocab.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the module**

```js
// src/services/artwork-vocab.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/artwork-vocab.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/artwork-vocab.js test/services/artwork-vocab.test.js
git commit -m "feat(artwork): curated slot vocabulary for lyrics-aware prompting

Single source of truth for the lighting/palette/density/imperfection/backdrop
menus + per-occasion species lists and defaults. Pure data; lookup helpers
isValidSlot() and getDefault().

Co-authored by Ambrose Obimma"
```

---

## Task 3: Prompt template assembler

Replaces `src/services/artwork-prompts.js`. Takes a vars object + occasion and returns the full Flux prompt string + a template version string.

**Files:**

- Modify: `src/services/artwork-prompts.js` (full rewrite)
- Test: `test/services/artwork-prompts.test.js` (new — current code has no direct test)

- [ ] **Step 1: Write the failing test**

```js
// test/services/artwork-prompts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROMPT_TEMPLATE_VERSION,
  assemblePrompt,
  assembleNegativePrompt,
} = require("../../src/services/artwork-prompts");

test("PROMPT_TEMPLATE_VERSION is a non-empty string", () => {
  assert.ok(typeof PROMPT_TEMPLATE_VERSION === "string");
  assert.ok(PROMPT_TEMPLATE_VERSION.length > 0);
});

test("assemblePrompt produces a deterministic string from valid vars", () => {
  const vars = {
    species: "ranunculus",
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  };
  const out = assemblePrompt({ occasion: "mothers_day", vars });
  assert.ok(out.includes("ranunculus"), "missing species");
  assert.ok(out.includes("small loose cluster"), "missing density phrase");
  assert.ok(out.includes("north-facing window"), "missing lighting phrase");
  assert.ok(out.includes("#F2D7D5"), "missing palette hex");
  assert.ok(out.includes("Fuji X-T5"), "missing camera language");
  assert.ok(out.includes("bruised at the tip"), "missing imperfection");
  assert.ok(out.includes("cream cloud backdrop"), "missing backdrop");
});

test("assemblePrompt is deterministic — same input yields same output", () => {
  const vars = {
    species: "peony",
    lighting: "golden_hour",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: "left edge of the composition slightly out of focus",
    backdrop: "garden_bokeh",
  };
  const a = assemblePrompt({ occasion: "birthday", vars });
  const b = assemblePrompt({ occasion: "birthday", vars });
  assert.equal(a, b);
});

test("assembleNegativePrompt returns the full negative list", () => {
  const neg = assembleNegativePrompt();
  for (const banned of [
    "no text",
    "no people",
    "no faces",
    "no hands",
    "no vases",
    "no AI-render gloss",
    "no plastic finish",
    "no symmetrical perfection",
  ]) {
    assert.ok(neg.includes(banned), `negative prompt missing "${banned}"`);
  }
});

test("assemblePrompt throws on unknown occasion", () => {
  const vars = {
    species: "peony",
    lighting: "morning_window",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: IMPERF_0(),
    backdrop: "cream_cloud",
  };
  assert.throws(
    () => assemblePrompt({ occasion: "halloween", vars }),
    /unknown occasion/i,
  );
});

test("assemblePrompt throws on invalid slot value", () => {
  const vars = {
    species: "peony",
    lighting: "neon_dance_floor",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: IMPERF_0(),
    backdrop: "cream_cloud",
  };
  assert.throws(
    () => assemblePrompt({ occasion: "birthday", vars }),
    /invalid lighting/i,
  );
});

function IMPERF_0() {
  return "one outer petal slightly bruised at the tip";
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/artwork-prompts.test.js`
Expected: FAIL with "Cannot find PROMPT_TEMPLATE_VERSION" or assertion failures

- [ ] **Step 3: Rewrite `src/services/artwork-prompts.js`**

Replace the entire file. Old exports (`VALID_OCCASIONS`, `VALID_STYLES`, `buildPrompt`, `listAllPrompts`) are removed because nothing downstream needs them after this task — the new pipeline reads from `artwork-vocab.js` directly.

```js
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
  IMPERFECTION,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/artwork-prompts.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/artwork-prompts.js test/services/artwork-prompts.test.js
git commit -m "feat(artwork): replace prompt builder with template assembler

assemblePrompt(occasion, vars) produces the final Flux prompt from a vars
object whose slots are validated against artwork-vocab. Deletes the old
VALID_OCCASIONS/VALID_STYLES/buildPrompt API — nothing reads them after this
commit; song-artwork.js consumes the new API in Task 7.

PROMPT_TEMPLATE_VERSION is exported so params_hash can include it.

Co-authored by Ambrose Obimma"
```

---

## Task 4: Lyrics → vars extractor (Haiku call)

Reads finalized lyrics + occasion, calls Anthropic Haiku 4.5 with a structured-output prompt, validates the picks against `artwork-vocab`, returns the final vars (with fallback on any invalid value).

**Files:**

- Create: `src/services/artwork-vars-extractor.js`
- Test: `test/services/artwork-vars-extractor.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/services/artwork-vars-extractor.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractArtworkVars, parseHaikuResponse, IMPERFECTION } = (() => {
  const m = require("../../src/services/artwork-vars-extractor");
  const { IMPERFECTION } = require("../../src/services/artwork-vocab");
  return { ...m, IMPERFECTION };
})();

test("parseHaikuResponse parses valid JSON with all slots", () => {
  const raw = JSON.stringify({
    species: "ranunculus",
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.species, "ranunculus");
  assert.equal(parsed.lighting, "morning_window");
});

test("parseHaikuResponse falls back to occasion defaults on invalid lighting", () => {
  const raw = JSON.stringify({
    species: "ranunculus",
    lighting: "neon_dance_floor", // invalid
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.lighting, "morning_window"); // default for mothers_day
  assert.equal(parsed.species, "ranunculus"); // unchanged
});

test("parseHaikuResponse falls back to occasion defaults on cross-occasion species", () => {
  const raw = JSON.stringify({
    species: "white calla lily", // valid for bereavement, not mothers_day
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.species, "ranunculus"); // mothers_day default
});

test("parseHaikuResponse returns full defaults on completely malformed JSON", () => {
  const parsed = parseHaikuResponse("not even json {{{", "mothers_day");
  assert.equal(parsed.species, "ranunculus");
  assert.equal(parsed.lighting, "morning_window");
  assert.equal(parsed.palette, "dusty_rose");
});

test("extractArtworkVars stubs Haiku and returns picks", async () => {
  const fakeHaiku = async ({ prompt, systemPrompt }) => {
    assert.ok(prompt.includes("I knew you as a young girl"));
    assert.ok(systemPrompt.includes("artwork variables"));
    return {
      text: JSON.stringify({
        species: "ranunculus",
        lighting: "morning_window",
        palette: "dusty_rose",
        density: "intimate_cluster",
        imperfection: "one outer petal slightly bruised at the tip",
        backdrop: "cream_cloud",
      }),
    };
  };
  const result = await extractArtworkVars({
    lyrics: "I knew you as a young girl but I watched you grow",
    occasion: "mothers_day",
    haikuClient: fakeHaiku,
  });
  assert.equal(result.species, "ranunculus");
  assert.equal(result.picked_by, "haiku");
  assert.ok(result.picked_at);
});

test("extractArtworkVars falls back to defaults on Haiku failure", async () => {
  const failingHaiku = async () => {
    throw new Error("503 service unavailable");
  };
  const result = await extractArtworkVars({
    lyrics: "any lyrics",
    occasion: "mothers_day",
    haikuClient: failingHaiku,
  });
  assert.equal(result.species, "ranunculus"); // default
  assert.equal(result.picked_by, "fallback_occasion_default");
});

test("extractArtworkVars falls back on Haiku timeout", async () => {
  const slowHaiku = () =>
    new Promise((r) => setTimeout(() => r({ text: "{}" }), 30000));
  const result = await extractArtworkVars({
    lyrics: "any",
    occasion: "mothers_day",
    haikuClient: slowHaiku,
    timeoutMs: 50,
  });
  assert.equal(result.picked_by, "fallback_occasion_default");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/artwork-vars-extractor.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the extractor**

````js
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
        taskType: "lyrics",
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
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/artwork-vars-extractor.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/artwork-vars-extractor.js test/services/artwork-vars-extractor.test.js
git commit -m "feat(artwork): lyrics → bounded-vocab vars extractor (Haiku 4.5)

Sends lyrics + occasion to Haiku with the curated menu as the picking
surface. Validates every returned slot value against artwork-vocab; any
invalid pick falls back to the occasion default. Total failures (timeout,
network, parse error) collapse to occasion defaults so the artwork pipeline
never blocks on this step.

Co-authored by Ambrose Obimma"
```

---

## Task 5: Flux image provider adapter

New adapter conforming to the existing `getImageProvider` shape. Calls Replicate's `flux-1.1-pro-ultra` model, returns raw image bytes. Mirrors the surface of `openai-image.js` (NAME, dataHandling, generate, ModerationRefusalError, ImageGenerationError) so the registry swap is uniform.

**Files:**

- Create: `src/services/image-providers/flux-image.js`
- Test: `test/services/image-providers/flux-image.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/services/image-providers/flux-image.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const flux = require("../../../src/services/image-providers/flux-image");

test("flux module exports the expected adapter shape", () => {
  assert.equal(flux.name, "flux");
  assert.equal(flux.model, "black-forest-labs/flux-1.1-pro-ultra");
  assert.equal(typeof flux.generate, "function");
  assert.ok(flux.ModerationRefusalError);
  assert.ok(flux.ImageGenerationError);
});

test("generate() requires a non-empty prompt", async () => {
  await assert.rejects(
    () => flux.generate({ prompt: "", apiKey: "x" }),
    /non-empty prompt/i,
  );
});

test("generate() requires apiKey or REPLICATE_API_TOKEN", async () => {
  const saved = process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  await assert.rejects(
    () => flux.generate({ prompt: "real prompt" }),
    /REPLICATE_API_TOKEN/i,
  );
  if (saved) process.env.REPLICATE_API_TOKEN = saved;
});

test("generate() posts correct payload to Replicate predictions endpoint", async () => {
  let capturedRequest = null;
  const fakeFetch = async (url, opts) => {
    capturedRequest = { url, opts };
    if (url.endsWith("/predictions")) {
      return new Response(
        JSON.stringify({ id: "pred_abc", status: "starting" }),
        { status: 201 },
      );
    }
    if (url.includes("/predictions/pred_abc")) {
      return new Response(
        JSON.stringify({
          id: "pred_abc",
          status: "succeeded",
          output: ["https://replicate.delivery/x/y.jpg"],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("y.jpg")) {
      return new Response(Buffer.alloc(2048, "x"), { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const buf = await flux.generate({
    prompt: "a peony, photoreal",
    negativePrompt: "no text",
    apiKey: "test_token",
    fetchFn: fakeFetch,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length >= 2048);
  assert.ok(capturedRequest.url.startsWith("https://api.replicate.com"));
  const body = JSON.parse(capturedRequest.opts.body);
  assert.equal(body.input.prompt, "a peony, photoreal");
  assert.equal(body.input.aspect_ratio, "1:1");
  assert.equal(body.input.output_format, "jpg");
});

test("generate() maps Replicate moderation refusal to ModerationRefusalError", async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith("/predictions")) {
      return new Response(
        JSON.stringify({
          id: "pred_x",
          status: "failed",
          error: "NSFW content detected by safety_checker",
        }),
        { status: 201 },
      );
    }
    if (url.includes("/predictions/pred_x")) {
      return new Response(
        JSON.stringify({
          id: "pred_x",
          status: "failed",
          error: "NSFW content detected by safety_checker",
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  };
  await assert.rejects(
    () => flux.generate({ prompt: "x", apiKey: "t", fetchFn: fakeFetch }),
    flux.ModerationRefusalError,
  );
});

test("generate() maps other failures to ImageGenerationError", async () => {
  const fakeFetch = async () => new Response("server error", { status: 500 });
  await assert.rejects(
    () => flux.generate({ prompt: "x", apiKey: "t", fetchFn: fakeFetch }),
    flux.ImageGenerationError,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/image-providers/flux-image.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the adapter**

```js
// src/services/image-providers/flux-image.js
/**
 * Flux 1.1 Pro Ultra adapter via Replicate.
 *
 * Endpoint: POST https://api.replicate.com/v1/predictions
 * Model:    black-forest-labs/flux-1.1-pro-ultra
 * Output:   2048×2048 native JPEG; we request aspect_ratio "1:1" + output_format "jpg".
 *
 * Cost:    ~$0.06 per image (May 2026 pricing).
 *
 * Errors:
 *   ModerationRefusalError — Replicate's safety checker rejected the prompt or output.
 *   ImageGenerationError   — any other failure (timeout, 5xx, malformed response).
 */

const NAME = "flux";
const MODEL = "black-forest-labs/flux-1.1-pro-ultra";
const BASE_URL = "https://api.replicate.com";
const PREDICTIONS_URL = `${BASE_URL}/v1/predictions`;
const DEFAULT_TIMEOUT_MS = parseInt(
  process.env.FLUX_TIMEOUT_MS || "120000",
  10,
);
const POLL_INTERVAL_MS = 2000;

const dataHandling = {
  processorLocation: "US (Replicate)",
  retention:
    "Replicate retains prediction inputs for 30 days for debugging; configure org-level deletion if stricter retention is needed.",
  containsPII: false,
};

class ModerationRefusalError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = "ModerationRefusalError";
    this.code = "moderation_blocked";
    this.cause = originalError;
  }
}

class ImageGenerationError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = "ImageGenerationError";
    this.cause = originalError;
  }
}

function isModerationFailure(replicateError) {
  if (!replicateError) return false;
  const msg = String(replicateError).toLowerCase();
  return (
    msg.includes("nsfw") ||
    msg.includes("safety_checker") ||
    msg.includes("content policy")
  );
}

async function generate({
  prompt,
  negativePrompt,
  apiKey,
  size, // ignored — Flux Pro Ultra is fixed at 2048×2048
  quality, // ignored — single quality tier
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new ImageGenerationError(
      "generate() requires a non-empty prompt string",
    );
  }
  const token = apiKey || process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new ImageGenerationError("REPLICATE_API_TOKEN is not set");
  }

  // 1. POST to create prediction
  let createResp;
  try {
    createResp = await fetchFn(PREDICTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: {
          prompt,
          negative_prompt: negativePrompt || "",
          aspect_ratio: "1:1",
          output_format: "jpg",
          output_quality: 92,
          safety_tolerance: 2, // default; lower number = stricter
        },
      }),
    });
  } catch (err) {
    throw new ImageGenerationError(
      `Network error contacting Replicate: ${err.message}`,
      err,
    );
  }
  if (!createResp.ok && createResp.status !== 201) {
    let payload = null;
    try {
      payload = await createResp.json();
    } catch {
      /* ignore */
    }
    throw new ImageGenerationError(
      `Replicate create failed: HTTP ${createResp.status} ${(payload && payload.detail) || ""}`,
      payload,
    );
  }
  const created = await createResp.json();
  if (!created || !created.id) {
    throw new ImageGenerationError(
      `Replicate response missing prediction id`,
      created,
    );
  }
  if (created.status === "failed" && isModerationFailure(created.error)) {
    throw new ModerationRefusalError(
      `Flux refused generation: ${created.error}`,
      created,
    );
  }
  const predictionId = created.id;

  // 2. Poll for completion
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let prediction = created;
  while (prediction.status !== "succeeded" && Date.now() < deadline) {
    if (prediction.status === "failed" || prediction.status === "canceled") {
      if (isModerationFailure(prediction.error)) {
        throw new ModerationRefusalError(
          `Flux failed (moderation): ${prediction.error}`,
          prediction,
        );
      }
      throw new ImageGenerationError(
        `Flux prediction ${prediction.status}: ${prediction.error || "unknown"}`,
        prediction,
      );
    }
    await sleepFn(POLL_INTERVAL_MS);
    let pollResp;
    try {
      pollResp = await fetchFn(`${PREDICTIONS_URL}/${predictionId}`, {
        headers: { Authorization: `Token ${token}` },
      });
    } catch (err) {
      throw new ImageGenerationError(
        `Network error polling Replicate: ${err.message}`,
        err,
      );
    }
    if (!pollResp.ok) {
      throw new ImageGenerationError(
        `Replicate poll failed: HTTP ${pollResp.status}`,
      );
    }
    prediction = await pollResp.json();
  }
  if (prediction.status !== "succeeded") {
    throw new ImageGenerationError(
      `Flux timed out after ${DEFAULT_TIMEOUT_MS}ms`,
    );
  }

  // 3. Normalize output URL — Replicate returns string or array of strings
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  if (!outputUrl) {
    throw new ImageGenerationError(`Flux returned no output URL`, prediction);
  }

  // 4. Download image bytes
  let downloadResp;
  try {
    downloadResp = await fetchFn(outputUrl);
  } catch (err) {
    throw new ImageGenerationError(
      `Failed to download Flux output: ${err.message}`,
      err,
    );
  }
  if (!downloadResp.ok) {
    throw new ImageGenerationError(
      `Flux output download HTTP ${downloadResp.status}`,
    );
  }
  const arrayBuffer = await downloadResp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  name: NAME,
  model: MODEL,
  dataHandling,
  generate,
  // No moderationCheck export — Replicate gates at generation time; pre-flight moderation is OpenAI's responsibility.
  ModerationRefusalError,
  ImageGenerationError,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/image-providers/flux-image.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/image-providers/flux-image.js test/services/image-providers/flux-image.test.js
git commit -m "feat(images): flux 1.1 pro ultra adapter via replicate

Conforms to the existing image-provider shape (name, dataHandling, generate,
ModerationRefusalError, ImageGenerationError). Calls Replicate predictions
API, polls to completion, downloads bytes. Maps NSFW/safety_checker failures
to ModerationRefusalError so the orchestrator can route to library fallback
without retrying.

Co-authored by Ambrose Obimma"
```

---

## Task 6: Register Flux in the provider registry

Wires the new adapter into `getImageProvider()` so `IMAGE_PROVIDER=flux` resolves to it.

**Files:**

- Modify: `src/services/image-providers/index.js`
- Test: `test/services/image-providers/registry.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
// test/services/image-providers/registry.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { getImageProvider } = require("../../../src/services/image-providers");

test("getImageProvider('openai') returns the OpenAI adapter", () => {
  const p = getImageProvider("openai");
  assert.equal(p.name, "openai");
});

test("getImageProvider('flux') returns the Flux adapter", () => {
  const p = getImageProvider("flux");
  assert.equal(p.name, "flux");
  assert.equal(typeof p.generate, "function");
});

test("getImageProvider() honours IMAGE_PROVIDER env var", () => {
  const saved = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "flux";
  const p = getImageProvider();
  assert.equal(p.name, "flux");
  if (saved == null) delete process.env.IMAGE_PROVIDER;
  else process.env.IMAGE_PROVIDER = saved;
});

test("getImageProvider throws on unknown", () => {
  assert.throws(() => getImageProvider("midjourney"), /Unknown image provider/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/image-providers/registry.test.js`
Expected: FAIL — `flux` not registered yet.

- [ ] **Step 3: Update the registry**

```js
// src/services/image-providers/index.js
const openai = require("./openai-image");
const flux = require("./flux-image");

const PROVIDERS = {
  openai,
  flux,
};

function getImageProvider(name = process.env.IMAGE_PROVIDER || "openai") {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown image provider: ${name}. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

module.exports = {
  getImageProvider,
  // Re-export error classes from the OpenAI adapter — they're the canonical
  // shapes the orchestrator catches. Flux's classes are sub-classable to these
  // by name match (we type-check via instanceof against both).
  ModerationRefusalError: openai.ModerationRefusalError,
  ImageGenerationError: openai.ImageGenerationError,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/image-providers/registry.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/image-providers/index.js test/services/image-providers/registry.test.js
git commit -m "feat(images): register flux in provider registry

Co-authored by Ambrose Obimma"
```

---

## Task 7: Rewire song-artwork.js to use the new pipeline

Replaces the style-variant + occasion-subject builder with the new vars-based pipeline. Implements the Flux-primary → OpenAI-fallback chain. Drops `pickStyleVariant` because there are no more styles.

**Files:**

- Modify: `src/services/song-artwork.js`
- Modify: `test/services/song-artwork.test.js`

- [ ] **Step 1: Update tests to express the new behavior**

Add these test cases (preserve existing tests that still apply; remove tests asserting `pickStyleVariant` or style-bucketed library paths):

```js
// test/services/song-artwork.test.js — appended cases
test("generateSongArtwork builds prompt from artwork_vars and calls primary provider", async () => {
  const calls = { generate: null };
  const fakeFlux = {
    name: "flux",
    generate: async ({ prompt, negativePrompt }) => {
      calls.generate = { prompt, negativePrompt };
      return Buffer.alloc(8192, "x");
    },
  };
  const fakePrepare = async (buf) => buf; // skip sharp validation for unit test
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t1",
    occasion: "mothers_day",
    recipientName: "Chioma",
    tier: "plus",
    artworkVars: {
      species: "ranunculus",
      lighting: "morning_window",
      palette: "dusty_rose",
      density: "intimate_cluster",
      imperfection: "one outer petal slightly bruised at the tip",
      backdrop: "cream_cloud",
      picked_by: "haiku",
      picked_at: "2026-05-18T12:00:00Z",
    },
    dependencies: {
      providerFactory: () => fakeFlux,
      prepareGeneratedImageFn: fakePrepare,
      compositeFn: async ({ baseImagePath }) => baseImagePath,
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.provider, "flux");
  assert.equal(result.promptVersion, "v2.1.0-photoreal-flora");
  assert.ok(calls.generate.prompt.includes("ranunculus"));
  assert.ok(calls.generate.negativePrompt.includes("no text"));
});

test("generateSongArtwork falls back to OpenAI on Flux infra failure", async () => {
  const fakeFlux = {
    name: "flux",
    generate: async () => {
      throw new Error("HTTP 503");
    },
  };
  const fakeOpenAI = {
    name: "openai",
    generate: async () => Buffer.alloc(8192, "y"),
  };
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t2",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: (name) => (name === "flux" ? fakeFlux : fakeOpenAI),
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ baseImagePath }) => baseImagePath,
    },
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.source, "generated");
});

test("generateSongArtwork falls back to library on Flux moderation refusal (no OpenAI retry)", async () => {
  const {
    ModerationRefusalError,
  } = require("../../src/services/image-providers");
  const fakeFlux = {
    name: "flux",
    generate: async () => {
      throw new ModerationRefusalError("moderation_blocked");
    },
  };
  let openaiCalled = false;
  const fakeOpenAI = {
    name: "openai",
    generate: async () => {
      openaiCalled = true;
      return Buffer.alloc(0);
    },
  };
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t3",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: (name) => (name === "flux" ? fakeFlux : fakeOpenAI),
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ baseImagePath }) => baseImagePath,
      libraryPathFn: (occ, n) => `/tmp/library-${occ}-${n}.jpg`,
    },
  });
  assert.equal(
    openaiCalled,
    false,
    "must not retry OpenAI on moderation refusal",
  );
  assert.equal(result.source, "fallback");
});

function defaultsFor(occ) {
  const { getDefault } = require("../../src/services/artwork-vocab");
  return {
    ...getDefault(occ),
    picked_by: "fallback",
    picked_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/services/song-artwork.test.js`
Expected: FAIL — `pickStyleVariant` removed but old tests reference it; new tests fail.

- [ ] **Step 3: Rewrite `src/services/song-artwork.js`**

```js
// src/services/song-artwork.js
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { ensureDir } = require("../utils/common");
const { OCCASIONS, getDefault } = require("./artwork-vocab");
const {
  PROMPT_TEMPLATE_VERSION,
  assemblePrompt,
  assembleNegativePrompt,
} = require("./artwork-prompts");
const {
  getImageProvider,
  ModerationRefusalError,
} = require("./image-providers");
const { compositeArtworkWithText } = require("./cover-generator");
const { trackArtworkKey } = require("../storage");

const PAID_TIERS = new Set(["plus", "pro"]);
const FREE_LIBRARY_VARIANT_COUNT = 5;
const GENERATED_IMAGE_DIM = 2048;
const MIN_PROVIDER_IMAGE_BYTES = 1024;
const MIN_PROVIDER_IMAGE_WIDTH = 1280;
const MIN_PROVIDER_IMAGE_HEIGHT = 1280;

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), "storage");
const PRIMARY_PROVIDER = process.env.IMAGE_PROVIDER || "flux";
const FALLBACK_PROVIDER = "openai";

function libraryPath(occasion, variantIndex) {
  return path.join(
    STORAGE_ROOT,
    "artwork-library",
    "v2",
    occasion,
    `${variantIndex}.jpg`,
  );
}

function pickLibraryVariant({ trackId, userId }) {
  const h = crypto
    .createHash("sha1")
    .update(`${userId}:${trackId}`)
    .digest("hex");
  const n = parseInt(h.slice(0, 8), 16);
  return n % FREE_LIBRARY_VARIANT_COUNT;
}

function trackDir({ userId, trackId }) {
  return path.join(STORAGE_ROOT, "tracks", userId, trackId);
}

function computeContentHash({ occasion, artworkVars, promptVersion }) {
  // recipient_name is excluded — it's never in the prompt.
  // imperfection IS included because it changes the image.
  const normalized = JSON.stringify({
    occasion,
    species: artworkVars.species,
    lighting: artworkVars.lighting,
    palette: artworkVars.palette,
    density: artworkVars.density,
    imperfection: artworkVars.imperfection,
    backdrop: artworkVars.backdrop,
    promptVersion,
  });
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

async function prepareGeneratedBaseImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_PROVIDER_IMAGE_BYTES) {
    throw new Error(
      `Image provider returned invalid buffer (${buffer && buffer.length} bytes)`,
    );
  }
  const sharp = require("sharp");
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  const w = Number(metadata.width || 0);
  const h = Number(metadata.height || 0);
  if (w < MIN_PROVIDER_IMAGE_WIDTH || h < MIN_PROVIDER_IMAGE_HEIGHT) {
    throw new Error(`Provider returned undersized image (${w}x${h})`);
  }
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(GENERATED_IMAGE_DIM, GENERATED_IMAGE_DIM, {
      fit: "cover",
      position: "center",
    })
    .jpeg({ quality: 92, progressive: true, mozjpeg: true })
    .toBuffer();
}

async function tryProviderChain({
  prompt,
  negativePrompt,
  providerFactory,
  logger,
}) {
  // 1. Try primary (Flux by default)
  try {
    const primary = providerFactory(PRIMARY_PROVIDER);
    const buf = await primary.generate({ prompt, negativePrompt });
    return { buf, provider: PRIMARY_PROVIDER };
  } catch (err) {
    if (
      err instanceof ModerationRefusalError ||
      (err && err.name === "ModerationRefusalError")
    ) {
      // No retry on moderation — same prompt will refuse on OpenAI too.
      throw err;
    }
    logger.warn(
      `[song-artwork] primary ${PRIMARY_PROVIDER} failed: ${err.message}; retrying on ${FALLBACK_PROVIDER}`,
    );
  }
  // 2. Try fallback (OpenAI)
  const fallback = providerFactory(FALLBACK_PROVIDER);
  if (typeof fallback.moderationCheck === "function") {
    const mod = await fallback.moderationCheck({ prompt });
    if (mod && mod.flagged) {
      throw new ModerationRefusalError("fallback moderation refused prompt");
    }
  }
  const buf = await fallback.generate({
    prompt,
    size: "1024x1024",
    quality: "high",
  });
  return { buf, provider: FALLBACK_PROVIDER };
}

async function generateSongArtwork({
  userId,
  trackId,
  occasion,
  recipientName,
  senderName,
  tier,
  artworkVars, // NEW required input — comes from artwork-vars-extractor
  previousContentHash,
  forceRegenerate = false,
  dependencies = {},
}) {
  if (!userId || !trackId)
    throw new Error("generateSongArtwork requires userId and trackId");
  if (!OCCASIONS.includes(occasion))
    throw new Error(`Invalid occasion: ${occasion}`);

  const providerFactory = dependencies.providerFactory || getImageProvider;
  const compositeFn = dependencies.compositeFn || compositeArtworkWithText;
  const prepareGeneratedImageFn =
    dependencies.prepareGeneratedImageFn || prepareGeneratedBaseImage;
  const libraryPathFn = dependencies.libraryPathFn || libraryPath;
  const storageProvider = dependencies.storageProvider || null;
  const logger = dependencies.logger || console;

  // Default vars if not provided (covers the case where R1.5 was skipped, e.g.
  // tests or older callers). Production callers always pass vars.
  const vars = artworkVars || {
    ...getDefault(occasion),
    picked_by: "fallback_no_extractor",
    picked_at: new Date().toISOString(),
  };
  const promptVersion = PROMPT_TEMPLATE_VERSION;
  const contentHash = computeContentHash({
    occasion,
    artworkVars: vars,
    promptVersion,
  });

  if (
    !forceRegenerate &&
    previousContentHash &&
    previousContentHash === contentHash
  ) {
    return {
      skipped: true,
      reason: "unchanged",
      contentHash,
      artworkVars: vars,
      promptVersion,
    };
  }

  const outDir = trackDir({ userId, trackId });
  ensureDir(outDir);
  const isPaid = PAID_TIERS.has(String(tier || "").toLowerCase());

  let baseImagePath;
  let source = "fallback";
  let provider = null;
  let prompt = null;
  let moderationPassed = true;

  if (isPaid) {
    prompt = assemblePrompt({ occasion, vars });
    const negativePrompt = assembleNegativePrompt();
    try {
      const { buf, provider: usedProvider } = await tryProviderChain({
        prompt,
        negativePrompt,
        providerFactory,
        logger,
      });
      const normalized = await prepareGeneratedImageFn(buf);
      const generatedPath = path.join(outDir, "artwork_base.jpg");
      await fs.promises.writeFile(generatedPath, normalized);
      baseImagePath = generatedPath;
      source = "generated";
      provider = usedProvider;
    } catch (err) {
      if (
        err instanceof ModerationRefusalError ||
        (err && err.name === "ModerationRefusalError")
      ) {
        moderationPassed = false;
        logger.warn(
          `[song-artwork] moderation refusal for track ${trackId}; using library`,
        );
      } else {
        moderationPassed = false;
        logger.warn(
          `[song-artwork] all providers failed for track ${trackId}: ${err.message}; using library`,
        );
      }
      source = "fallback";
      const variant = pickLibraryVariant({ userId, trackId });
      baseImagePath = libraryPathFn(occasion, variant);
    }
  } else {
    // Free tier
    const variant = pickLibraryVariant({ userId, trackId });
    baseImagePath = libraryPathFn(occasion, variant);
    source = "library";
  }

  if (!fs.existsSync(baseImagePath)) {
    const err = new Error(
      `Artwork base missing — library v2 not bootstrapped? Expected: ${baseImagePath}. ` +
        `Run scripts/build-artwork-library-v2.mjs.`,
    );
    err.code = "LIBRARY_NOT_BOOTSTRAPPED";
    err.permanent = true;
    throw err;
  }

  // Compositing exists for back-compat with the share/export pipeline. The
  // canonical asset for runtime overlay is `baseImagePath`; compositeFn here
  // just copies it (target overlay is now done at export time).
  const artworkPath = await compositeFn({
    baseImagePath,
    recipientName,
    senderName,
    occasion,
    outputDir: outDir,
    targetAspect: "1:1",
  });

  if (
    storageProvider &&
    storageProvider.type !== "local" &&
    typeof storageProvider.putFile === "function"
  ) {
    try {
      const remoteKey = trackArtworkKey({ userId, trackId });
      await storageProvider.putFile({
        key: remoteKey,
        filePath: artworkPath,
        contentType: "image/jpeg",
      });
    } catch (uploadErr) {
      logger.warn(
        `[song-artwork] S3 upload failed for track ${trackId}: ${uploadErr.message}`,
      );
    }
  }

  const versionStamp = Date.now();
  return {
    skipped: false,
    artworkPath,
    artworkUrl: `/tracks/${trackId}/artwork.jpg?v=${versionStamp}`,
    source,
    provider,
    prompt,
    moderationPassed,
    promptVersion,
    artworkVars: vars,
    contentHash,
    generatedAt: new Date(versionStamp),
  };
}

module.exports = {
  generateSongArtwork,
  pickLibraryVariant,
  computeContentHash,
  prepareGeneratedBaseImage,
  libraryPath,
  PROMPT_TEMPLATE_VERSION,
  FREE_LIBRARY_VARIANT_COUNT,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/services/song-artwork.test.js`
Expected: PASS (existing tests that still apply + 3 new cases).

If any pre-existing test fails because it asserted `pickStyleVariant` or style-bucketed library paths, delete those assertions — they no longer apply. Do not preserve them out of caution; the spec explicitly removes that API.

- [ ] **Step 5: Commit**

```bash
git add src/services/song-artwork.js test/services/song-artwork.test.js
git commit -m "feat(artwork): vars-based pipeline, flux primary + openai fallback

- generateSongArtwork now takes artworkVars (from the Haiku extractor) and
  builds the prompt via assemblePrompt(occasion, vars).
- tryProviderChain runs Flux first; ModerationRefusalError short-circuits to
  the library (no OpenAI retry on the same prompt); other failures retry on
  OpenAI.
- pickStyleVariant + VALID_STYLES gone; replaced by pickLibraryVariant which
  selects from the 5-variant per-occasion library v2.
- params_hash now incorporates artwork_vars + prompt_template_version so a
  re-render with same vars hits cache.

Co-authored by Ambrose Obimma"
```

---

## Task 8: Wire artwork-job.js to extract vars before generating

The artwork job currently calls `generateSongArtwork` directly. Now it must:

1. Read the finalized lyrics from `track_versions.lyrics_json`
2. Call `extractArtworkVars(lyrics, occasion)`
3. Persist the picked vars to `track_versions.artwork_vars_json`
4. Pass the vars into `generateSongArtwork`

**Files:**

- Modify: `src/jobs/artwork-job.js`
- Modify: `test/jobs/artwork-job.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to existing artwork-job test file:

```js
// test/jobs/artwork-job.test.js — appended cases
test("runArtworkJob calls vars extractor and persists artwork_vars_json", async () => {
  const db = await createTestDbWithTrack({
    trackId: "track-vars-1",
    versionId: "tv-vars-1",
    occasion: "mothers_day",
    lyricsJson: JSON.stringify({ text: "I knew you as a young girl..." }),
    tier: "plus",
  });

  let extractorCalled = null;
  const fakeExtract = async ({ lyrics, occasion }) => {
    extractorCalled = { lyrics, occasion };
    return {
      species: "ranunculus",
      lighting: "morning_window",
      palette: "dusty_rose",
      density: "intimate_cluster",
      imperfection: "one outer petal slightly bruised at the tip",
      backdrop: "cream_cloud",
      picked_by: "haiku",
      picked_at: "2026-05-18T12:00:00Z",
    };
  };

  await runArtworkJob({
    db,
    trackId: "track-vars-1",
    trackVersionId: "tv-vars-1",
    jobId: "job-1",
    generateFn: async ({ artworkVars }) => ({
      skipped: false,
      artworkPath: "/tmp/x.jpg",
      artworkUrl: "/u/x.jpg",
      source: "generated",
      provider: "flux",
      prompt: "p",
      promptVersion: "v2.1.0-photoreal-flora",
      artworkVars,
      contentHash: "h",
      moderationPassed: true,
      generatedAt: new Date(),
    }),
    extractVarsFn: fakeExtract,
    tierResolver: async () => ({ tier: "plus" }),
  });

  assert.ok(extractorCalled);
  assert.equal(extractorCalled.occasion, "mothers_day");
  assert.ok(extractorCalled.lyrics.includes("young girl"));

  const row = db
    .prepare(
      "SELECT artwork_vars_json, artwork_provider, artwork_prompt_version FROM track_versions WHERE id = ?",
    )
    .get("tv-vars-1");
  const persisted = JSON.parse(row.artwork_vars_json);
  assert.equal(persisted.species, "ranunculus");
  assert.equal(row.artwork_provider, "flux");
  assert.equal(row.artwork_prompt_version, "v2.1.0-photoreal-flora");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/jobs/artwork-job.test.js`
Expected: FAIL — `extractVarsFn` param ignored, columns not written.

- [ ] **Step 3: Modify `src/jobs/artwork-job.js`**

In `runArtworkJobInner`, after fetching the track + tier, BEFORE calling `generateFn`:

```js
// At the top of the file (near other requires):
const { extractArtworkVars } = require("../services/artwork-vars-extractor");

// In runArtworkJob's signature add `extractVarsFn = extractArtworkVars`.

// Inside runArtworkJobInner, between the existing tier-resolution block and
// the call to generateFn(...), add:

let artworkVars = null;
try {
  const versionRow = db
    .prepare(`SELECT lyrics_json FROM track_versions WHERE id = ?`)
    .get(trackVersionId);
  const lyricsJson = versionRow && versionRow.lyrics_json;
  const lyrics = (() => {
    if (!lyricsJson) return "";
    try {
      const parsed =
        typeof lyricsJson === "string" ? JSON.parse(lyricsJson) : lyricsJson;
      return parsed.text || parsed.lyrics || JSON.stringify(parsed);
    } catch {
      return String(lyricsJson);
    }
  })();
  artworkVars = await extractVarsFn({
    lyrics,
    occasion: track.occasion,
    logger,
  });
} catch (err) {
  logger.warn(
    `[artwork-job] vars extraction failed for track ${trackId}: ${err.message}; using occasion defaults`,
  );
  const { getDefault } = require("../services/artwork-vocab");
  artworkVars = {
    ...getDefault(track.occasion),
    picked_by: "fallback_extractor_error",
    picked_at: new Date().toISOString(),
  };
}

// Then pass to generateFn:
const result = await generateFn({
  userId: track.user_id,
  trackId,
  occasion: track.occasion,
  recipientName: track.recipient_name,
  senderName: track.sender_name,
  tier,
  artworkVars, // NEW
  previousContentHash: track.artwork_content_hash,
  dependencies: generateDependencies,
});

// After generateFn, in persistArtwork — or inline here — persist the vars:
db.prepare(
  `UPDATE track_versions
   SET artwork_vars_json = ?, artwork_provider = ?, artwork_prompt_version = ?
   WHERE id = ?`,
).run(
  JSON.stringify(result.artworkVars || artworkVars),
  result.provider || null,
  result.promptVersion || null,
  trackVersionId,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/jobs/artwork-job.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jobs/artwork-job.js test/jobs/artwork-job.test.js
git commit -m "feat(artwork): job extracts lyrics→vars before generation

runArtworkJob reads track_versions.lyrics_json, calls extractArtworkVars
with the finalized lyrics + occasion, persists the picked vars to
artwork_vars_json, then passes them to generateSongArtwork. Falls back to
occasion defaults if extraction fails — never blocks the render.

Co-authored by Ambrose Obimma"
```

---

## Task 9: Lyrics fixture files (15 golden test inputs)

Each occasion gets one canonical lyric fixture used by integration / golden tests downstream.

**Files:**

- Create: `test/fixtures/lyrics/mothers_day.txt`
- Create: `test/fixtures/lyrics/birthday.txt`
- Create: `test/fixtures/lyrics/anniversary.txt`
- Create: `test/fixtures/lyrics/thank_you.txt`
- Create: `test/fixtures/lyrics/i_love_you.txt`
- Create: `test/fixtures/lyrics/wedding.txt`
- Create: `test/fixtures/lyrics/graduation.txt`
- Create: `test/fixtures/lyrics/celebration.txt`
- Create: `test/fixtures/lyrics/apology.txt`
- Create: `test/fixtures/lyrics/encouragement.txt`
- Create: `test/fixtures/lyrics/advice.txt`
- Create: `test/fixtures/lyrics/bereavement.txt`
- Create: `test/fixtures/lyrics/friendship.txt`
- Create: `test/fixtures/lyrics/get_well.txt`
- Create: `test/fixtures/lyrics/custom.txt`

- [ ] **Step 1: Write all 15 fixtures**

Each is 8-12 lines, emotionally distinct so Haiku's picks are testable. Below are the exact contents.

`test/fixtures/lyrics/mothers_day.txt`:

```
I knew you as a young girl but I watched you grow
Into the woman with the courage only mothers know
From the first light of morning till the day is done
You carried us through everything, mama, the brave one
You taught me how to listen, how to stand, how to forgive
Every quiet sacrifice was how you chose to live
And if I have any softness, it's the softness you gave
The garden you planted in me, mama, every petal a wave
```

`test/fixtures/lyrics/birthday.txt`:

```
Another year of you in the world and the world keeps spinning brighter
Candles on a kitchen counter, laugh lines a little tighter
You make the room feel like a holiday wherever you go
Every season you carry sunshine, every shadow you slow
So here's to the next one, may it find you exactly the same
Loud at the table, easy in the morning, the warmth and the flame
```

`test/fixtures/lyrics/anniversary.txt`:

```
Ten years on the same crooked porch and the swing still creaks the same
You still hum when you make the coffee, still forget my middle name
We built this from a list on a napkin, from a no into a maybe
From a goodnight into a goodbye-never, from a question into a baby
And every season we keep choosing, every winter we keep warm
Tonight I'll find you in the doorway and I'll keep you from the storm
```

`test/fixtures/lyrics/thank_you.txt`:

```
You showed up before I asked and stayed long after the door
You wrote a kindness into my week I'll be paying back forevermore
It wasn't loud, it wasn't grand, just a steady patient hand
A thank-you note can't carry what you did, but here's where I'll stand
I'll watch for somebody else's door, I'll show up like you did
The chain of small good things is how the whole damn world gets fixed
```

`test/fixtures/lyrics/i_love_you.txt`:

```
I love you in the morning when the kitchen smells of bread
I love you in the silence when there's nothing to be said
I love you in the running and I love you in the still
I love you when you doubt yourself, I love you when you will
Three words feel too small for what you are
But I'll say them every day until they reach you wherever you are
```

`test/fixtures/lyrics/wedding.txt`:

```
We wrote our vows on the back of a receipt and they still hold true
Standing here in this borrowed light I'm choosing all of you
Through the years and the rooms and the rain and the slow song of a Sunday morning
Through the sickness and the boredom and the bills and the warning
I'll be your witness and you'll be mine, in front of everyone we love
Today we tie what was already tied; today is just a proof
```

`test/fixtures/lyrics/graduation.txt`:

```
You sat through the long lectures, you stayed up through the longer nights
You learned that knowing is half-knowing and the other half is fights
With your own assumptions, with the page that won't be read
With the voice inside that tells you you'll never get ahead
But here you are at the threshold and the ribbon and the gown
And the only thing you have to do today is take that diploma down
```

`test/fixtures/lyrics/celebration.txt`:

```
The whole street's at the table and the music's loud and slow
And the kids are running circles around the truth nobody knows
We did it, somehow, somehow we got here, all of us at once
And if tomorrow takes it back it took it back from us
But tonight there's cake and laughter and the porch light on full blast
And the only future I believe in is one this party can outlast
```

`test/fixtures/lyrics/apology.txt`:

```
I was wrong and I knew it before the sentence had finished forming
I built a wall out of being right while you were standing in the storming
I'm not asking for what I haven't earned, just space enough to say
That if I could pull the day back to the morning I'd live it a different way
I'll do the slow thing, the listening thing, the showing-up-without-a-cause thing
I'm sorry, plainly, and I'll be sorry as long as the work of being better takes
```

`test/fixtures/lyrics/encouragement.txt`:

```
I know you're tired and I know the road doesn't show you where it ends
But you're closer than you were and the light through the trees still bends
Toward the people who keep walking even when the map is wrong
Even when the doubt sings louder than the song
You don't have to be brave today, you only have to be there
Put one foot, then the other, then breathe, then look up at the air
```

`test/fixtures/lyrics/advice.txt`:

```
When the room gets loud and the choice gets small, find the quietest chair
Ask the question twice and listen for the silence between the answers there
The thing you're chasing isn't the thing — it's how you carry yourself toward it
The road has been walked, by people you'll never meet, in shoes you can't quite fit
Be slow, be honest, be kind to the version of you who hasn't decided
Whatever you choose, choose it like a person who's already on the other side of it
```

`test/fixtures/lyrics/bereavement.txt`:

```
The hallway still smells like you and the chair you used to sit
Holds a shape I can't fill in, a shape the light still hits
We're learning to say your name out loud in rooms you'll never enter
Learning to leave the porch light on, learning to keep our center
You aren't gone, just rearranged into every quiet thing
The bread, the rain, the song that catches halfway through a string
```

`test/fixtures/lyrics/friendship.txt`:

```
You were the friend who answered late and showed up early on the day that broke
You were the friend who carried what I couldn't say without speaking a word, just a joke
We built a language out of inside jokes and old apartments and bad ideas
We weathered all the small storms and a couple of the bigger years
And if the world divides us by miles or by minutes or by quiet phases
You'll still be the friend who answered, who showed up, in all my best stages
```

`test/fixtures/lyrics/get_well.txt`:

```
Lie down a while, let the kettle do the work, let the morning be slow
Whatever it is, it can wait for you, the world's not asking you to go
We brought the soup and the soft blanket and the bad detective shows
We brought ourselves and the front door is open, we'll stay as long as it goes
You don't have to be cheerful, you don't have to be brave on cue
The room is yours, the time is yours, the only job is getting through
```

`test/fixtures/lyrics/custom.txt`:

```
This one is for you the way only this one could be
For the days we don't have words for and the days we couldn't see
A song that says the thing you'd never ask to hear out loud
A song that finds you in the kitchen, in the elevator, in the crowd
Whatever this is, it's yours now — keep it, lose it, hold it close
Hand it to somebody when they need the version of you you love the most
```

- [ ] **Step 2: Verify all 15 files exist and have content**

Run: `ls test/fixtures/lyrics/ && wc -l test/fixtures/lyrics/*.txt`
Expected: 15 files, each between 6 and 12 lines.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/lyrics/
git commit -m "test(artwork): golden lyrics fixtures for all 15 occasions

8-12 line samples emotionally distinct enough to drive Haiku slot picks
deterministically in downstream golden tests.

Co-authored by Ambrose Obimma"
```

---

## Task 10: Integration test — lyrics → vars → prompt → stub Flux → JPEG written

End-to-end stubbed integration covering the new pipeline. No real network calls.

**Files:**

- Create: `test/services/artwork-pipeline.integration.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/services/artwork-pipeline.integration.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  extractArtworkVars,
} = require("../../src/services/artwork-vars-extractor");
const { generateSongArtwork } = require("../../src/services/song-artwork");
const {
  assemblePrompt,
  assembleNegativePrompt,
  PROMPT_TEMPLATE_VERSION,
} = require("../../src/services/artwork-prompts");

test("integration: mothers_day lyrics → vars → prompt → stubbed Flux → 2048² JPEG written", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artwork-int-"));
  process.env.STORAGE_ROOT = tmpRoot;

  const lyrics = fs.readFileSync(
    path.join(__dirname, "../fixtures/lyrics/mothers_day.txt"),
    "utf8",
  );

  // Stage 1 — extract vars (stub Haiku)
  const vars = await extractArtworkVars({
    lyrics,
    occasion: "mothers_day",
    haikuClient: async () => ({
      text: JSON.stringify({
        species: "ranunculus",
        lighting: "morning_window",
        palette: "dusty_rose",
        density: "intimate_cluster",
        imperfection: "one outer petal slightly bruised at the tip",
        backdrop: "cream_cloud",
      }),
    }),
  });
  assert.equal(vars.species, "ranunculus");
  assert.equal(vars.picked_by, "haiku");

  // Stage 2 — assemble prompt and verify shape
  const prompt = assemblePrompt({ occasion: "mothers_day", vars });
  const neg = assembleNegativePrompt();
  assert.ok(prompt.includes("ranunculus"));
  assert.ok(prompt.includes("Fuji X-T5"));
  assert.ok(neg.includes("no plastic finish"));

  // Stage 3 — generate (stubbed Flux + stubbed sharp prep + stubbed composite)
  const fakeBuffer = Buffer.alloc(8192, "x");
  const result = await generateSongArtwork({
    userId: "user-int",
    trackId: "track-int",
    occasion: "mothers_day",
    recipientName: "Chioma",
    tier: "plus",
    artworkVars: vars,
    dependencies: {
      providerFactory: (n) =>
        n === "flux"
          ? { name: "flux", generate: async () => fakeBuffer }
          : { name: "openai", generate: async () => fakeBuffer },
      prepareGeneratedImageFn: async () => fakeBuffer, // skip sharp
      compositeFn: async ({ baseImagePath }) => baseImagePath,
    },
  });

  assert.equal(result.provider, "flux");
  assert.equal(result.source, "generated");
  assert.equal(result.promptVersion, PROMPT_TEMPLATE_VERSION);
  assert.equal(result.artworkVars.species, "ranunculus");
  assert.ok(fs.existsSync(result.artworkPath));
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/services/artwork-pipeline.integration.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/services/artwork-pipeline.integration.test.js
git commit -m "test(artwork): end-to-end stubbed pipeline integration

Verifies lyrics → vars → prompt → Flux call (stubbed) → JPEG write path
end-to-end with no network calls. Uses the mothers_day lyrics fixture.

Co-authored by Ambrose Obimma"
```

---

## Task 11: iOS BlurBackdropArtwork SwiftUI component

Reusable view: places a square artwork in front of a blurred-and-dimmed copy of itself, fills any container aspect. Used by Reveal first; potentially by other surfaces later.

**Files:**

- Create: `PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift`

- [ ] **Step 1: Implement the component**

```swift
// PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift
import SwiftUI

/// Square artwork composed in front of a blurred-and-dimmed copy of itself.
/// Fills any container aspect (portrait, landscape, square) without cropping
/// the foreground subject; the backdrop fills the remaining space with mood.
///
/// Matches the spec for the song-Reveal surface (§9.1) and is reusable wherever
/// a square artwork needs to fill a non-square container without losing detail.
struct BlurBackdropArtwork: View {
    /// URL of the canonical 2048² square artwork JPEG.
    let artworkURL: URL?
    /// Padding around the foreground artwork inside its container.
    var foregroundHorizontalPadding: CGFloat = 24
    /// Bottom inset for the foreground (leaves room for title text overlay).
    var foregroundBottomPadding: CGFloat = 200
    /// Blur radius applied to the backdrop layer.
    var backdropBlurRadius: CGFloat = 50
    /// Opacity of the black dim layer over the blurred backdrop.
    var backdropDimOpacity: Double = 0.30

    var body: some View {
        ZStack {
            // Layer 1 — Backdrop: blurred, dimmed copy filling the container.
            AsyncImage(url: artworkURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .blur(radius: backdropBlurRadius)
                        .overlay(Color.black.opacity(backdropDimOpacity))
                        .ignoresSafeArea()
                default:
                    Color.black.ignoresSafeArea()
                }
            }

            // Layer 2 — Foreground: unmodified square artwork.
            AsyncImage(url: artworkURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .padding(.horizontal, foregroundHorizontalPadding)
                        .padding(.bottom, foregroundBottomPadding)
                case .empty:
                    ProgressView()
                case .failure:
                    EmptyView()
                @unknown default:
                    EmptyView()
                }
            }
        }
    }
}

#Preview {
    BlurBackdropArtwork(
        artworkURL: URL(string: "https://example.com/sample-bouquet.jpg")
    )
}
```

- [ ] **Step 2: Build the iOS target to verify it compiles**

Run from `/Users/ao/Documents/projects/porizo`:

```bash
xcodebuild \
  -project PorizoApp/PorizoApp.xcodeproj \
  -scheme PorizoApp \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  build -allowProvisioningUpdates 2>&1 | tail -30
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift
git commit -m "feat(ios): BlurBackdropArtwork SwiftUI component

Square artwork in front of a blurred+dimmed copy of itself, filling any
container without cropping the foreground subject. Used by RevealBloomView
in Task 12; reusable wherever a square asset must fill a non-square frame.

Co-authored by Ambrose Obimma"
```

---

## Task 12: Adopt BlurBackdropArtwork in RevealBloomView

Replace the current artwork rendering in `RevealBloomView.swift` with the new component + a title text overlay layer.

**Files:**

- Modify: `PorizoApp/PorizoApp/Flows/RevealBloomView.swift`

- [ ] **Step 1: Read the current view to find the artwork-rendering region**

```bash
grep -n "artwork\|AsyncImage\|Image(" PorizoApp/PorizoApp/Flows/RevealBloomView.swift | head -20
```

- [ ] **Step 2: Replace the artwork-rendering region with BlurBackdropArtwork + overlay**

In `RevealBloomView`, locate the existing artwork rendering block (likely an `AsyncImage` or `Image` wrapped in a `ZStack`/`GeometryReader`). Replace with:

```swift
// Where `artworkURL: URL?`, `recipientName: String`, `occasionLabel: String`,
// `senderFirstName: String` are already available in this view's scope:
ZStack {
    BlurBackdropArtwork(artworkURL: artworkURL)

    VStack {
        Spacer()
        LinearGradient(
            colors: [.clear, .black.opacity(0.65)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 240)
        .overlay(alignment: .bottom) {
            VStack(spacing: 6) {
                Text("For \(recipientName)")
                    .font(.system(size: 32, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)
                Text("\(occasionLabel) Song · by \(senderFirstName)")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.bottom, 48)
        }
    }
    .ignoresSafeArea(edges: .bottom)
}
```

The exact placement depends on the existing view structure. Keep any animation or transition modifiers wrapping the previous artwork view by applying them to the outer `ZStack`. Remove any direct calls to the old `compositeArtworkWithText` text path (artwork is now text-free at gen time).

- [ ] **Step 3: Build and visually verify in the simulator**

```bash
xcodebuild \
  -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  build -allowProvisioningUpdates 2>&1 | tail -10
```

Then launch with the bypass-auth flag (per the global preference):

```bash
xcrun simctl boot 'iPhone 16 Pro' 2>/dev/null
xcrun simctl install booted /Users/ao/Library/Developer/Xcode/DerivedData/PorizoApp-*/Build/Products/Debug-iphonesimulator/PorizoApp.app
xcrun simctl launch booted co.porizo.app --bypass-auth
```

Manually navigate to a song reveal and confirm:

- Blurred backdrop fills the portrait container (no letterbox bars)
- Square artwork is centered with breathing room left/right
- Title text overlays read with high contrast on the bottom scrim

- [ ] **Step 4: Commit**

```bash
git add PorizoApp/PorizoApp/Flows/RevealBloomView.swift
git commit -m "feat(ios): adopt BlurBackdropArtwork on song reveal

Replaces the previous artwork rendering with the new component + a
gradient-scrim title overlay. Removes baked-in text dependency since the
new pipeline produces text-free canonical assets.

Co-authored by Ambrose Obimma"
```

---

## Task 13: Confirm artwork URL flows correctly to NowPlaying and SharePostcardView

These surfaces don't change semantically, but the URL they consume now points to the new square JPEG. Verify the wiring is intact.

**Files:**

- Read-only: `PorizoApp/PorizoApp/NowPlayingView.swift`
- Read-only: `PorizoApp/PorizoApp/Services/NowPlayingManager.swift`
- Read-only: `PorizoApp/PorizoApp/Components/SongCoverView.swift`
- Read-only: `PorizoApp/PorizoApp/Flows/SharePostcardView.swift`

- [ ] **Step 1: Grep for the artwork URL property in each consumer**

```bash
for f in \
  PorizoApp/PorizoApp/NowPlayingView.swift \
  PorizoApp/PorizoApp/Services/NowPlayingManager.swift \
  PorizoApp/PorizoApp/Components/SongCoverView.swift \
  PorizoApp/PorizoApp/Flows/SharePostcardView.swift
do
  echo "=== $f ==="
  grep -n "artworkURL\|artwork_url\|artworkUrl\|MPNowPlayingInfoPropertyArtwork" "$f" || echo "  (no matches)"
done
```

- [ ] **Step 2: For each consumer, confirm one of the following**

- ✓ NowPlayingManager — sets `MPNowPlayingInfoPropertyArtwork` from `track.artworkURL`. No change required unless this is missing.
- ✓ SongCoverView — uses `AsyncImage(url:)`. No change required.
- ✓ SharePostcardView — calls into a share-asset endpoint. Confirm the endpoint will still produce a portrait composite at export time. This means the backend's `compositeArtworkWithText` is invoked from a _share endpoint_ rather than from `generateSongArtwork`. If the share endpoint doesn't exist yet, file a follow-up issue — DO NOT add it here; share UX is a separate change.

If any consumer is missing the artwork URL wiring, add the property and pass it through. Otherwise, no code change.

- [ ] **Step 3: Commit any wiring changes (skip if none)**

```bash
git add PorizoApp/PorizoApp/ 2>/dev/null && git diff --cached --quiet || git commit -m "chore(ios): confirm artwork URL flows to NowPlaying / SongCoverView / SharePostcardView

Co-authored by Ambrose Obimma"
```

---

## Task 14: Free-tier library v2 bootstrap script

Generates 5 photoreal Flux variants × 15 occasions = 75 images. One-time run; manual eyeball QA before commit.

**Files:**

- Create: `scripts/build-artwork-library-v2.mjs`
- Create: `scripts/build-artwork-library-v2.README.md`

- [ ] **Step 1: Write the bootstrap script**

```js
// scripts/build-artwork-library-v2.mjs
#!/usr/bin/env node
/**
 * Generate the free-tier photoreal botanical library v2.
 *
 * For each of 15 occasions, generate 5 Flux variants using rotated slot
 * values, writing each image to:
 *   storage/artwork-library/v2/{occasion}/{n}.jpg   (n = 0..4)
 *
 * Cost: ~$4.50 (75 * $0.06).
 *
 * Usage:
 *   REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs
 *   REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs --occasions mothers_day,birthday
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Plain require()-equivalent via dynamic import — keeps the script ESM but
// reuses the CommonJS modules under src/.
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const flux = require(path.join(repoRoot, "src/services/image-providers/flux-image"));
const { assemblePrompt, assembleNegativePrompt } = require(path.join(repoRoot, "src/services/artwork-prompts"));
const {
  OCCASIONS, SPECIES_BY_OCCASION, getDefault, LIGHTING, PALETTE, IMPERFECTION,
} = require(path.join(repoRoot, "src/services/artwork-vocab"));

const LIBRARY_ROOT = path.join(repoRoot, "storage/artwork-library/v2");
const VARIANTS_PER_OCCASION = 5;

function pickVariantVars(occasion, variantIndex) {
  const defaults = getDefault(occasion);
  const species = SPECIES_BY_OCCASION[occasion];
  const lightingKeys = Object.keys(LIGHTING);
  const paletteKeys = Object.keys(PALETTE);

  // Rotate slots to maximize visual diversity across the 5 variants.
  return {
    species: species[variantIndex % species.length],
    lighting: lightingKeys[variantIndex % lightingKeys.length],
    palette: paletteKeys[variantIndex % paletteKeys.length],
    density: defaults.density,
    imperfection: IMPERFECTION[variantIndex % IMPERFECTION.length],
    backdrop: defaults.backdrop,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const occasionsArg = args.find((a) => a.startsWith("--occasions"));
  const occasions = occasionsArg
    ? occasionsArg.split("=")[1].split(",")
    : OCCASIONS;

  fs.mkdirSync(LIBRARY_ROOT, { recursive: true });

  for (const occasion of occasions) {
    const dir = path.join(LIBRARY_ROOT, occasion);
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < VARIANTS_PER_OCCASION; n++) {
      const outPath = path.join(dir, `${n}.jpg`);
      if (fs.existsSync(outPath)) {
        console.log(`[skip] ${occasion}/${n}.jpg already exists`);
        continue;
      }
      const vars = pickVariantVars(occasion, n);
      const prompt = assemblePrompt({ occasion, vars });
      const neg = assembleNegativePrompt();
      console.log(`[gen ] ${occasion}/${n}.jpg ← species=${vars.species} lighting=${vars.lighting} palette=${vars.palette}`);
      try {
        const buf = await flux.generate({ prompt, negativePrompt: neg });
        fs.writeFileSync(outPath, buf);
        console.log(`[ok  ] ${occasion}/${n}.jpg (${buf.length} bytes)`);
      } catch (err) {
        console.error(`[err ] ${occasion}/${n}.jpg failed: ${err.message}`);
        // continue; let the operator re-run with --occasions to retry
      }
    }
  }
  console.log(`Done. Library at ${LIBRARY_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the README**

````markdown
# build-artwork-library-v2

One-time script to generate the free-tier photoreal botanical library.

## Run

```bash
REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs
```
````

Generates 5 variants × 15 occasions = 75 images at
`storage/artwork-library/v2/{occasion}/{n}.jpg`. Cost: ~$4.50.

## Re-roll specific occasions

```bash
REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs \
  --occasions=mothers_day,bereavement
```

Existing files are skipped — to re-roll, delete the file first.

## QA pass

After the run, open each file and apply the "is this AI?" test:

- If you can tell it's AI in under a second, delete the file and re-roll.
- If a variant has uncanny petals / impossible shadows, delete + re-roll.

Commit the directory only after every image passes.

````

- [ ] **Step 3: Verify script syntax (don't actually run it yet — that costs real money)**

```bash
node --check scripts/build-artwork-library-v2.mjs
````

Expected: no output (syntax valid).

- [ ] **Step 4: Commit the script (NOT the generated images)**

```bash
git add scripts/build-artwork-library-v2.mjs scripts/build-artwork-library-v2.README.md
git commit -m "feat(artwork): library v2 bootstrap script

Generates 5 photoreal Flux variants per occasion (75 total) at
storage/artwork-library/v2/{occasion}/{n}.jpg. One-time ~$4.50.

Co-authored by Ambrose Obimma"
```

- [ ] **Step 5: Operator step — run the script and commit the images**

This step is run by the operator, NOT the implementation agent. After running:

```bash
REPLICATE_API_TOKEN=$REPLICATE_API_TOKEN node scripts/build-artwork-library-v2.mjs
# Manual QA pass — delete and re-roll any AI-looking output
git add storage/artwork-library/v2/
git commit -m "chore(artwork): commit photoreal library v2 (75 hand-QA'd images)

Co-authored by Ambrose Obimma"
```

---

## Task 15: Feature flag rollout (ARTWORK_V2_ENABLED)

Adds a flag check so V2 can be toggled per-environment without code deploy. Default off; flip on for paid first, then free.

**Files:**

- Modify: `src/services/song-artwork.js`
- Modify: `test/services/song-artwork.test.js`

- [ ] **Step 1: Write the failing test**

```js
// Appended to test/services/song-artwork.test.js
test("generateSongArtwork respects ARTWORK_V2_ENABLED flag — disabled means library fallback for paid too", async () => {
  process.env.ARTWORK_V2_ENABLED = "false";
  try {
    const result = await generateSongArtwork({
      userId: "u-flag",
      trackId: "t-flag",
      occasion: "birthday",
      recipientName: "X",
      tier: "plus",
      artworkVars: {
        ...require("../../src/services/artwork-vocab").getDefault("birthday"),
        picked_by: "x",
        picked_at: "now",
      },
      dependencies: {
        providerFactory: () => {
          throw new Error("must not call provider when flag off");
        },
        prepareGeneratedImageFn: async (b) => b,
        compositeFn: async ({ baseImagePath }) => baseImagePath,
        libraryPathFn: (occ, n) => `/tmp/lib-${occ}-${n}.jpg`,
      },
    });
    assert.equal(result.source, "library");
  } finally {
    delete process.env.ARTWORK_V2_ENABLED;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/services/song-artwork.test.js`
Expected: FAIL — provider factory was called.

- [ ] **Step 3: Modify song-artwork.js to honor the flag**

Inside `generateSongArtwork`, immediately after `const isPaid = …`, add:

```js
const v2Enabled =
  String(process.env.ARTWORK_V2_ENABLED || "true").toLowerCase() !== "false";
const useGenerator = isPaid && v2Enabled;

// then below — replace `if (isPaid) {` with `if (useGenerator) {`.
```

Update the no-generator branch source label from `library` to `library` (no change) but ensure it picks from v2 library (already does — `libraryPath` writes to `v2/`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/services/song-artwork.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/song-artwork.js test/services/song-artwork.test.js
git commit -m "feat(artwork): ARTWORK_V2_ENABLED feature flag

Default 'true' in prod; set to 'false' to force the library path even for
paid users. Used during canary rollout (paid first, then free) and as an
operator kill-switch if Flux quality degrades.

Co-authored by Ambrose Obimma"
```

---

## Task 16: Manual QA gate — generate one Flux image per occasion via the real pipeline

Operator step. Validates the prompt template against every occasion's defaults before flipping production.

- [ ] **Step 1: Bootstrap the library** (Task 14 step 5 produces these as a side effect)

If Task 14's `--occasions` re-roll cycle leaves the library v2 in place, you already have one image per occasion. Otherwise:

```bash
REPLICATE_API_TOKEN=$REPLICATE_API_TOKEN node scripts/build-artwork-library-v2.mjs \
  --occasions=birthday,mothers_day,anniversary,thank_you,i_love_you,wedding,graduation,celebration,apology,encouragement,advice,bereavement,friendship,get_well,custom
```

- [ ] **Step 2: Eyeball each occasion's first variant**

For each occasion, open `storage/artwork-library/v2/{occasion}/0.jpg` and apply the test:

- Can you tell this is AI in under one second?
- Yes → re-roll that occasion's variants; tune the prompt template if a structural issue is visible across multiple re-rolls.
- No → mark approved.

Track results in a quick markdown file `docs/superpowers/specs/2026-05-18-artwork-qa-log.md`:

```markdown
# Artwork V2 QA — 2026-XX-XX

| Occasion    | Pass | Notes                                |
| ----------- | ---- | ------------------------------------ |
| birthday    | ✓    |                                      |
| mothers_day | ✓    |                                      |
| anniversary | ✗    | Branches look fake; re-rolled, now ✓ |

…
```

- [ ] **Step 3: Commit the QA log**

```bash
git add docs/superpowers/specs/2026-05-18-artwork-qa-log.md
git commit -m "docs(artwork): manual QA log for v2 library

Co-authored by Ambrose Obimma"
```

- [ ] **Step 4: Production cutover (Railway env)**

```bash
railway variables set IMAGE_PROVIDER=flux ARTWORK_V2_ENABLED=true
railway up
```

- [ ] **Step 5: Monitor for 48h then flip the free tier**

The library is already in place; free users now hit `library/v2/` paths automatically once the library files are committed. No additional env flip is needed; the free path consumed `v1/` only when the flag was off + the path was hardcoded — Task 7 already updated the path to `v2/`.

After 48h of clean telemetry:

- Flux failure rate < 5% / hour ✓
- Haiku invalid-slot rate < 2% / hour ✓
- Moderation refusals < 1% / day ✓

Begin Phase 4 cleanup as a separate plan (drop `track_versions.style` column, remove v1 library files).

---

## Self-Review

**1. Spec coverage:**

| Spec section                  | Plan coverage                                                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Problem                    | Implicit — addressed by full plan                                                                                                                                                                                                                                |
| §2 Goal                       | Implicit — addressed by full plan                                                                                                                                                                                                                                |
| §3 Non-goals                  | Plan does not touch multi-aspect, historical backfill, or new providers ✓                                                                                                                                                                                        |
| §4 Art direction principles   | Tasks 2 (vocab — color realism, single subject), 3 (prompt template — imperfection, camera language), 5 (Flux as the photoreal provider), 7 (no styles), 8 (lyrics-aware via Task 4)                                                                             |
| §5 Prompt template            | Task 3                                                                                                                                                                                                                                                           |
| §6 Slot vocabulary            | Task 2 (full vocabulary), Task 4 (extractor menus), Task 9 (lyrics fixtures)                                                                                                                                                                                     |
| §7 Provider configuration     | Tasks 5, 6, 7                                                                                                                                                                                                                                                    |
| §7.1 Fallback chain           | Task 7 `tryProviderChain`                                                                                                                                                                                                                                        |
| §8 Variety strategy           | Task 7 (paid per-track), Task 14 (free library v2 bootstrap)                                                                                                                                                                                                     |
| §9 Asset shape                | Task 7 (2048², runtime overlay), Task 11 (BlurBackdropArtwork), Task 12 (Reveal), Task 13 (NP/Cover/Share confirmation)                                                                                                                                          |
| §10 Workflow changes          | Task 8 (artwork-job orchestrates extractor + generator); the R1.5 step is implemented inside the artwork-job since artwork already runs in parallel with audio via the barrier in `src/workflows/artwork-barrier.js`, not as a serial step in the audio pipeline |
| §11 DB schema                 | Task 1                                                                                                                                                                                                                                                           |
| §12 Migration & rollout       | Tasks 15 (flag), 16 (QA + cutover)                                                                                                                                                                                                                               |
| §13 Failure modes / telemetry | Task 4 (extractor fallbacks), Task 7 (provider chain logging) — operator must add a metrics dashboard separately                                                                                                                                                 |
| §14 Testing                   | Tests in every implementation task + Task 10 integration test                                                                                                                                                                                                    |
| §15 Open questions            | Out of scope (Phase 2)                                                                                                                                                                                                                                           |
| §16 Files touched             | Plan matches inventory; one addition (`BlurBackdropArtwork.swift`) was added to keep the iOS Reveal change clean                                                                                                                                                 |

**2. Placeholder scan:** No "TBD", no "implement later", no "add appropriate error handling" without showing how. The 15 lyrics fixtures are written verbatim. Migration SQL is fully shown. Every test has concrete assertions.

**3. Type consistency:**

- `artwork_vars_json` (DB column) consistently lowercase-snake; `artworkVars` in JS code.
- `PROMPT_TEMPLATE_VERSION` constant name matches export + test reference + DB column purpose.
- `extractArtworkVars` named consistently across extractor module, integration test, artwork-job consumer.
- `BlurBackdropArtwork` named consistently across Task 11 (definition) and Task 12 (consumer).
- `pickLibraryVariant` replaces `pickStyleVariant` — old name does not appear anywhere in tests or other tasks after Task 7.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-artwork-generator-redesign.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is a clean unit with its own tests; ideal for the per-task review cycle.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
