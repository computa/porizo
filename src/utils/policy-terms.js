const POLICY_CONTEXT_REGEX =
  /(policy|producer tag|specific artists?|sensitive[_\s-]?word|blocked|disallowed|restricted|flagged)/i;

const GENERIC_POLICY_TERMS = new Set([
  "artist",
  "artists",
  "producer",
  "producer tag",
  "policy",
  "lyrics policy",
  "sensitive word",
  "sensitive words",
  "blocked word",
  "blocked words",
  "restricted word",
  "restricted words",
  "disallowed word",
  "disallowed words",
  "term",
  "terms",
  "word",
  "words",
  "phrase",
  "phrases",
  "content",
  "lyrics",
  "generation failed",
  "failed",
  "error",
  "policy error",
  "detail",
  "error code",
  "error message",
  "sensitive_word_error",
]);

const NUMBER_WORD_MAP = (() => {
  const map = new Map();
  const tens = [
    [20, "twenty"],
    [30, "thirty"],
    [40, "forty"],
    [50, "fifty"],
    [60, "sixty"],
    [70, "seventy"],
    [80, "eighty"],
    [90, "ninety"],
  ];
  const ones = [
    [1, "one"],
    [2, "two"],
    [3, "three"],
    [4, "four"],
    [5, "five"],
    [6, "six"],
    [7, "seven"],
    [8, "eight"],
    [9, "nine"],
  ];

  for (const [tensValue, tensWord] of tens) {
    for (const [onesValue, onesWord] of ones) {
      const number = String(tensValue + onesValue);
      const compact = `${tensWord}${onesWord}`;
      const spaced = `${tensWord} ${onesWord}`;
      const hyphenated = `${tensWord}-${onesWord}`;
      map.set(compact, { compact, spaced, hyphenated, numeric: number });
      map.set(spaced, { compact, spaced, hyphenated, numeric: number });
      map.set(hyphenated, { compact, spaced, hyphenated, numeric: number });
      map.set(number, { compact, spaced, hyphenated, numeric: number });
    }
  }

  return map;
})();

function normalizePolicyTerm(rawTerm) {
  if (typeof rawTerm !== "string") {
    return "";
  }

  let term = rawTerm
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/g, "")
    .replace(/\s+/g, " ");

  if (!term) {
    return "";
  }

  term = term
    .replace(/^(the\s+)?(word|words|term|terms|phrase|phrases)\s+/i, "")
    .replace(/\s+(word|words|term|terms|phrase|phrases)$/i, "")
    .replace(/\s+(?:is|are|was|were)\s+(?:not\s+)?(?:allowed|blocked|restricted|disallowed|flagged|prohibited).*$/i, "")
    .replace(/\s+not\s+(?:allowed|permitted).*$/i, "")
    .replace(/^generation failed\s*-\s*/i, "")
    .trim();

  if (!term) {
    return "";
  }

  if (term.length > 64) {
    return "";
  }

  if (!/[a-z0-9]/.test(term)) {
    return "";
  }

  const compact = term.replace(/[^a-z0-9]/g, "");
  if (!compact || compact.length < 2 || compact.length > 48) {
    return "";
  }

  if (GENERIC_POLICY_TERMS.has(term) || GENERIC_POLICY_TERMS.has(compact)) {
    return "";
  }

  return term;
}

function splitPolicyTermCandidates(rawChunk) {
  if (typeof rawChunk !== "string") {
    return [];
  }

  const terms = new Set();
  const chunk = rawChunk.trim();
  if (!chunk) {
    return [];
  }

  const quotedMatches = chunk.matchAll(/["“”'`]\s*([^"“”'`]{1,64})\s*["“”'`]/g);
  for (const match of quotedMatches) {
    const normalized = normalizePolicyTerm(match?.[1] || "");
    if (normalized) {
      terms.add(normalized);
    }
  }

  const cleaned = chunk
    .replaceAll("\"", " ")
    .replaceAll("“", " ")
    .replaceAll("”", " ")
    .replaceAll("'", " ")
    .replaceAll("`", " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replaceAll("{", " ")
    .replaceAll("}", " ");
  const parts = cleaned.split(/[,;]|\s+\band\b\s+/i);
  for (const part of parts) {
    const normalized = normalizePolicyTerm(part);
    if (normalized) {
      terms.add(normalized);
    }
  }

  return Array.from(terms);
}

function extractPolicyTermsFromMessage(rawMessage) {
  if (typeof rawMessage !== "string" || !rawMessage.trim()) {
    return [];
  }

  const message = rawMessage.trim();
  const sourceMessages = [message];
  const unescaped = message.replace(/\\"/g, "\"");
  if (unescaped !== message) {
    sourceMessages.push(unescaped);
  }
  const terms = new Set();

  const patterns = [
    /producer tag(?:\s+error)?(?:\s*[:=-]\s*|\s+)([^.;\n]+)/gi,
    /lyrics contain(?:s)?(?:\s*[:=-]\s*|\s+)([^.;\n]+)/gi,
    /(?:flagged|blocked|disallowed|restricted|banned|sensitive)\s+(?:word|words|term|terms|phrase|phrases)(?:\s*[:=-]\s*|\s+)([^.;\n]+)/gi,
    /sensitive[_\s-]?word[_\s-]?error(?:\s*[:=-]\s*|\s+)([^.;\n]+)/gi,
    /(?:specific artists?|artist references?)(?:\s*[:=-]\s*|\s+)([^.;\n]+)/gi,
    /"(?:terms?|words?|phrases?)"\s*:\s*\[(.*?)\]/gi,
    /"(?:term|word|phrase|sensitive_word)"\s*:\s*"([^"]+)"/gi,
  ];

  for (const source of sourceMessages) {
    for (const pattern of patterns) {
      const matches = source.matchAll(pattern);
      for (const match of matches) {
        const chunk = match?.[1] || "";
        for (const term of splitPolicyTermCandidates(chunk)) {
          terms.add(term);
        }
      }
    }
  }

  if (terms.size === 0 && sourceMessages.some((source) => POLICY_CONTEXT_REGEX.test(source))) {
    for (const source of sourceMessages) {
      const quotedMatches = source.matchAll(/["“”'`]\s*([^"“”'`]{2,64})\s*["“”'`]/g);
      for (const match of quotedMatches) {
        const raw = match?.[0] || "";
        const index = typeof match?.index === "number" ? match.index : -1;
        if (index >= 0) {
          const trailing = source.slice(index + raw.length).trimStart();
          if (trailing.startsWith(":")) {
            continue;
          }
        }
        const normalized = normalizePolicyTerm(match?.[1] || "");
        if (normalized) {
          terms.add(normalized);
        }
      }
    }
  }

  return Array.from(terms).sort((a, b) => a.localeCompare(b));
}

function expandPolicyTermVariants(rawTerm) {
  const normalized = normalizePolicyTerm(rawTerm);
  if (!normalized) {
    return [];
  }

  const variants = new Set([normalized]);
  const spaced = normalized.replace(/-/g, " ");
  const hyphenated = normalized.replace(/\s+/g, "-");
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  if (spaced) {
    variants.add(spaced);
  }
  if (hyphenated) {
    variants.add(hyphenated);
  }
  if (compact) {
    variants.add(compact);
  }

  const mapped = NUMBER_WORD_MAP.get(compact) || NUMBER_WORD_MAP.get(spaced) || NUMBER_WORD_MAP.get(hyphenated);
  if (mapped) {
    variants.add(mapped.compact);
    variants.add(mapped.spaced);
    variants.add(mapped.hyphenated);
    variants.add(mapped.numeric);
  }

  return Array.from(variants).sort((a, b) => a.localeCompare(b));
}

module.exports = {
  normalizePolicyTerm,
  splitPolicyTermCandidates,
  extractPolicyTermsFromMessage,
  expandPolicyTermVariants,
};
