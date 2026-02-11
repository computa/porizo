const SUPPORT_LEVELS = Object.freeze({
  strong: 4,
  medium: 3,
  weak: 2,
  unknown: 1,
  unsupported: 0,
});

const STYLE_ALIASES = Object.freeze({
  afrobeat: "afrobeats",
  "bossa nova": "bossa_nova",
  "bossa-nova": "bossa_nova",
  "latin pop": "latin_pop",
  "latin-pop": "latin_pop",
  randb: "rnb",
  "r&b": "rnb",
  "r and b": "rnb",
});

// Provider-specific style fidelity hints. This can be expanded over time
// without changing routing logic.
const STYLE_PROVIDER_CAPABILITIES = Object.freeze({
  ogene: Object.freeze({
    suno: Object.freeze({
      support: "weak",
      instruction_override:
        "Nigerian Ogene traditional ensemble with metallic bell ostinato, slit-drum pulse, communal call-and-response chant phrasing, and sparse harmonic bed.",
      negative_constraints: Object.freeze([
        "avoid glossy afropop synth stacks",
        "avoid highlife guitar-led lead phrasing",
        "avoid dembow/reggaeton rhythm",
      ]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      instruction_override:
        "Nigerian Ogene traditional ensemble, metallic bell and slit-drum call patterns, festival procession groove, chant-like hook responses.",
      negative_constraints: Object.freeze([
        "avoid trap hi-hat programming",
        "avoid EDM risers",
      ]),
    }),
  }),
  juju: Object.freeze({
    suno: Object.freeze({
      support: "weak",
      instruction_override:
        "Juju-inspired guitar-led groove with layered hand percussion and celebratory Yoruba dance feel.",
      negative_constraints: Object.freeze([
        "avoid afrobeats kick-snare bounce as the core groove",
      ]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      instruction_override:
        "Juju guitar interlocking lines, rolling percussion, and celebratory dance cadence.",
      negative_constraints: Object.freeze([]),
    }),
  }),
  fuji: Object.freeze({
    suno: Object.freeze({
      support: "weak",
      instruction_override:
        "Fuji-inspired talking drum drive, polyrhythmic percussion layers, energetic chant cadence.",
      negative_constraints: Object.freeze([
        "avoid pop four-on-the-floor beat",
      ]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      instruction_override:
        "Fuji-inspired talking drum rhythm and dense percussive momentum with chant phrasing.",
      negative_constraints: Object.freeze([]),
    }),
  }),
  highlife: Object.freeze({
    suno: Object.freeze({
      support: "medium",
      instruction_override:
        "West African highlife guitar motifs, buoyant rhythm, and celebratory melodic movement.",
      negative_constraints: Object.freeze([]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      instruction_override:
        "West African highlife groove with bright guitar figures and uplifting dance feel.",
      negative_constraints: Object.freeze([]),
    }),
  }),
});

function normalizeProvider(provider) {
  if (!provider || typeof provider !== "string") {
    return null;
  }
  const normalized = provider.toLowerCase().trim();
  return normalized === "elevenlabs" || normalized === "suno" ? normalized : null;
}

function normalizeStyle(style) {
  if (!style || typeof style !== "string") {
    return null;
  }
  const normalized = style
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return STYLE_ALIASES[normalized] || normalized;
}

function normalizeSupportLevel(value) {
  if (!value || typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.toLowerCase().trim();
  return SUPPORT_LEVELS[normalized] !== undefined ? normalized : "unknown";
}

function getSupportScore(level) {
  const normalized = normalizeSupportLevel(level);
  return SUPPORT_LEVELS[normalized];
}

function getProviderStyleCapability({ style, provider }) {
  const normalizedStyle = normalizeStyle(style);
  const normalizedProvider = normalizeProvider(provider);

  if (!normalizedStyle || !normalizedProvider) {
    return {
      style: normalizedStyle,
      provider: normalizedProvider,
      support: "unknown",
      support_score: SUPPORT_LEVELS.unknown,
      instruction_override: null,
      negative_constraints: [],
    };
  }

  const styleConfig = STYLE_PROVIDER_CAPABILITIES[normalizedStyle];
  const providerConfig = styleConfig ? styleConfig[normalizedProvider] : null;
  const support = normalizeSupportLevel(providerConfig?.support);

  return {
    style: normalizedStyle,
    provider: normalizedProvider,
    support,
    support_score: SUPPORT_LEVELS[support],
    instruction_override: providerConfig?.instruction_override || null,
    negative_constraints: Array.isArray(providerConfig?.negative_constraints)
      ? providerConfig.negative_constraints
      : [],
  };
}

module.exports = {
  SUPPORT_LEVELS,
  STYLE_PROVIDER_CAPABILITIES,
  normalizeStyle,
  normalizeProvider,
  normalizeSupportLevel,
  getSupportScore,
  getProviderStyleCapability,
};
