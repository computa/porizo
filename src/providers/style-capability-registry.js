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
      genre_core: "Traditional Nigerian Ogene festival ensemble",
      rhythmic_signature: "Interlocking metallic bell ostinato with slit-drum pulse",
      instrument_palette: Object.freeze([
        "ogene bells",
        "slit drum",
        "talking drum",
        "supporting hand percussion",
      ]),
      arrangement_notes:
        "Start with sparse bell pulse, build communal call-and-response energy, preserve percussive center.",
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
      genre_core: "Traditional Nigerian Ogene-inspired ceremonial groove",
      rhythmic_signature: "Fast metallic bell and slit-drum motif with chant-ready cadence",
      instrument_palette: Object.freeze([
        "ogene bells",
        "slit drum",
        "festival percussion",
        "subtle bass support",
      ]),
      arrangement_notes:
        "Prioritize percussion-first arrangement, short chant-like hook motifs, and procession-style momentum.",
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
      genre_core: "Yoruba Juju dance band feel",
      rhythmic_signature: "Rolling groove with interlocking guitar ostinatos and hand percussion",
      instrument_palette: Object.freeze([
        "talking drum",
        "rhythm guitar",
        "shekere",
        "bass guitar",
      ]),
      arrangement_notes:
        "Keep guitars interlocked and dance-forward with subtle call-response phrasing.",
      instruction_override:
        "Juju-inspired guitar-led groove with layered hand percussion and celebratory Yoruba dance feel.",
      negative_constraints: Object.freeze([
        "avoid afrobeats kick-snare bounce as the core groove",
      ]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      genre_core: "Juju guitar-led celebration groove",
      rhythmic_signature: "Syncopated guitar lattice with festive percussion bed",
      instrument_palette: Object.freeze([
        "lead guitar",
        "rhythm guitar",
        "hand percussion",
        "dance bassline",
      ]),
      arrangement_notes:
        "Lean into layered guitar hooks, syncopated dance rhythm, and festive band feel.",
      instruction_override:
        "Juju guitar interlocking lines, rolling percussion, and celebratory dance cadence.",
      negative_constraints: Object.freeze([]),
    }),
  }),
  fuji: Object.freeze({
    suno: Object.freeze({
      support: "weak",
      genre_core: "Fuji percussive street-band energy",
      rhythmic_signature: "Dense polyrhythms led by talking drum and call cadence",
      instrument_palette: Object.freeze([
        "talking drum",
        "conga family percussion",
        "hand claps",
        "support bass",
      ]),
      arrangement_notes:
        "Build relentless rhythmic momentum with dynamic breaks and chant-ready pocket.",
      instruction_override:
        "Fuji-inspired talking drum drive, polyrhythmic percussion layers, energetic chant cadence.",
      negative_constraints: Object.freeze([
        "avoid pop four-on-the-floor beat",
      ]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      genre_core: "Fuji-inspired percussion-driven arrangement",
      rhythmic_signature: "Forward-moving talking drum pulse with dense auxiliary percussion",
      instrument_palette: Object.freeze([
        "talking drum",
        "frame drum",
        "aux percussion",
        "support bassline",
      ]),
      arrangement_notes:
        "Keep percussive forefront, avoid over-harmonic arrangement, emphasize chant cadence.",
      instruction_override:
        "Fuji-inspired talking drum rhythm and dense percussive momentum with chant phrasing.",
      negative_constraints: Object.freeze([]),
    }),
  }),
  highlife: Object.freeze({
    suno: Object.freeze({
      support: "medium",
      genre_core: "West African Highlife dance band",
      rhythmic_signature: "Buoyant guitar-led groove with bright melodic swing",
      instrument_palette: Object.freeze([
        "highlife guitar",
        "horn section",
        "hand percussion",
        "walking bass",
      ]),
      arrangement_notes:
        "Use bright guitar motifs, celebratory brass stabs, and uplifting dance motion.",
      instruction_override:
        "West African highlife guitar motifs, buoyant rhythm, and celebratory melodic movement.",
      negative_constraints: Object.freeze([]),
    }),
    elevenlabs: Object.freeze({
      support: "medium",
      genre_core: "Highlife-inspired guitar and brass celebration",
      rhythmic_signature: "Lively dance pulse with guitar arpeggios and syncopated groove",
      instrument_palette: Object.freeze([
        "clean guitar",
        "brass accents",
        "percussion",
        "bass groove",
      ]),
      arrangement_notes:
        "Keep melodic optimism and danceable pulse with rhythmic guitar foreground.",
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

function normalizeString(value, maxLength = 400) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function normalizeStringArray(values, { maxItems = 8, maxLength = 160 } = {}) {
  if (!Array.isArray(values)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeString(value, maxLength);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function sanitizeProviderOverride(rawOverride) {
  if (!rawOverride || typeof rawOverride !== "object") {
    return null;
  }

  const support = normalizeSupportLevel(rawOverride.support);
  const instructionOverride = normalizeString(rawOverride.instruction_override, 500);
  const genreCore = normalizeString(rawOverride.genre_core, 300);
  const rhythmicSignature = normalizeString(rawOverride.rhythmic_signature, 300);
  const arrangementNotes = normalizeString(rawOverride.arrangement_notes, 500);
  const instrumentPalette = normalizeStringArray(rawOverride.instrument_palette, {
    maxItems: 10,
    maxLength: 120,
  });
  const negativeConstraints = normalizeStringArray(rawOverride.negative_constraints, {
    maxItems: 10,
    maxLength: 180,
  });

  return {
    support,
    instruction_override: instructionOverride,
    genre_core: genreCore,
    rhythmic_signature: rhythmicSignature,
    arrangement_notes: arrangementNotes,
    instrument_palette: instrumentPalette,
    negative_constraints: negativeConstraints,
  };
}

function sanitizeStyleOverrides(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object") {
    return {};
  }
  const sanitized = {};
  const styles = Object.entries(rawOverrides).slice(0, 50);

  for (const [styleKey, providers] of styles) {
    const normalizedStyle = normalizeStyle(styleKey);
    if (!normalizedStyle || !providers || typeof providers !== "object") {
      continue;
    }

    const providerEntries = Object.entries(providers).slice(0, 4);
    for (const [providerKey, override] of providerEntries) {
      const normalizedProvider = normalizeProvider(providerKey);
      if (!normalizedProvider) {
        continue;
      }
      const sanitizedOverride = sanitizeProviderOverride(override);
      if (!sanitizedOverride) {
        continue;
      }
      if (!sanitized[normalizedStyle]) {
        sanitized[normalizedStyle] = {};
      }
      sanitized[normalizedStyle][normalizedProvider] = sanitizedOverride;
    }
  }

  return sanitized;
}

function mergeStringArrays(left, right) {
  return normalizeStringArray([...(left || []), ...(right || [])], { maxItems: 12, maxLength: 180 });
}

function mergeCapability(baseCapability, overrideCapability) {
  if (!overrideCapability) {
    return baseCapability;
  }

  const mergedSupport = normalizeSupportLevel(
    overrideCapability.support && overrideCapability.support !== "unknown"
      ? overrideCapability.support
      : baseCapability.support
  );

  return {
    support: mergedSupport,
    instruction_override:
      overrideCapability.instruction_override || baseCapability.instruction_override || null,
    genre_core: overrideCapability.genre_core || baseCapability.genre_core || null,
    rhythmic_signature:
      overrideCapability.rhythmic_signature || baseCapability.rhythmic_signature || null,
    arrangement_notes: overrideCapability.arrangement_notes || baseCapability.arrangement_notes || null,
    instrument_palette: mergeStringArrays(
      baseCapability.instrument_palette,
      overrideCapability.instrument_palette
    ),
    negative_constraints: mergeStringArrays(
      baseCapability.negative_constraints,
      overrideCapability.negative_constraints
    ),
  };
}

function getSupportScore(level) {
  const normalized = normalizeSupportLevel(level);
  return SUPPORT_LEVELS[normalized];
}

function getProviderStyleCapability({ style, provider, styleOverrides = null }) {
  const normalizedStyle = normalizeStyle(style);
  const normalizedProvider = normalizeProvider(provider);
  const overrides = sanitizeStyleOverrides(styleOverrides);

  if (!normalizedStyle || !normalizedProvider) {
    return {
      style: normalizedStyle,
      provider: normalizedProvider,
      support: "unknown",
      support_score: SUPPORT_LEVELS.unknown,
      instruction_override: null,
      genre_core: null,
      rhythmic_signature: null,
      arrangement_notes: null,
      instrument_palette: [],
      negative_constraints: [],
    };
  }

  const styleConfig = STYLE_PROVIDER_CAPABILITIES[normalizedStyle];
  const providerConfig = styleConfig ? styleConfig[normalizedProvider] : null;
  const merged = mergeCapability(
    {
      support: normalizeSupportLevel(providerConfig?.support),
      instruction_override: providerConfig?.instruction_override || null,
      genre_core: providerConfig?.genre_core || null,
      rhythmic_signature: providerConfig?.rhythmic_signature || null,
      arrangement_notes: providerConfig?.arrangement_notes || null,
      instrument_palette: Array.isArray(providerConfig?.instrument_palette)
        ? providerConfig.instrument_palette
        : [],
      negative_constraints: Array.isArray(providerConfig?.negative_constraints)
        ? providerConfig.negative_constraints
        : [],
    },
    overrides?.[normalizedStyle]?.[normalizedProvider] || null
  );

  return {
    style: normalizedStyle,
    provider: normalizedProvider,
    support: merged.support,
    support_score: SUPPORT_LEVELS[merged.support],
    instruction_override: merged.instruction_override,
    genre_core: merged.genre_core,
    rhythmic_signature: merged.rhythmic_signature,
    arrangement_notes: merged.arrangement_notes,
    instrument_palette: merged.instrument_palette,
    negative_constraints: merged.negative_constraints,
  };
}

module.exports = {
  SUPPORT_LEVELS,
  STYLE_PROVIDER_CAPABILITIES,
  normalizeStyle,
  normalizeProvider,
  normalizeSupportLevel,
  sanitizeStyleOverrides,
  getSupportScore,
  getProviderStyleCapability,
};
