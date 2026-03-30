/**
 * Content Filter Service
 *
 * Handles profanity, hate speech, and prompt injection detection.
 * Uses custom word lists for transparency and auditability.
 */

// Base profanity word list (common offensive terms)
// Kept minimal and auditable - add monitoring for gaps
const PROFANITY_WORDS = new Set([
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks',
  'shit', 'shitting', 'shitty', 'shits',
  'ass', 'asshole', 'asses',
  'bitch', 'bitches', 'bitchy',
  'damn', 'damned', 'dammit',
  'crap', 'crappy',
  'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'piss', 'pissed', 'pissing',
  'bastard', 'bastards',
  'whore', 'whores',
  'slut', 'sluts', 'slutty',
  'cunt', 'cunts',
  'twat', 'twats',
  'wanker', 'wankers',
  'bollocks',
  'arse', 'arsehole',
  'prick', 'pricks',
]);

// Hate speech categories with associated patterns
const HATE_SPEECH_PATTERNS = {
  racial: [
    /\bn[i1!][g9][g9][e3]r/i,
    /\bn[i1!][g9]{2}[a@]/i,
    /\bch[i1!]nk/i,
    /\bsp[i1!]c/i,
    /\bwetback/i,
    /\bgook/i,
    /\bkike/i,
    /\bcoon\b/i,
    /\bdarkie/i,
    /\bporch\s*monkey/i,
    /\bjigaboo/i,
    /\brag\s*head/i,
    /\btowel\s*head/i,
    /\bsand\s*n[i1!][g9]{2}/i,
  ],
  homophobic: [
    /\bf[a4@][g9]{1,2}[o0]t/i,
    /\bf[a4@][g9]\b/i,
    /\bdyke\b/i,
    /\btr[a4@]nn(y|ie)/i,
    /\bshemale/i,
    /\bhe[\s-]?she\b/i,
  ],
  religious: [
    /\bkike/i,
    /\bheeb/i,
    /\bmuzzie/i,
    /\bmuslim.*terrorist/i,
    /\bterrorist.*muslim/i,
  ],
  gender: [
    /\bc[u*]nt/i,
    /\bbitch.*die/i,
    /\bdie.*bitch/i,
    /\bwh[o0]re.*kill/i,
    /\bkill.*wh[o0]re/i,
    /\bfeminazi/i,
  ],
  ableist: [
    /\bretard(ed)?\b/i,
    /\bspaz\b/i,
    /\bmongoloid/i,
  ],
};

// Prompt injection patterns - attacks against LLM
const INJECTION_PATTERNS = [
  // Instruction override attempts
  /ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?)/i,
  /disregard\s+(previous|all|above|prior)\s+(instructions?|prompts?)/i,
  /forget\s+(previous|all|above|prior)\s+(instructions?|prompts?)/i,

  // Role reassignment
  /you\s+are\s+(now\s+)?(a\s+|an\s+)?(evil|malicious|unethical|different)/i,
  /pretend\s+(you're|you\s+are|to\s+be)/i,
  /act\s+as\s+(if|though)/i,
  /roleplay\s+as/i,
  /from\s+now\s+on/i,

  // System prompt extraction
  /what('s|\s+is)\s+(your|the)\s+(system|initial)\s+prompt/i,
  /reveal\s+(your|the)\s+(system|hidden)\s+(prompt|instructions)/i,
  /show\s+me\s+(your|the)\s+instructions/i,

  // XML/delimiter injection
  /<\/?system>/i,
  /<\/?assistant>/i,
  /<\/?user>/i,
  /<\/?human>/i,
  /\[\[SYSTEM\]\]/i,
  /\[\[INST\]\]/i,
  /###\s*(SYSTEM|INSTRUCTION)/i,

  // Jailbreak patterns
  /dan\s+mode/i,
  /do\s+anything\s+now/i,
  /jailbreak/i,
  /bypass\s+(content|safety)\s+(filter|moderation)/i,
  /unlock\s+(hidden|developer)\s+mode/i,

  // SVC-08: Code block and system prompt override patterns
  /```[\s\S]*?```/,
  /\bsystem\s*:\s*/i,
  /\bignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
];

// Words to allowlist (common words that match patterns but are OK)
const ALLOWLIST = new Set([
  'hancock',     // Name containing 'cock'
  'scunthorpe', // UK town
  'penistone',  // UK town
  'cockburn',   // Scottish name
  'dickens',    // Author
  'dickson',    // Name
  'ashit',      // Name (contains 'shit')
  'shitake',    // Mushroom
  'assassin',   // Contains 'ass'
  'assistant',  // Contains 'ass'
  'assume',     // Contains 'ass'
  'assure',     // Contains 'ass'
  'classic',    // Contains 'ass'
  'pass',       // Contains 'ass'
  'mass',       // Contains 'ass'
  'class',      // Contains 'ass'
  'grass',      // Contains 'ass'
  'compass',    // Contains 'ass'
]);

/**
 * Normalize text for detection (leet speak, diacritics, spacing tricks)
 */
function normalizeText(text) {
  if (!text) return '';

  return text
    .toLowerCase()
    // SVC-07: Strip diacritics (e.g., "fück" → "fuck")
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Common leet speak substitutions
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    // Remove spacing tricks
    .replace(/\s+/g, ' ')
    // SVC-07: Collapse repeated characters (e.g., "fuuuck" → "fuck")
    .replace(/(.)\1{2,}/g, '$1$1')
    .trim();
}

/**
 * Check if a single word is in allowlist (exact match only)
 * @param {string} word - Single word to check
 * @returns {boolean} - True if word is exactly in allowlist
 */
function isWordAllowlisted(word) {
  if (!word) return false;
  // Strip punctuation and check exact match
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
  return ALLOWLIST.has(cleanWord);
}

function hasAllowlistBypassProfanity(cleanWord) {
  if (!cleanWord) return false;

  for (const allowWord of ALLOWLIST) {
    if (cleanWord === allowWord) continue;
    if (!cleanWord.startsWith(allowWord)) continue;

    const suffix = cleanWord.slice(allowWord.length);
    if (!suffix) continue;
    if (PROFANITY_WORDS.has(suffix)) {
      return true;
    }
  }

  return false;
}

function hasProfanityCompound(cleanWord) {
  if (!cleanWord) return false;

  for (const profanity of PROFANITY_WORDS) {
    // Very short tokens like "ass" create too many false positives.
    if (profanity.length < 4) continue;
    if (cleanWord.length <= profanity.length) continue;

    // Catch obvious compounds like "shithead" or "dumbass" without
    // flagging innocent infix matches such as "scraped" -> "crap".
    if (cleanWord.startsWith(profanity) || cleanWord.endsWith(profanity)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter profanity from text
 * @param {string} text - Text to check
 * @returns {{ clean: boolean, matches: string[] }}
 */
function filterProfanity(text) {
  if (!text || typeof text !== 'string') {
    return { clean: true, matches: [] };
  }

  const normalized = normalizeText(text);
  const matches = [];

  // Check each word (both exact match and contains)
  const words = text.toLowerCase().split(/\s+/);
  const normalizedWords = normalized.split(/\s+/);

  for (const word of words) {
    if (isWordAllowlisted(word)) continue;
    const cleanWord = word.replace(/[^a-z]/gi, '');

    if (hasAllowlistBypassProfanity(cleanWord)) {
      matches.push(word);
      continue;
    }

    // Exact match
    if (PROFANITY_WORDS.has(cleanWord)) {
      matches.push(word);
      continue;
    }

    if (hasProfanityCompound(cleanWord)) {
      matches.push(word);
    }
  }

  // Also check normalized version
  for (const word of normalizedWords) {
    if (isWordAllowlisted(word) || matches.includes(word)) continue;
    const cleanWord = word.replace(/[^a-z]/gi, '');

    if (hasAllowlistBypassProfanity(cleanWord)) {
      matches.push(word);
      continue;
    }

    if (PROFANITY_WORDS.has(cleanWord)) {
      matches.push(word);
      continue;
    }

    if (hasProfanityCompound(cleanWord)) {
      matches.push(word);
    }
  }

  return {
    clean: matches.length === 0,
    matches: [...new Set(matches)], // Dedupe
  };
}

/**
 * Filter hate speech from text
 * @param {string} text - Text to check
 * @returns {{ clean: boolean, category: string|null, matches: string[] }}
 */
function filterHateSpeech(text) {
  if (!text || typeof text !== 'string') {
    return { clean: true, category: null, matches: [] };
  }

  const normalized = normalizeText(text);
  const matches = [];
  let detectedCategory = null;

  for (const [category, patterns] of Object.entries(HATE_SPEECH_PATTERNS)) {
    for (const pattern of patterns) {
      const match = normalized.match(pattern) || text.match(pattern);
      if (match) {
        detectedCategory = category;
        matches.push(match[0]);
      }
    }
  }

  return {
    clean: matches.length === 0,
    category: detectedCategory,
    matches: [...new Set(matches)],
  };
}

/**
 * Sanitize text for LLM prompt (remove injection attempts)
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeForPrompt(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sanitized = text;

  // SVC-09: Normalize newlines before other sanitization
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // Remove XML-like tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove markdown-style delimiters that could be instructions
  sanitized = sanitized.replace(/```[^`]*```/g, '');
  sanitized = sanitized.replace(/###[^\n]*/g, '');

  // Remove bracket instructions
  sanitized = sanitized.replace(/\[\[[^\]]*\]\]/g, '');

  // Limit length to prevent context overflow attacks
  if (sanitized.length > 2000) {
    sanitized = sanitized.slice(0, 2000);
  }

  return sanitized.trim();
}

/**
 * Detect prompt injection attempts
 * @param {string} text - Text to check
 * @returns {{ clean: boolean, patterns: string[] }}
 */
function detectInjection(text) {
  if (!text || typeof text !== 'string') {
    return { clean: true, patterns: [] };
  }

  // SVC-09: NFKC normalization catches Unicode confusables (e.g. fullwidth chars, ligatures)
  const normalizedForDetection = text.normalize('NFKC');

  const patterns = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text) || pattern.test(normalizedForDetection)) {
      patterns.push(pattern.source);
    }
  }

  return {
    clean: patterns.length === 0,
    patterns,
  };
}

/**
 * Comprehensive moderation check
 * @param {Object} content - Content to moderate
 * @param {string} [content.recipientName] - Recipient name
 * @param {string} [content.message] - Personal message
 * @param {string} [content.storyContext] - Story/memory context
 * @param {string} [content.lyrics] - Generated lyrics (post-LLM)
 * @returns {{
 *   allowed: boolean,
 *   reason?: string,
 *   category?: string,
 *   severity: 'none'|'minor'|'moderate'|'severe',
 *   details?: Object
 * }}
 */
function moderateContent(content) {
  const { recipientName, message, storyContext, lyrics } = content || {};

  // Combine all text for checking
  const allText = [recipientName, message, storyContext, lyrics]
    .filter(Boolean)
    .join(' ');

  if (!allText.trim()) {
    return { allowed: true, severity: 'none' };
  }

  // Check each filter in order of severity

  // 1. Prompt injection (severe - security risk)
  const injectionResult = detectInjection(allText);
  if (!injectionResult.clean) {
    return {
      allowed: false,
      reason: 'PROMPT_INJECTION',
      severity: 'severe',
      details: { patterns: injectionResult.patterns },
    };
  }

  // 2. Hate speech (severe - legal/ethical risk)
  const hateSpeechResult = filterHateSpeech(allText);
  if (!hateSpeechResult.clean) {
    return {
      allowed: false,
      reason: 'HATE_SPEECH',
      category: hateSpeechResult.category,
      severity: 'severe',
      details: { matches: hateSpeechResult.matches },
    };
  }

  // 3. Profanity (moderate - policy violation)
  const profanityResult = filterProfanity(allText);
  if (!profanityResult.clean) {
    return {
      allowed: false,
      reason: 'PROFANITY',
      severity: 'moderate',
      details: { matches: profanityResult.matches },
    };
  }

  return { allowed: true, severity: 'none' };
}

/**
 * Moderate lyrics specifically (post-LLM validation)
 * Re-checks generated content to ensure LLM didn't introduce issues
 * @param {string} lyrics - Generated lyrics to validate
 * @returns {{ allowed: boolean, reason?: string, sanitized?: string }}
 */
function moderateLyrics(lyrics) {
  if (!lyrics || typeof lyrics !== 'string') {
    return { allowed: true };
  }

  const result = moderateContent({ lyrics });

  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason,
      details: result.details,
    };
  }

  return { allowed: true };
}

module.exports = {
  filterProfanity,
  filterHateSpeech,
  sanitizeForPrompt,
  detectInjection,
  moderateContent,
  moderateLyrics,
  // Export for testing
  normalizeText,
  HATE_SPEECH_PATTERNS,
  INJECTION_PATTERNS,
  PROFANITY_WORDS,
};
