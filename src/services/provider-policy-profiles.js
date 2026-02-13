/**
 * Provider policy profiles used by preflight lyric sanitization.
 *
 * These are deterministic heuristics based on provider docs + observed
 * production rejections. They are intentionally conservative and should
 * be tuned as real rejection telemetry accumulates.
 */

const COMMON_ARTIST_TERMS = Object.freeze([
  "taylor swift",
  "drake",
  "beyonce",
  "adele",
  "rihanna",
  "ed sheeran",
  "burna boy",
  "wizkid",
  "davido",
  "asake",
  "tems",
  "metro boomin",
  "dj khaled",
  "mustard",
  "kendrick lamar",
  "future",
  "travis scott",
  "nicki minaj",
  "j cole",
  "sza",
  "ariana grande",
  "the weeknd",
  "olivia rodrigo",
  "billie eilish",
]);

const COMMON_BRAND_TERMS = Object.freeze([
  "gucci",
  "nike",
  "adidas",
  "louis vuitton",
  "iphone",
  "apple",
  "tesla",
  "rolex",
  "ferrari",
  "coca cola",
  "mcdonalds",
]);

const COMMON_EXPLICIT_TERMS = Object.freeze([
  "fuck",
  "fucking",
  "fucked",
  "bitch",
  "slut",
  "whore",
  "dick",
  "pussy",
  "cum",
  "blowjob",
  "horny",
]);

const COMMON_DRUG_TERMS = Object.freeze([
  "cocaine",
  "crack",
  "heroin",
  "meth",
  "weed",
  "marijuana",
  "joint",
  "ecstasy",
  "mdma",
  "perc",
  "percocet",
  "xanax",
  "high on",
  "getting high",
]);

const COMMON_GRAPHIC_VIOLENCE_TERMS = Object.freeze([
  "kill you",
  "killing you",
  "stab",
  "stabbing",
  "shoot you",
  "blood on",
  "murder",
  "slaughter",
  "decapitate",
]);

const COMMON_AGE_WORDS = Object.freeze([
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty one",
  "twenty-one",
]);

const PROVIDER_POLICY_PROFILES = Object.freeze({
  suno: {
    provider: "suno",
    max_prompt_chars: 3000,
    hard_block_terms: [
      ...COMMON_ARTIST_TERMS,
      "sound like",
      "in the style of",
      "producer tag",
      "specific artist",
    ],
    medium_risk_terms: [
      ...COMMON_BRAND_TERMS,
      ...COMMON_DRUG_TERMS,
      ...COMMON_GRAPHIC_VIOLENCE_TERMS,
    ],
    explicit_terms: [...COMMON_EXPLICIT_TERMS],
    age_words: [...COMMON_AGE_WORDS],
    allow_context_phrases: [
      "killing it",
      "killer groove",
      "fight for",
    ],
  },
  elevenlabs: {
    provider: "elevenlabs",
    max_prompt_chars: 1200,
    hard_block_terms: [
      ...COMMON_ARTIST_TERMS,
      "sound like",
      "in the style of",
      "copyrighted",
      "exactly like",
    ],
    medium_risk_terms: [
      ...COMMON_BRAND_TERMS,
      ...COMMON_DRUG_TERMS,
      ...COMMON_GRAPHIC_VIOLENCE_TERMS,
    ],
    explicit_terms: [...COMMON_EXPLICIT_TERMS],
    age_words: [...COMMON_AGE_WORDS],
    allow_context_phrases: [
      "killing it",
      "fight for",
    ],
  },
  default: {
    provider: "default",
    max_prompt_chars: 1200,
    hard_block_terms: [...COMMON_ARTIST_TERMS],
    medium_risk_terms: [...COMMON_BRAND_TERMS, ...COMMON_DRUG_TERMS],
    explicit_terms: [...COMMON_EXPLICIT_TERMS],
    age_words: [...COMMON_AGE_WORDS],
    allow_context_phrases: [],
  },
});

function normalizeProvider(provider) {
  const normalized = String(provider || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "default";
  if (normalized.includes("suno")) return "suno";
  if (normalized.includes("eleven")) return "elevenlabs";
  return normalized;
}

function getProviderPolicyProfile(provider) {
  const normalized = normalizeProvider(provider);
  return PROVIDER_POLICY_PROFILES[normalized] || PROVIDER_POLICY_PROFILES.default;
}

module.exports = {
  PROVIDER_POLICY_PROFILES,
  normalizeProvider,
  getProviderPolicyProfile,
};
