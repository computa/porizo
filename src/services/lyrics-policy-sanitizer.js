const { getProviderPolicyProfile } = require("./provider-policy-profiles");

const AGE_NUMBER_REGEX = /\b(\d{1,3})(?:\s*(?:years?\s*old|yrs?\s*old))?\b/gi;

const NUMBER_WORDS = Object.freeze({
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
  30: "thirty",
  40: "forty",
  50: "fifty",
  60: "sixty",
  70: "seventy",
  80: "eighty",
  90: "ninety",
});

function numberToWords(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 999) {
    return String(value);
  }
  if (NUMBER_WORDS[numeric]) {
    return NUMBER_WORDS[numeric];
  }
  if (numeric < 100) {
    const tens = Math.floor(numeric / 10) * 10;
    const ones = numeric % 10;
    if (ones === 0) return NUMBER_WORDS[tens];
    return `${NUMBER_WORDS[tens]} ${NUMBER_WORDS[ones]}`;
  }
  const hundreds = Math.floor(numeric / 100);
  const remainder = numeric % 100;
  if (remainder === 0) {
    return `${NUMBER_WORDS[hundreds]} hundred`;
  }
  return `${NUMBER_WORDS[hundreds]} hundred ${numberToWords(remainder)}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTermRegex(term) {
  const escaped = escapeRegex(term).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function normalizeLineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function iterateLyricsLines(lyrics) {
  const rows = [];
  if (!lyrics || typeof lyrics !== "object") {
    return rows;
  }
  if (typeof lyrics.title === "string") {
    rows.push({
      source: "title",
      sectionIndex: -1,
      lineIndex: -1,
      sectionName: "title",
      text: lyrics.title,
    });
  }
  if (typeof lyrics.anchor_line === "string") {
    rows.push({
      source: "anchor_line",
      sectionIndex: -1,
      lineIndex: -1,
      sectionName: "anchor_line",
      text: lyrics.anchor_line,
    });
  }
  if (typeof lyrics.anchorLine === "string") {
    rows.push({
      source: "anchorLine",
      sectionIndex: -1,
      lineIndex: -1,
      sectionName: "anchorLine",
      text: lyrics.anchorLine,
    });
  }
  const sections = Array.isArray(lyrics.sections) ? lyrics.sections : [];
  sections.forEach((section, sectionIndex) => {
    const sectionName = section?.name || `section_${sectionIndex}`;
    const lines = Array.isArray(section?.lines) ? section.lines : [];
    lines.forEach((line, lineIndex) => {
      rows.push({
        source: "section",
        sectionIndex,
        lineIndex,
        sectionName,
        text: String(line || ""),
      });
    });
  });
  return rows;
}

function containsAllowedContext(line, profile) {
  if (!line) return false;
  const lower = line.toLowerCase();
  return (profile.allow_context_phrases || []).some((phrase) => lower.includes(phrase));
}

function createViolation({
  code,
  severity,
  provider,
  term,
  message,
  row,
}) {
  return {
    code,
    severity,
    provider,
    term,
    message,
    source: row.source,
    section_index: row.sectionIndex,
    line_index: row.lineIndex,
    section_name: row.sectionName,
    line: normalizeLineText(row.text),
  };
}

function scanLineForPolicy(line, row, profile) {
  const normalizedLine = normalizeLineText(line);
  if (!normalizedLine) return [];
  if (containsAllowedContext(normalizedLine, profile)) {
    return [];
  }

  const violations = [];

  for (const term of profile.hard_block_terms || []) {
    if (compileTermRegex(term).test(normalizedLine)) {
      violations.push(createViolation({
        code: "POLICY_ARTIST_OR_COPYRIGHT_REFERENCE",
        severity: "hard",
        provider: profile.provider,
        term,
        message: "Lyrics reference artist/copyright-linked phrasing that providers often reject.",
        row,
      }));
    }
  }

  for (const term of profile.explicit_terms || []) {
    if (compileTermRegex(term).test(normalizedLine)) {
      violations.push(createViolation({
        code: "POLICY_EXPLICIT_CONTENT",
        severity: "hard",
        provider: profile.provider,
        term,
        message: "Lyrics include explicit language likely to be blocked by providers.",
        row,
      }));
    }
  }

  for (const term of profile.medium_risk_terms || []) {
    if (compileTermRegex(term).test(normalizedLine)) {
      violations.push(createViolation({
        code: "POLICY_RISKY_REFERENCE",
        severity: "soft",
        provider: profile.provider,
        term,
        message: "Lyrics include risky references that frequently trigger provider policy filters.",
        row,
      }));
    }
  }

  for (const term of profile.age_words || []) {
    if (compileTermRegex(term).test(normalizedLine)) {
      violations.push(createViolation({
        code: "POLICY_AGE_REFERENCE",
        severity: "soft",
        provider: profile.provider,
        term,
        message: "Age references can trigger provider moderation; prefer neutral wording.",
        row,
      }));
    }
  }

  AGE_NUMBER_REGEX.lastIndex = 0;
  let match;
  while ((match = AGE_NUMBER_REGEX.exec(normalizedLine)) !== null) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 125) {
      violations.push(createViolation({
        code: "POLICY_NUMERIC_AGE",
        severity: "soft",
        provider: profile.provider,
        term: match[0],
        message: "Numeric age references may be rejected; use spelled-out neutral wording.",
        row,
      }));
    }
  }

  return violations;
}

function scanLyricsForProviderPolicy({ lyrics, provider }) {
  const profile = getProviderPolicyProfile(provider);
  const rows = iterateLyricsLines(lyrics);
  const violations = [];

  for (const row of rows) {
    violations.push(...scanLineForPolicy(row.text, row, profile));
  }

  return {
    provider: profile.provider,
    profile,
    violations,
  };
}

function replacementForViolation(violation) {
  switch (violation.code) {
    case "POLICY_ARTIST_OR_COPYRIGHT_REFERENCE":
      return "someone special";
    case "POLICY_EXPLICIT_CONTENT":
      return "deep love";
    case "POLICY_RISKY_REFERENCE":
      return "hard times";
    case "POLICY_AGE_REFERENCE":
      return "young";
    default:
      return "special";
  }
}

function replaceTermCaseInsensitive(line, term, replacement) {
  if (!line || !term) return { line, changed: false };
  const regex = compileTermRegex(term);
  const nextLine = String(line).replace(regex, replacement);
  return { line: nextLine, changed: nextLine !== line };
}

function rewriteNumericAges(line) {
  if (!line) return { line, changed: false };
  const nextLine = String(line).replace(AGE_NUMBER_REGEX, (match, token) => {
    const numeric = Number(token);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 125) {
      return match;
    }
    return `${numberToWords(numeric)} years old`;
  });
  return { line: nextLine, changed: nextLine !== line };
}

function applyViolationsToLyrics(lyrics, violations) {
  if (!lyrics || typeof lyrics !== "object" || !Array.isArray(violations) || violations.length === 0) {
    return { lyrics, changed: false, changes: 0 };
  }

  const next = JSON.parse(JSON.stringify(lyrics));
  let changed = false;
  let changes = 0;

  for (const violation of violations) {
    if (violation.source === "section") {
      const section = next.sections?.[violation.section_index];
      if (!section || !Array.isArray(section.lines) || section.lines[violation.line_index] == null) {
        continue;
      }
      let line = String(section.lines[violation.line_index]);
      if (violation.code === "POLICY_NUMERIC_AGE") {
        const rewrote = rewriteNumericAges(line);
        line = rewrote.line;
        if (rewrote.changed) {
          section.lines[violation.line_index] = line;
          changed = true;
          changes += 1;
        }
        continue;
      }
      const replacement = replacementForViolation(violation);
      const rewrote = replaceTermCaseInsensitive(line, violation.term, replacement);
      if (rewrote.changed) {
        section.lines[violation.line_index] = rewrote.line;
        changed = true;
        changes += 1;
      }
      continue;
    }

    if (violation.source === "title" && typeof next.title === "string") {
      const replacement = replacementForViolation(violation);
      const rewrote = replaceTermCaseInsensitive(next.title, violation.term, replacement);
      if (rewrote.changed) {
        next.title = rewrote.line;
        changed = true;
        changes += 1;
      }
      continue;
    }

    if (violation.source === "anchor_line" && typeof next.anchor_line === "string") {
      const replacement = replacementForViolation(violation);
      const rewrote = replaceTermCaseInsensitive(next.anchor_line, violation.term, replacement);
      if (rewrote.changed) {
        next.anchor_line = rewrote.line;
        changed = true;
        changes += 1;
      }
      continue;
    }

    if (violation.source === "anchorLine" && typeof next.anchorLine === "string") {
      const replacement = replacementForViolation(violation);
      const rewrote = replaceTermCaseInsensitive(next.anchorLine, violation.term, replacement);
      if (rewrote.changed) {
        next.anchorLine = rewrote.line;
        changed = true;
        changes += 1;
      }
    }
  }

  return { lyrics: next, changed, changes };
}

function buildSuggestions(violations) {
  if (!Array.isArray(violations) || violations.length === 0) {
    return [];
  }
  const suggestions = [];
  const seen = new Set();

  for (const violation of violations.slice(0, 8)) {
    const key = `${violation.code}:${violation.term}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (violation.code === "POLICY_ARTIST_OR_COPYRIGHT_REFERENCE") {
      suggestions.push(`Replace "${violation.term}" with original personal wording (no artist/producer references).`);
      continue;
    }
    if (violation.code === "POLICY_NUMERIC_AGE" || violation.code === "POLICY_AGE_REFERENCE") {
      suggestions.push(`Rewrite "${violation.term}" with neutral age-free phrasing.`);
      continue;
    }
    if (violation.code === "POLICY_EXPLICIT_CONTENT") {
      suggestions.push(`Replace explicit wording like "${violation.term}" with cleaner emotional language.`);
      continue;
    }
    suggestions.push(`Rewrite "${violation.term}" with safer wording to avoid provider rejection.`);
  }

  return suggestions;
}

function sanitizeLyricsForProviderPolicy({ lyrics, provider, maxPasses = 2 }) {
  if (!lyrics || !Array.isArray(lyrics.sections)) {
    return {
      provider,
      lyrics,
      changed: false,
      blocked: false,
      rewrite_passes: 0,
      violations: [],
      suggestions: [],
      change_count: 0,
    };
  }

  let candidate = lyrics;
  let totalChanges = 0;
  let rewritePasses = 0;
  let latestScan = scanLyricsForProviderPolicy({ lyrics: candidate, provider });

  while (rewritePasses < maxPasses && latestScan.violations.length > 0) {
    const patched = applyViolationsToLyrics(candidate, latestScan.violations);
    if (!patched.changed) {
      break;
    }
    candidate = patched.lyrics;
    totalChanges += patched.changes;
    rewritePasses += 1;
    latestScan = scanLyricsForProviderPolicy({ lyrics: candidate, provider });
  }

  const hardViolations = latestScan.violations.filter((violation) => violation.severity === "hard");
  const blocked = hardViolations.length > 0;

  return {
    provider: latestScan.provider,
    lyrics: candidate,
    changed: totalChanges > 0,
    blocked,
    rewrite_passes: rewritePasses,
    violations: latestScan.violations,
    suggestions: buildSuggestions(latestScan.violations),
    change_count: totalChanges,
  };
}

module.exports = {
  scanLyricsForProviderPolicy,
  sanitizeLyricsForProviderPolicy,
};
