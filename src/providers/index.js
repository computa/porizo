const PROVIDER_REGISTRY = Object.freeze({
  suno: Object.freeze({
    name: "suno",
    displayName: "Suno",
    capabilities: Object.freeze({
      musicGeneration: true,
      providerCompleteAudio: true,
      textToSpeech: false,
      voiceConversion: false,
      speechToText: false,
      stemSeparation: false,
    }),
    musicRoutingOrder: 0,
  }),
  elevenlabs: Object.freeze({
    name: "elevenlabs",
    displayName: "ElevenLabs",
    capabilities: Object.freeze({
      musicGeneration: false,
      providerCompleteAudio: false,
      textToSpeech: true,
      voiceConversion: true,
      speechToText: false,
      stemSeparation: false,
    }),
  }),
  replicate: Object.freeze({
    name: "replicate",
    displayName: "Replicate",
    capabilities: Object.freeze({
      musicGeneration: false,
      providerCompleteAudio: false,
      textToSpeech: false,
      voiceConversion: true,
      speechToText: false,
      stemSeparation: true,
    }),
  }),
  seedvc: Object.freeze({
    name: "seedvc",
    displayName: "Seed-VC",
    capabilities: Object.freeze({
      musicGeneration: false,
      providerCompleteAudio: false,
      textToSpeech: false,
      voiceConversion: true,
      speechToText: false,
      stemSeparation: false,
    }),
  }),
  whisper: Object.freeze({
    name: "whisper",
    displayName: "Whisper",
    capabilities: Object.freeze({
      musicGeneration: false,
      providerCompleteAudio: false,
      textToSpeech: false,
      voiceConversion: false,
      speechToText: true,
      stemSeparation: false,
    }),
  }),
});

function getProvider(name) {
  if (!name || typeof name !== "string") {
    return null;
  }
  return PROVIDER_REGISTRY[name.toLowerCase().trim()] || null;
}

function hasProviderCapability(name, capability) {
  const provider = getProvider(name);
  return Boolean(provider?.capabilities?.[capability]);
}

function listProviders({ capability } = {}) {
  return Object.values(PROVIDER_REGISTRY)
    .filter((provider) =>
      capability ? Boolean(provider.capabilities?.[capability]) : true,
    )
    .sort((a, b) => {
      const aOrder = Number.isInteger(a.musicRoutingOrder)
        ? a.musicRoutingOrder
        : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isInteger(b.musicRoutingOrder)
        ? b.musicRoutingOrder
        : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.name.localeCompare(b.name);
    });
}

function listProviderNames({ capability } = {}) {
  return listProviders({ capability }).map((provider) => provider.name);
}

const MUSIC_PROVIDER_ORDER = Object.freeze(
  listProviderNames({ capability: "musicGeneration" }),
);

module.exports = {
  getProvider,
  hasProviderCapability,
  listProviderNames,
  listProviders,
  MUSIC_PROVIDER_ORDER,
  PROVIDER_REGISTRY,
};
