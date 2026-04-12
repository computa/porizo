"use strict";

const { autoFormatArticleMarkdown, slugifyFragment, stripMarkdown } = require("./blog-format-service");

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "how", "in", "into",
  "brief", "guide", "ideas", "is", "it", "of", "on", "or", "our", "that", "the", "their", "this",
  "tips", "to", "what", "when", "where", "which", "why", "with", "your",
]);

const RELATIONSHIP_KEYWORDS = [
  "dad", "father", "daddy", "mom", "mother", "mum", "mama", "parents", "parent", "wife", "husband",
  "partner", "boyfriend", "girlfriend", "son", "daughter", "brother", "sister", "friend", "grandma",
  "grandmother", "grandpa", "grandfather",
];

const TOPIC_PATTERNS = [
  /personalized song gift(?:s)? for ([a-z' -]+)/i,
  /custom song gift(?:s)? for ([a-z' -]+)/i,
  /song gift(?:s)? for ([a-z' -]+)/i,
  /gift(?:s)? for ([a-z' -]+)/i,
  /personalized poem gift(?:s)? for ([a-z' -]+)/i,
  /poem gift(?:s)? for ([a-z' -]+)/i,
  /personalized song gift/i,
  /custom song gift/i,
  /song gift/i,
  /personalized poem gift/i,
  /poem gift/i,
  /custom song/i,
  /personalized song/i,
  /personalized poem/i,
];

function countWords(value) {
  return stripMarkdown(value).split(/\s+/).filter(Boolean).length;
}

function sentenceSplit(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractHeadings(markdown) {
  return String(markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^(#{1,6})\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      level: match[1].length,
      text: stripMarkdown(match[2]).trim(),
    }))
    .filter((heading) => heading.text);
}

function extractParagraphs(markdown) {
  return autoFormatArticleMarkdown(markdown)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !/^#{1,6}\s+/.test(block))
    .filter((block) => !/^[-*]\s+/.test(block))
    .filter((block) => !/^\d+\.\s+/.test(block))
    .filter((block) => !/^@\[(youtube|audio)/i.test(block))
    .map((block) => stripMarkdown(block).trim())
    .filter((block) => block.length > 0);
}

function collectExcerpt(paragraphs) {
  const source = paragraphs.find((paragraph) => countWords(paragraph) >= 12) || paragraphs[0] || "";
  if (!source) return "";

  const sentences = sentenceSplit(source);
  let excerpt = "";
  for (const sentence of sentences) {
    const next = excerpt ? `${excerpt} ${sentence}` : sentence;
    if (next.length > 170 && excerpt.length >= 110) break;
    excerpt = next;
    if (excerpt.length >= 120) break;
  }

  if (!excerpt) {
    excerpt = source.slice(0, 160).trim();
  }
  if (excerpt.length < 90 && source.length > excerpt.length) {
    excerpt = source.slice(0, 180).trim();
  }
  return excerpt.replace(/\s+/g, " ").trim();
}

function collectAnswerSummary(paragraphs) {
  const sourceParagraphs = paragraphs.filter((paragraph) => countWords(paragraph) >= 14).slice(0, 2);
  const sentences = sourceParagraphs.flatMap((paragraph) => sentenceSplit(paragraph));
  let summary = "";
  let words = 0;

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (words >= 24 && (words + sentenceWords > 48 || next.length > 320)) {
      break;
    }
    summary = next;
    words += sentenceWords;
    if (words >= 28) {
      break;
    }
  }

  return summary || collectExcerpt(paragraphs);
}

function cleanKeywordCandidate(value) {
  const words = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word));

  return words.slice(0, 5).join(" ").trim();
}

function titleCasePhrase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeAudienceFragment(value) {
  const relationship = findRelationshipAudience(value);
  if (relationship) return relationship;

  const words = cleanKeywordCandidate(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word))
    .slice(0, 2);

  return words.join(" ").trim();
}

function findRelationshipAudience(text) {
  const normalized = ` ${String(text || "").toLowerCase()} `;
  for (const relationship of RELATIONSHIP_KEYWORDS) {
    const matcher = new RegExp(`\\b${relationship.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (matcher.test(normalized)) {
      return relationship;
    }
  }
  return "";
}

function inferContentMedium(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\bpoem\b/.test(normalized)) return "poem";
  if (/\bsong\b/.test(normalized)) return "song";
  return "";
}

function inferTopicKeyword(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  for (const pattern of TOPIC_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    if (match[1]) {
      const audience = normalizeAudienceFragment(match[1]);
      const base = cleanKeywordCandidate(match[0].replace(match[1], "").replace(/\bfor\s*$/i, ""));
      return audience ? `${base} for ${audience}`.trim() : base;
    }
    return cleanKeywordCandidate(match[0]);
  }
  return "";
}

function collectNgramCandidates(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const candidates = new Set();
  for (let size = 5; size >= 2; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phraseWords = tokens.slice(index, index + size);
      if (STOPWORDS.has(phraseWords[0]) || STOPWORDS.has(phraseWords[phraseWords.length - 1])) continue;
      const phrase = cleanKeywordCandidate(phraseWords.join(" "));
      if (!phrase || countWords(phrase) < 2) continue;
      if (!/\b(song|poem|gift|dad|father|mom|mother|parents|birthday|wedding|anniversary|keepsake)\b/.test(phrase)) continue;
      candidates.add(phrase);
    }
  }
  return Array.from(candidates);
}

function scoreCandidate(candidate, headingLower, bodyLower) {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`\\b${escaped}\\b`, "gi");
  const bodyHits = (bodyLower.match(matcher) || []).length;
  const headingHits = (headingLower.match(matcher) || []).length;
  let score = (bodyHits * 3) + (headingHits * 2) + candidate.split(" ").length;
  if (/\b(personalized|custom)\b/.test(candidate)) score += 2;
  if (/\b(song|poem|gift)\b/.test(candidate)) score += 3;
  if (/\b(dad|father|mom|mother|mum|parents|wife|husband|partner|friend)\b/.test(candidate)) score += 2;
  return score;
}

function inferPrimaryKeyword(title, headings, bodyText) {
  const titleWords = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const candidates = [];
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= titleWords.length - size; index += 1) {
      const phrase = cleanKeywordCandidate(titleWords.slice(index, index + size).join(" "));
      if (!phrase || countWords(phrase) < 2) continue;
      candidates.push(phrase);
    }
  }

  const combinedText = `${title} ${headings.map((heading) => heading.text).join(" ")} ${bodyText}`.trim();
  const topicKeyword = inferTopicKeyword(combinedText);
  if (topicKeyword) {
    candidates.unshift(topicKeyword);
  }

  const audience = findRelationshipAudience(combinedText);
  const medium = inferContentMedium(combinedText);
  if (medium && audience) {
    const base = medium === "poem" ? "personalized poem gift" : "personalized song gift";
    candidates.unshift(`${base} for ${audience}`);
  }

  candidates.push(...collectNgramCandidates(`${headings.map((heading) => heading.text).join(" ")} ${bodyText}`));

  const bodyLower = ` ${String(bodyText || "").toLowerCase()} `;
  const headingLower = ` ${headings.map((heading) => heading.text.toLowerCase()).join(" ")} `;

  let best = "";
  let bestScore = -1;
  for (const candidate of new Set(candidates.filter(Boolean))) {
    const score = scoreCandidate(candidate, headingLower, bodyLower);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best) return best;

  if (medium && audience) {
    return `${medium === "poem" ? "personalized poem gift" : "personalized song gift"} for ${audience}`;
  }

  if (medium) {
    return medium === "poem" ? "personalized poem gift" : "personalized song gift";
  }

  return cleanKeywordCandidate(title || bodyText);
}

function inferTargetIntent(title) {
  const normalized = String(title || "").toLowerCase();
  if (/\b(vs|versus|compare|comparison)\b/.test(normalized)) return "comparison";
  if (/\b(best|top|review|pricing|price|cost|alternative|alternatives)\b/.test(normalized)) return "commercial";
  if (/^(login|sign in|porizo)\b/.test(normalized)) return "navigational";
  return "informational";
}

function inferTargetQuery(title, primaryKeyword) {
  const normalizedTitle = String(title || "")
    .replace(/[?]+$/g, "")
    .trim();
  if (/\b(vs|versus|compare|comparison)\b/i.test(normalizedTitle)) {
    return normalizedTitle.toLowerCase();
  }
  if (/^(how|what|why|when|where|who|can|should|best|top)\b/i.test(normalizedTitle)) {
    return normalizedTitle.toLowerCase();
  }
  if (primaryKeyword) {
    return primaryKeyword.trim();
  }
  return normalizedTitle.toLowerCase();
}

function inferTitle(title, primaryKeyword, bodyText) {
  if (title) return title;

  const audience = findRelationshipAudience(bodyText);
  const medium = inferContentMedium(bodyText);

  if (medium && audience) {
    const relationship = titleCasePhrase(audience);
    if (medium === "poem") {
      return `Personalized Poem Gift Ideas for ${relationship}`;
    }
    return `Personalized Song Gift Ideas for ${relationship}`;
  }

  if (primaryKeyword) {
    return titleCasePhrase(primaryKeyword);
  }

  return "";
}

function inferTags({ title, headings, bodyText, primaryKeyword, targetIntent }) {
  const haystack = `${title} ${headings.map((heading) => heading.text).join(" ")} ${bodyText}`.toLowerCase();
  const tags = new Set();

  if (primaryKeyword) tags.add(primaryKeyword);
  if (/\bgift|gifting\b/.test(haystack)) tags.add("gifting");
  if (/\bsong|songs\b/.test(haystack)) tags.add("personalized songs");
  if (/\bpoem|poems\b/.test(haystack)) tags.add("personalized poems");
  if (/\bseo\b/.test(haystack)) tags.add("seo");
  if (/\bgeo\b/.test(haystack)) tags.add("geo");
  if (/\baeo\b|answer engine/.test(haystack)) tags.add("aeo");
  if (/\bmother'?s day\b/.test(haystack)) tags.add("mother's day");
  if (/\bbirthday\b/.test(haystack)) tags.add("birthday");
  if (targetIntent === "comparison") tags.add("comparison");

  return Array.from(tags).slice(0, 6);
}

function inferBlogDraftFields(input) {
  const bodyMarkdown = String(input?.body_markdown || "").trim();
  const suppliedTitle = String(input?.title || "").trim();
  const headings = extractHeadings(bodyMarkdown);
  const paragraphs = extractParagraphs(bodyMarkdown);
  const bodyText = paragraphs.join(" ");
  const headingTitle = headings.find((heading) => heading.level === 1)?.text || headings[0]?.text || "";
  const rawTitle = suppliedTitle || headingTitle;
  const excerpt = collectExcerpt(paragraphs);
  const answerSummary = collectAnswerSummary(paragraphs);
  const primaryKeyword = inferPrimaryKeyword(rawTitle, headings, bodyText);
  const title = inferTitle(rawTitle, primaryKeyword, bodyText);
  const targetIntent = inferTargetIntent(title);
  const targetQuery = inferTargetQuery(title, primaryKeyword);
  const tags = inferTags({ title, headings, bodyText, primaryKeyword, targetIntent });

  return {
    title,
    slug: slugifyFragment(title),
    excerpt,
    answer_summary: answerSummary,
    target_query: targetQuery,
    target_intent: targetIntent,
    primary_keyword: primaryKeyword,
    tags,
    source: "heuristic",
  };
}

module.exports = {
  inferBlogDraftFields,
};
