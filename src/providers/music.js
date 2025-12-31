const path = require("path");
const { generateMusic } = require("./elevenlabs");
const { generateMusicWithSuno } = require("./suno");
const { writeWav } = require("../utils/audio");

function buildMusicPlan({ style, durationTarget }) {
  return {
    bpm: 110,
    key: "C",
    duration_sec: durationTarget || 60,
    style: style || "pop",
    sections: [
      { name: "verse", bars: 8 },
      { name: "chorus", bars: 8 },
    ],
  };
}

function renderInstrumental({ storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "inst_preview.wav" : "inst_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 6 : 12,
    frequencyHz: 220,
  });
  return { file: fileName };
}

function renderGuideVocal({ storageDir, track, trackVersion, kind }) {
  const versionDir = path.join(
    storageDir,
    "tracks",
    track.user_id,
    track.id,
    `v${trackVersion.version_num}`
  );
  const fileName = kind === "preview" ? "guide_vocal.wav" : "guide_vocal_full.wav";
  writeWav(path.join(versionDir, fileName), {
    durationSec: kind === "preview" ? 4 : 10,
    frequencyHz: 440,
  });
  return { file: fileName };
}

async function renderWithProvider({
  storageDir,
  track,
  trackVersion,
  kind,
  providerConfig,
  lyrics,
  musicPlan,
}) {
  if (providerConfig?.live) {
    // Select provider based on config (defaults to elevenlabs)
    const provider = providerConfig.provider || "elevenlabs";

    if (provider === "suno") {
      console.log(`[Music] Using Suno provider for track ${track.id}`);
      return generateMusicWithSuno({
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        storageDir,
        track,
        trackVersion,
        lyrics,
        musicPlan,
        timeoutMs: providerConfig.timeoutMs,
        kind,
      });
    }

    // Default: ElevenLabs
    console.log(`[Music] Using ElevenLabs provider for track ${track.id}`);
    return generateMusic({
      baseUrl: providerConfig.baseUrl,
      endpoint: providerConfig.endpoint,
      apiKey: providerConfig.apiKey,
      storageDir,
      track,
      trackVersion,
      lyrics,
      musicPlan,
      voiceId: providerConfig.voiceId,
      timeoutMs: providerConfig.timeoutMs,
      kind,
    });
  }
  return {
    ...(renderInstrumental({ storageDir, track, trackVersion, kind }) || {}),
    ...(renderGuideVocal({ storageDir, track, trackVersion, kind }) || {}),
  };
}

module.exports = {
  buildMusicPlan,
  renderInstrumental,
  renderGuideVocal,
  renderWithProvider,
};
