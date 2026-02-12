/**
 * Canonical Style Registry — single source of truth for all music style definitions.
 *
 * Each style is defined once with ALL its properties:
 *   profile (bpmRange, keys, energy)
 *   prompt (natural language descriptor)
 *   blueprint (genre_core, instrument_palette, rhythmic_signature, arrangement_notes)
 *   provider capabilities (suno, elevenlabs — support level, overrides, constraints)
 *
 * Consolidates data previously split across music.js and style-capability-registry.js.
 */

const SUPPORT_LEVELS = Object.freeze({
  strong: 4,
  medium: 3,
  weak: 2,
  unknown: 1,
  unsupported: 0,
});

// ─── STYLES ──────────────────────────────────────────────────────────────────

const STYLES = {
  // ── Western Pop/Contemporary ───────────────────────────────────────────

  pop: {
    bpmRange: [100, 130],
    keys: ["C", "G", "D", "A"],
    energy: "medium",
    prompt: "modern pop production, bright hooks, punchy drums, radio-friendly structure",
    genre_core: "Modern radio-friendly pop production",
    instrument_palette: ["synth pad", "acoustic guitar", "piano", "punchy drums"],
    rhythmic_signature: "Four-on-the-floor kick with syncopated hi-hat groove",
    arrangement_notes: "Hook-forward with clear verse-chorus dynamics and polished mix",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  acoustic: {
    bpmRange: [80, 110],
    keys: ["G", "D", "C", "A"],
    energy: "low",
    prompt: "acoustic singer-songwriter feel, warm guitar strums, intimate live-room texture",
    genre_core: "Intimate singer-songwriter acoustic production",
    instrument_palette: ["acoustic guitar", "soft percussion", "upright bass", "piano"],
    rhythmic_signature: "Gentle fingerpick or strumming groove with brushed percussion",
    arrangement_notes: "Stripped-back arrangement with focus on vocal intimacy and guitar warmth",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  soul: {
    bpmRange: [60, 90],
    keys: ["Eb", "Ab", "Bb", "F"],
    energy: "medium",
    prompt: "classic soul groove, expressive vocals, warm bass, rich chord progressions",
    genre_core: "Classic soul with rich harmonic warmth",
    instrument_palette: ["electric piano", "warm bass", "brass section", "vintage drums"],
    rhythmic_signature: "Deep pocket groove with syncopated bass and backbeat snare",
    arrangement_notes: "Warm production with expressive dynamics and rich chord movement",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  folk: {
    bpmRange: [90, 120],
    keys: ["G", "D", "C", "A"],
    energy: "low",
    prompt: "organic folk instrumentation, storytelling tone, gentle percussion and strings",
    genre_core: "Organic folk storytelling with natural instrumentation",
    instrument_palette: ["acoustic guitar", "fiddle", "mandolin", "gentle percussion"],
    rhythmic_signature: "Simple strumming pulse with natural dynamics",
    arrangement_notes: "Storytelling-forward with builds through instrumentation layers",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  jazz: {
    bpmRange: [100, 140],
    keys: ["Bb", "F", "Eb", "Ab"],
    energy: "medium",
    prompt: "jazzy harmony, tasteful swing phrasing, brushed drums, upright-bass movement",
    genre_core: "Jazz ensemble with swing feel and harmonic sophistication",
    instrument_palette: ["piano", "upright bass", "brushed drums", "muted trumpet"],
    rhythmic_signature: "Swing feel with walking bass and ride cymbal",
    arrangement_notes: "Tasteful dynamics with space for melodic interplay and solo moments",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  rnb: {
    bpmRange: [65, 110],
    keys: ["Eb", "Ab", "Db", "Gb", "Bb"],
    energy: "medium",
    prompt: "R&B groove, silky vocals, lush pads, 808 bass, smooth syncopation",
    genre_core: "Classic R&B with lush harmonic textures and vocal-forward production",
    instrument_palette: ["synth pad", "808 bass", "smooth keys", "crisp snare", "finger snaps"],
    rhythmic_signature: "Laid-back groove with subtle syncopation and deep pocket bass",
    arrangement_notes: "Vocal-forward production with lush chords, dynamic bridges, and space for melodic expression",
    suno: {
      support: "strong",
      instruction_override: "R&B slow jam groove, silky vocal tone, lush synth pads, 808 bass, smooth snare pocket",
      negative_constraints: ["avoid rock guitar distortion", "avoid EDM drops"],
    },
    elevenlabs: {
      support: "strong",
      instruction_override: "R&B groove, silky vocals, lush pads, 808 bass, smooth syncopation",
      negative_constraints: [],
    },
  },

  rock: {
    bpmRange: [110, 140],
    keys: ["E", "A", "D", "G"],
    energy: "high",
    prompt: "driving rock rhythm section, electric guitars, energetic live-band feel",
    genre_core: "Driving rock with live-band energy",
    instrument_palette: ["electric guitar", "bass guitar", "drum kit", "power chords"],
    rhythmic_signature: "Driving eighth-note pulse with powerful backbeat",
    arrangement_notes: "High energy with dynamic builds and guitar-forward arrangement",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  country: {
    bpmRange: [90, 130],
    keys: ["G", "C", "D", "A"],
    energy: "medium",
    prompt: "country-pop blend, steady two-step groove, acoustic and electric twang",
    genre_core: "Country-pop with twang and storytelling warmth",
    instrument_palette: ["acoustic guitar", "pedal steel", "fiddle", "steady drums"],
    rhythmic_signature: "Two-step groove with train-beat snare pattern",
    arrangement_notes: "Storytelling arrangement with twang-forward instrumentation",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  ballad: {
    bpmRange: [60, 80],
    keys: ["C", "G", "F", "Am"],
    energy: "low",
    prompt: "slow emotional ballad, spacious arrangement, cinematic dynamics",
    genre_core: "Emotional ballad with cinematic sweep",
    instrument_palette: ["piano", "strings", "soft drums", "atmospheric synth"],
    rhythmic_signature: "Slow pulse with expressive rubato and dynamic swells",
    arrangement_notes: "Spacious arrangement building from intimate to cinematic climax",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  // ── African Styles ─────────────────────────────────────────────────────

  afrobeats: {
    bpmRange: [95, 115],
    keys: ["Eb", "Bb", "F", "Ab"],
    energy: "high",
    prompt: "Afrobeats bounce, syncopated percussion, danceable groove, vibrant modern production",
    genre_core: "Modern Afrobeats club-ready groove",
    instrument_palette: ["percussion stack", "log drum", "bass synth", "hook synth"],
    rhythmic_signature: "Syncopated kick-snare bounce with layered dance percussion",
    arrangement_notes: "Hook-forward arrangement with dynamic drops and polished contemporary mix energy",
    suno: {
      support: "medium",
      instruction_override: "Afrobeats dance groove with syncopated percussion, log drum patterns, and bass-driven hook energy",
      negative_constraints: ["avoid generic pop four-on-the-floor beat", "avoid trap hi-hat rolls"],
    },
    elevenlabs: {
      support: "strong",
      instruction_override: "Afrobeats bounce, syncopated percussion, danceable groove, vibrant modern production",
      negative_constraints: [],
    },
  },

  highlife: {
    bpmRange: [100, 120],
    keys: ["F", "Bb", "C", "G"],
    energy: "medium",
    prompt: "West African highlife guitar patterns, horn-friendly rhythm, uplifting groove",
    genre_core: "West African Highlife dance groove",
    instrument_palette: ["highlife guitar", "brass accents", "hand percussion", "walking bass"],
    rhythmic_signature: "Buoyant guitar motifs and syncopated dance pulse",
    arrangement_notes: "Bright celebratory melodic movement with uplifting harmonic direction",
    suno: {
      support: "medium",
      instruction_override: "West African highlife guitar motifs, buoyant rhythm, and celebratory melodic movement.",
      negative_constraints: [],
    },
    elevenlabs: {
      support: "medium",
      instruction_override: "West African highlife groove with bright guitar figures and uplifting dance feel.",
      negative_constraints: [],
    },
  },

  ogene: {
    bpmRange: [90, 110],
    keys: ["G", "C", "D"],
    energy: "high",
    prompt: "Nigerian Ogene-inspired rhythm, metallic bell and slit-drum pulse, energetic festival call-and-response feel",
    genre_core: "Traditional Nigerian Ogene ceremonial groove",
    instrument_palette: ["ogene bells", "slit drum", "talking drum", "festival percussion"],
    rhythmic_signature: "Interlocking metallic bell ostinato and slit-drum pulse",
    arrangement_notes: "Percussion-first structure with chant-ready hook motifs and procession momentum",
    suno: {
      support: "weak",
      instruction_override: "Nigerian Ogene traditional ensemble with metallic bell ostinato, slit-drum pulse, communal call-and-response chant phrasing, and sparse harmonic bed.",
      negative_constraints: [
        "avoid glossy afropop synth stacks",
        "avoid highlife guitar-led lead phrasing",
        "avoid dembow/reggaeton rhythm",
      ],
    },
    elevenlabs: {
      support: "medium",
      instruction_override: "Nigerian Ogene traditional ensemble, metallic bell and slit-drum call patterns, festival procession groove, chant-like hook responses.",
      negative_constraints: ["avoid trap hi-hat programming", "avoid EDM risers"],
    },
  },

  juju: {
    bpmRange: [95, 115],
    keys: ["A", "D", "E"],
    energy: "medium",
    prompt: "Juju guitar-led groove, layered percussion, celebratory Yoruba dance feel",
    genre_core: "Yoruba Juju dance-band feel",
    instrument_palette: ["lead guitar", "rhythm guitar", "talking drum", "shekere"],
    rhythmic_signature: "Syncopated interlocking guitar rhythm over rolling hand percussion",
    arrangement_notes: "Keep groove celebratory, guitar-led, and dance-forward with layered rhythmic movement",
    suno: {
      support: "weak",
      instruction_override: "Juju-inspired guitar-led groove with layered hand percussion and celebratory Yoruba dance feel.",
      negative_constraints: ["avoid afrobeats kick-snare bounce as the core groove"],
    },
    elevenlabs: {
      support: "medium",
      instruction_override: "Juju guitar interlocking lines, rolling percussion, and celebratory dance cadence.",
      negative_constraints: [],
    },
  },

  fuji: {
    bpmRange: [90, 110],
    keys: ["D", "G", "A"],
    energy: "high",
    prompt: "Fuji-inspired talking drum drive, polyrhythmic percussion, high-energy vocal cadence",
    genre_core: "Fuji-inspired percussive street-band energy",
    instrument_palette: ["talking drum", "frame drum", "auxiliary percussion", "support bass"],
    rhythmic_signature: "Dense polyrhythmic pulse led by talking drum accents",
    arrangement_notes: "Relentless rhythmic momentum with controlled breaks and chant cadence",
    suno: {
      support: "weak",
      instruction_override: "Fuji-inspired talking drum drive, polyrhythmic percussion layers, energetic chant cadence.",
      negative_constraints: ["avoid pop four-on-the-floor beat"],
    },
    elevenlabs: {
      support: "medium",
      instruction_override: "Fuji-inspired talking drum rhythm and dense percussive momentum with chant phrasing.",
      negative_constraints: [],
    },
  },

  afropop: {
    bpmRange: [100, 120],
    keys: ["F", "Bb", "Eb", "C"],
    energy: "medium",
    prompt: "Afropop crossover groove, melodic hooks, rhythmic percussion and modern polish",
    genre_core: "Afropop crossover with melodic hooks and modern production",
    instrument_palette: ["synth lead", "guitar riff", "percussion", "bass groove"],
    rhythmic_signature: "Mid-tempo groove blending African rhythms with pop sensibility",
    arrangement_notes: "Melodic hook-forward with rhythmic energy and polished modern sheen",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  // ── Latin/South American Styles ────────────────────────────────────────

  reggaeton: {
    bpmRange: [85, 100],
    keys: ["Am", "Dm", "Em", "Gm"],
    energy: "high",
    prompt: "reggaeton dembow pulse, urban percussion, bass-forward dance rhythm",
    genre_core: "Reggaeton with signature dembow rhythm",
    instrument_palette: ["808 bass", "dembow percussion", "synth lead", "vocal chops"],
    rhythmic_signature: "Dembow kick-snare pattern with 808 bass pulse",
    arrangement_notes: "Bass-forward with percussive energy and urban production polish",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  salsa: {
    bpmRange: [160, 200],
    keys: ["C", "F", "Bb", "G"],
    energy: "high",
    prompt: "salsa rhythm section with clave feel, brass-ready momentum, high-energy dance groove",
    genre_core: "High-energy salsa with clave-driven rhythm section",
    instrument_palette: ["clave", "congas", "brass section", "piano montuno"],
    rhythmic_signature: "Clave pattern driving tumbao bass and conga accents",
    arrangement_notes: "Call-and-response brass over tight rhythm section with dance momentum",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  bossa_nova: {
    bpmRange: [120, 145],
    keys: ["D", "G", "A", "E"],
    energy: "low",
    prompt: "bossa nova syncopation, nylon guitar texture, smooth Brazilian jazz calm",
    genre_core: "Bossa nova with smooth Brazilian jazz sensibility",
    instrument_palette: ["nylon guitar", "brushed drums", "upright bass", "soft piano"],
    rhythmic_signature: "Syncopated bossa groove with nylon guitar pattern",
    arrangement_notes: "Understated elegance with smooth harmonic movement and rhythmic subtlety",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },

  cumbia: {
    bpmRange: [85, 105],
    keys: ["D", "G", "A", "E"],
    energy: "medium",
    prompt: "cumbia pulse, upbeat percussion, melodic accordion-friendly dance flow",
    genre_core: "Traditional cumbia with infectious dance pulse",
    instrument_palette: ["accordion", "guacharaca", "bass", "cumbia drums"],
    rhythmic_signature: "Steady cumbia pulse with off-beat accordion and scraping guacharaca",
    arrangement_notes: "Upbeat dance groove with melodic accordion hooks and steady percussion",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  bachata: {
    bpmRange: [125, 145],
    keys: ["Am", "Dm", "Em", "G"],
    energy: "medium",
    prompt: "bachata guitar rhythm, romantic groove, crisp percussive accents",
    genre_core: "Romantic bachata with signature guitar requinto",
    instrument_palette: ["requinto guitar", "bongos", "bass guitar", "guira"],
    rhythmic_signature: "Bachata guitar pattern with bongo accents and guira groove",
    arrangement_notes: "Romantic feel with guitar-forward arrangement and crisp percussion",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  samba: {
    bpmRange: [96, 110],
    keys: ["D", "G", "A", "E"],
    energy: "high",
    prompt: "samba carnival energy, rolling percussion, bright Brazilian dance momentum",
    genre_core: "Samba with carnival percussion energy",
    instrument_palette: ["surdo", "tamborim", "cavaquinho", "agogo"],
    rhythmic_signature: "Rolling samba batucada with surdo pulse and tamborim accents",
    arrangement_notes: "Percussion-driven carnival energy with bright melodic movement",
    suno: { support: "medium", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "medium", instruction_override: null, negative_constraints: [] },
  },

  latin_pop: {
    bpmRange: [100, 130],
    keys: ["C", "F", "G", "Am"],
    energy: "medium",
    prompt: "Latin pop production, polished hooks, dance-ready percussion and modern sheen",
    genre_core: "Latin pop with modern production and crossover appeal",
    instrument_palette: ["synth", "Latin percussion", "bass", "electric guitar"],
    rhythmic_signature: "Pop groove infused with Latin percussion accents",
    arrangement_notes: "Polished radio-friendly production with Latin rhythmic flavor",
    suno: { support: "strong", instruction_override: null, negative_constraints: [] },
    elevenlabs: { support: "strong", instruction_override: null, negative_constraints: [] },
  },
};

// ─── ALIASES ─────────────────────────────────────────────────────────────────
// Union of both previous alias maps (music.js + style-capability-registry.js)

const STYLE_ALIASES = Object.freeze({
  randb: "rnb",
  r_and_b: "rnb",
  "r&b": "rnb",
  "r and b": "rnb",
  afrobeat: "afrobeats",
  bossa: "bossa_nova",
  "bossa-nova": "bossa_nova",
  "bossa nova": "bossa_nova",
  latinpop: "latin_pop",
  "latin-pop": "latin_pop",
  "latin pop": "latin_pop",
});

const DEFAULT_STYLE = Object.freeze({
  bpmRange: [100, 120],
  keys: ["C", "G", "D", "A"],
  energy: "medium",
  prompt: "modern arrangement with clear groove and polished production",
  genre_core: "Modern groove",
  instrument_palette: [],
  rhythmic_signature: "Steady modern rhythm with clear groove pocket",
  arrangement_notes: "Keep arrangement cohesive with clear dynamic arc and memorable hook motifs",
  suno: { support: "unknown", instruction_override: null, negative_constraints: [] },
  elevenlabs: { support: "unknown", instruction_override: null, negative_constraints: [] },
});

const STYLE_DISPLAY_OVERRIDES = Object.freeze({
  rnb: "R&B",
  bossa_nova: "Bossa Nova",
  latin_pop: "Latin Pop",
  juju: "Jùjú",
});

// ─── FUNCTIONS ───────────────────────────────────────────────────────────────

function normalizeStyle(style) {
  if (!style || typeof style !== "string") {
    return null;
  }
  const normalized = style
    .toLowerCase()
    .trim()
    .replace(/\s*&\s*/g, "_and_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return STYLE_ALIASES[normalized] || normalized;
}

function normalizeProvider(provider) {
  if (!provider || typeof provider !== "string") {
    return null;
  }
  const normalized = provider.toLowerCase().trim();
  return normalized === "elevenlabs" || normalized === "suno" ? normalized : null;
}

function normalizeSupportLevel(value) {
  if (!value || typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.toLowerCase().trim();
  return SUPPORT_LEVELS[normalized] !== undefined ? normalized : "unknown";
}

function getStyle(name) {
  const normalized = normalizeStyle(name);
  if (!normalized) return DEFAULT_STYLE;
  return STYLES[normalized] || DEFAULT_STYLE;
}

function getAllStyleKeys() {
  return Object.keys(STYLES);
}

function getStyleDisplayName(styleKey) {
  const normalized = normalizeStyle(styleKey);
  if (!normalized) return "Pop";
  return (
    STYLE_DISPLAY_OVERRIDES[normalized] ||
    normalized
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function getStyleDisplayMap() {
  const map = {};
  for (const styleKey of getAllStyleKeys()) {
    map[styleKey] = getStyleDisplayName(styleKey);
  }
  return map;
}

function getSupportScore(level) {
  const normalized = normalizeSupportLevel(level);
  return SUPPORT_LEVELS[normalized];
}

// ─── SANITIZATION (from style-capability-registry.js) ────────────────────────

function normalizeString(value, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeStringArray(values, { maxItems = 8, maxLength = 160 } = {}) {
  if (!Array.isArray(values)) return [];
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeString(value, maxLength);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function sanitizeProviderOverride(rawOverride) {
  if (!rawOverride || typeof rawOverride !== "object") return null;
  const instructionOverride = normalizeString(rawOverride.instruction_override, 500);
  const hint = normalizeString(rawOverride.hint, 500) || instructionOverride;
  return {
    support: normalizeSupportLevel(rawOverride.support),
    hint,
    prompt_compact: normalizeString(
      rawOverride.prompt_compact || rawOverride.prompt || rawOverride.style_prompt,
      220,
    ),
    instruction_override: instructionOverride || hint,
    genre_core: normalizeString(rawOverride.genre_core, 300),
    rhythmic_signature: normalizeString(rawOverride.rhythmic_signature, 300),
    arrangement_notes: normalizeString(rawOverride.arrangement_notes, 500),
    instrument_palette: normalizeStringArray(rawOverride.instrument_palette, { maxItems: 10, maxLength: 120 }),
    negative_constraints: normalizeStringArray(rawOverride.negative_constraints, { maxItems: 10, maxLength: 180 }),
  };
}

function sanitizeStyleOverrides(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object") return {};
  const sanitized = {};
  const styles = Object.entries(rawOverrides).slice(0, 50);
  for (const [styleKey, providers] of styles) {
    const normalizedStyle = normalizeStyle(styleKey);
    if (!normalizedStyle || !providers || typeof providers !== "object") continue;
    const providerEntries = Object.entries(providers).slice(0, 4);
    for (const [providerKey, override] of providerEntries) {
      const normalizedProvider = normalizeProvider(providerKey);
      if (!normalizedProvider) continue;
      const sanitizedOverride = sanitizeProviderOverride(override);
      if (!sanitizedOverride) continue;
      if (!sanitized[normalizedStyle]) sanitized[normalizedStyle] = {};
      sanitized[normalizedStyle][normalizedProvider] = sanitizedOverride;
    }
  }
  return sanitized;
}

function mergeStringArrays(left, right) {
  return normalizeStringArray([...(left || []), ...(right || [])], { maxItems: 12, maxLength: 180 });
}

function mergeCapability(baseCapability, overrideCapability) {
  if (!overrideCapability) return baseCapability;
  const mergedSupport = normalizeSupportLevel(
    overrideCapability.support && overrideCapability.support !== "unknown"
      ? overrideCapability.support
      : baseCapability.support,
  );
  return {
    support: mergedSupport,
    hint:
      overrideCapability.hint ||
      overrideCapability.instruction_override ||
      baseCapability.hint ||
      baseCapability.instruction_override ||
      null,
    prompt_compact: overrideCapability.prompt_compact || baseCapability.prompt_compact || null,
    instruction_override:
      overrideCapability.instruction_override ||
      overrideCapability.hint ||
      baseCapability.instruction_override ||
      baseCapability.hint ||
      null,
    genre_core: overrideCapability.genre_core || baseCapability.genre_core || null,
    rhythmic_signature: overrideCapability.rhythmic_signature || baseCapability.rhythmic_signature || null,
    arrangement_notes: overrideCapability.arrangement_notes || baseCapability.arrangement_notes || null,
    instrument_palette: mergeStringArrays(baseCapability.instrument_palette, overrideCapability.instrument_palette),
    negative_constraints: mergeStringArrays(baseCapability.negative_constraints, overrideCapability.negative_constraints),
  };
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
      hint: null,
      prompt_compact: null,
      instruction_override: null,
      genre_core: null,
      rhythmic_signature: null,
      arrangement_notes: null,
      instrument_palette: [],
      negative_constraints: [],
    };
  }

  // Read directly from the consolidated STYLES object
  const styleConfig = STYLES[normalizedStyle];
  const providerConfig = styleConfig ? styleConfig[normalizedProvider] : null;
  const fallbackPrompt = normalizedStyle
    ? `${normalizedStyle.replace(/_/g, " ")} arrangement`
    : "modern pop arrangement";
  const merged = mergeCapability(
    {
      support: normalizeSupportLevel(providerConfig?.support),
      hint: normalizeString(providerConfig?.hint || providerConfig?.instruction_override, 500),
      prompt_compact: normalizeString(styleConfig?.prompt, 220) || fallbackPrompt,
      instruction_override: normalizeString(providerConfig?.instruction_override, 500),
      genre_core: providerConfig?.genre_core || styleConfig?.genre_core || null,
      rhythmic_signature: providerConfig?.rhythmic_signature || styleConfig?.rhythmic_signature || null,
      arrangement_notes: providerConfig?.arrangement_notes || styleConfig?.arrangement_notes || null,
      instrument_palette: Array.isArray(providerConfig?.instrument_palette)
        ? providerConfig.instrument_palette
        : [],
      negative_constraints: Array.isArray(providerConfig?.negative_constraints)
        ? providerConfig.negative_constraints
        : [],
    },
    overrides?.[normalizedStyle]?.[normalizedProvider] || null,
  );

  return {
    style: normalizedStyle,
    provider: normalizedProvider,
    support: merged.support,
    support_score: SUPPORT_LEVELS[merged.support],
    hint: merged.hint || null,
    prompt_compact: merged.prompt_compact || fallbackPrompt,
    instruction_override: merged.instruction_override,
    genre_core: merged.genre_core,
    rhythmic_signature: merged.rhythmic_signature,
    arrangement_notes: merged.arrangement_notes,
    instrument_palette: merged.instrument_palette,
    negative_constraints: merged.negative_constraints,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  STYLES,
  STYLE_ALIASES,
  DEFAULT_STYLE,
  SUPPORT_LEVELS,
  normalizeStyle,
  normalizeProvider,
  normalizeSupportLevel,
  normalizeStringArray,
  getStyle,
  getAllStyleKeys,
  getStyleDisplayName,
  getStyleDisplayMap,
  getSupportScore,
  getProviderStyleCapability,
  sanitizeStyleOverrides,
};
