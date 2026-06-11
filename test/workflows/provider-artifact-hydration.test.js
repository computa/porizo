const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  _testing: { hydrateProviderCompleteAudio },
} = require("../../src/workflows/runner");

test("hydrateProviderCompleteAudio uses durable storage key before temporary provider URL", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-provider-hydrate-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const localPath = path.join(tmpDir, "suno_complete.mp3");
  const calls = [];
  const result = await hydrateProviderCompleteAudio({
    providerLocalPath: localPath,
    providerAudioKey: "tracks/user_1/track_1/v2/provider/suno-preview.mp3",
    providerAudioUrl: "https://cdn.example.com/temporary.mp3",
    storageProvider: {
      downloadToFile: async ({ key, filePath }) => {
        calls.push({ key, filePath });
        fs.writeFileSync(filePath, "mirrored-audio");
      },
    },
    httpDownloadToFile: async () => {
      throw new Error("temporary provider URL should not be used");
    },
  });

  assert.equal(result.source, "storage");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].key,
    "tracks/user_1/track_1/v2/provider/suno-preview.mp3",
  );
  assert.equal(fs.readFileSync(localPath, "utf8"), "mirrored-audio");
});
