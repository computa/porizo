const assert = require("node:assert/strict");
const test = require("node:test");

const { trackProviderAudioKey } = require("../src/storage");

test("trackProviderAudioKey stores raw provider audio under the track version prefix", () => {
  assert.equal(
    trackProviderAudioKey({
      userId: "user_1",
      trackId: "track_1",
      versionNum: 2,
      provider: "Suno API",
      kind: "Full Render",
      format: ".MP3",
    }),
    "tracks/user_1/track_1/v2/provider/suno-api-full-render.mp3",
  );
});
