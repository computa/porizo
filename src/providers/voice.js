const path = require("path");
const { convertVoice: replicateConvert } = require("./replicate");
const { writeWav } = require("../utils/audio");

async function convertVoice({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  inputUrl,
  similarityStrength,
}) {
  if (providerConfig?.live) {
    return replicateConvert({
      baseUrl: providerConfig.baseUrl,
      token: providerConfig.token,
      modelVersion: providerConfig.modelVersion,
      storageDir,
      track,
      trackVersion,
      inputUrl,
      timeoutMs: providerConfig.timeoutMs,
      kind,
      similarityStrength,
    });
  }

  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "user_vocal.wav" : "user_vocal_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 4 : 10,
    frequencyHz: 330,
  });
  return { file: fileName };
}

module.exports = {
  convertVoice,
};
