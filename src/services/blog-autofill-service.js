"use strict";

const { autoFormatArticleMarkdown, slugifyFragment, stripMarkdown } = require("./blog-format-service");

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "how", "in", "into",
  "brief", "guide", "ideas", "is", "it", "of", "on", "or", "our", "that", "the", "their", "this",
  "tips", "to", "what", "when", "where", "which", "why", "with", "your",
]);

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

  const bodyLower = ` ${String(bodyText || "").toLowerCase()} `;
  const headingLower = ` ${headings.map((heading) => heading.text.toLowerCase()).join(" ")} `;

  let best = "";
  let bestScore = -1;
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`\\b${escaped}\\b`, "gi");
    const bodyHits = (bodyLower.match(matcher) || []).length;
    const headingHits = (headingLower.match(matcher) || []).length;
    const score = (bodyHits * 3) + (headingHits * 2) + candidate.split(" ").length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best || cleanKeywordCandidate(title);
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
    return `what is ${primaryKeyword}`.trim();
  }
  return normalizedTitle.toLowerCase();
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
  const title = suppliedTitle || headings.find((heading) => heading.level === 1)?.text || headings[0]?.text || "";
  const bodyText = paragraphs.join(" ");
  const excerpt = collectExcerpt(paragraphs);
  const answerSummary = collectAnswerSummary(paragraphs);
  const primaryKeyword = inferPrimaryKeyword(title, headings, bodyText);
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
