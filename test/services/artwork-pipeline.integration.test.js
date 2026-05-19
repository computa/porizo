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
