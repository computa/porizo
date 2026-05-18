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
