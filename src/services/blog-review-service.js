"use strict";

const { autoFormatArticleMarkdown, stripMarkdown } = require("./blog-format-service");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value) {
  const words = stripMarkdown(value).split(/\s+/).filter(Boolean);
  return words.length;
}

function extractMarkdownMetrics(markdown) {
  const source = String(markdown || "");
  const headings = Array.from(source.matchAll(/^(#{1,6})\s+(.+)$/gm)).map((match) => ({
    level: match[1].length,
    text: match[2].trim(),
  }));
  const embeds = Array.from(source.matchAll(/^@\[(youtube|audio)(?:\s+([^\]]+))?\]\(([^)]+)\)$/gim)).map((match) => ({
    type: match[1].toLowerCase(),
    label: String(match[2] || "").trim(),
    url: match[3].trim(),
  }));
  const links = Array.from(source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)).map((match) => match[1].trim());
  const bulletListCount = (source.match(/^(?:- |\* |\d+\. )/gm) || []).length;
  const faqHeadingCount = headings.filter((heading) => /faq|questions?|common questions?/i.test(heading.text)).length;
  const questionHeadingCount = headings.filter((heading) => heading.text.includes("?")).length;
  const internalLinkCount = links.filter((url) => /^(\/|https?:\/\/(?:www\.)?porizo\.co\b|https?:\/\/api\.porizo\.co\b)/i.test(url)).length;
  const externalLinkCount = links.filter((url) => /^https?:\/\//i.test(url) && !/(?:www\.)?porizo\.co\b|api\.porizo\.co\b/i.test(url)).length;
  const paragraphs = source
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part))
    .filter(Boolean);

  return {
    wordCount: countWords(source),
    headingCount: headings.length,
    h2Count: headings.filter((heading) => heading.level === 2).length,
    bulletListCount,
    faqCount: faqHeadingCount,
    questionHeadingCount,
    internalLinkCount,
    externalLinkCount,
    embedCount: embeds.length,
    youtubeEmbedCount: embeds.filter((embed) => embed.type === "youtube").length,
    audioEmbedCount: embeds.filter((embed) => embed.type === "audio").length,
    firstParagraph: paragraphs[0] || "",
  };
}

function extractFormatQualityMetrics(markdown) {
  const formattedMarkdown = autoFormatArticleMarkdown(markdown);
  const paragraphs = formattedMarkdown
    .split(/\n\s*\n/)
    .map((part) => stripMarkdown(part))
    .map((part) => part.trim())
    .filter(Boolean);
  const paragraphWordCounts = paragraphs.map((paragraph) => countWords(paragraph));
  const longParagraphThreshold = 85;
  const longParagraphCount = paragraphWordCounts.filter((count) => count > longParagraphThreshold).length;
  const longestParagraphWords = paragraphWordCounts.length ? Math.max(...paragraphWordCounts) : 0;
  const formattedMetrics = extractMarkdownMetrics(formattedMarkdown);

  return {
    formattedMarkdown,
    paragraphCount: paragraphs.length,
    paragraphWordCounts,
    longParagraphThreshold,
    longParagraphCount,
    longestParagraphWords,
    headingCount: formattedMetrics.headingCount,
    h2Count: formattedMetrics.h2Count,
    bulletListCount: formattedMetrics.bulletListCount,
    faqCount: formattedMetrics.faqCount,
    questionHeadingCount: formattedMetrics.questionHeadingCount,
    firstParagraphWords: paragraphWordCounts[0] || 0,
  };
}

function addItem(collection, code, message, recommendation, extra = {}) {
  collection.push({ code, message, recommendation, ...extra });
}

function includesKeyword(text, keyword) {
  if (!keyword) return false;
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  return normalizedKeyword.length > 0 && normalizedText.includes(normalizedKeyword);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function reviewBlogDraft(input) {
  const title = String(input?.title || "").trim();
  const slug = String(input?.slug || "").trim();
  const excerpt = String(input?.excerpt || "").trim();
  const answerSummary = String(input?.answer_summary || "").trim();
  const targetQuery = String(input?.target_query || "").trim();
  const primaryKeyword = String(input?.primary_keyword || "").trim();
  const bodyMarkdown = String(input?.body_markdown || "");
  const heroImageUrl = String(input?.hero_image_url || "").trim();
  const metrics = extractMarkdownMetrics(bodyMarkdown);
  const formatMetrics = extractFormatQualityMetrics(bodyMarkdown);
  const blockers = [];
  const recommendations = [];

  if (!title) {
    addItem(blockers, "missing_title", "Add a clear title.", "Write a title that states the topic plainly.");
  } else if (title.length < 35) {
    addItem(blockers, "title_too_short", "The title is too short for SEO clarity.", "Expand the title so the topic and promise are obvious.");
  } else if (title.length > 75) {
    addItem(blockers, "title_too_long", "The title is too long for reliable search snippets.", "Trim the title to about 45 to 70 characters.");
  }

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    addItem(blockers, "invalid_slug", "Use a clean kebab-case slug.", "Slug format should look like `how-to-write-a-memory-song`.");
  }

  if (!targetQuery) {
    addItem(blockers, "missing_target_query", "Target query is missing.", "State the search question or query this post is meant to answer.");
  }

  if (!excerpt || excerpt.length < 90) {
    addItem(blockers, "missing_excerpt", "Excerpt is too thin for meta description and feed previews.", "Write a 110 to 160 character excerpt that explains the value of the article.");
  }

  if (!answerSummary || countWords(answerSummary) < 18) {
    addItem(blockers, "missing_answer_summary", "Answer summary is missing or too weak for answer engines.", "Add a 1 to 3 sentence direct answer near the top of the article.");
  }

  if (metrics.wordCount < 450) {
    addItem(blockers, "thin_content", "Body content is too thin to compete in search or answer engines.", "Expand the article to at least 450 words with concrete advice, examples, or evidence.");
  }

  if (metrics.h2Count < 1) {
    addItem(blockers, "missing_structure", "The article needs section headings.", "Add at least one `##` section heading to make the article scannable.");
  }

  if (formatMetrics.longParagraphCount > 0) {
    addItem(
      blockers,
      "format_long_paragraphs",
      `The formatter still leaves ${formatMetrics.longParagraphCount} paragraph${formatMetrics.longParagraphCount === 1 ? "" : "s"} too long to scan easily.`,
      "Break dense sections into shorter paragraphs, add subheadings, or convert dense prose into bullets where appropriate.",
      {
        category: "format",
        severity: "high",
        longestParagraphWords: formatMetrics.longestParagraphWords,
      }
    );
  }

  if (metrics.wordCount >= 700 && formatMetrics.h2Count < 2) {
    addItem(
      blockers,
      "format_insufficient_sections",
      "Longer articles need more section breaks to stay readable after formatting.",
      "For articles over 700 words, use at least two `##` sections with descriptive headings.",
      { category: "format", severity: "high" }
    );
  }

  if (metrics.wordCount >= 900 && formatMetrics.bulletListCount < 1 && formatMetrics.faqCount < 1 && formatMetrics.questionHeadingCount < 1) {
    addItem(
      blockers,
      "format_missing_scan_points",
      "This draft still reads like a long document instead of a skimmable article.",
      "Add at least one list, checklist, FAQ, or question-led section so readers can scan key takeaways quickly.",
      { category: "format", severity: "medium" }
    );
  }

  if (primaryKeyword) {
    if (!includesKeyword(title, primaryKeyword)) {
      addItem(blockers, "keyword_missing_in_title", "Primary keyword is missing from the title.", "Use the primary keyword naturally in the title.");
    }
    if (!includesKeyword(bodyMarkdown, primaryKeyword)) {
      addItem(blockers, "keyword_missing_in_body", "Primary keyword is missing from the body.", "Use the primary keyword naturally in the article body.");
    }
  } else {
    addItem(recommendations, "missing_primary_keyword", "Primary keyword is not set.", "Set a primary keyword so the review can judge search alignment.", {
      category: "seo",
      severity: "medium",
    });
  }

  if (excerpt.length > 180 || excerpt.length < 110) {
    addItem(recommendations, "excerpt_length", "Excerpt length is outside the ideal meta description range.", "Aim for roughly 110 to 160 characters.", {
      category: "seo",
      severity: "low",
    });
  }

  if (metrics.h2Count < 2) {
    addItem(recommendations, "more_sections", "The article would be easier to scan with more section breaks.", "Use at least two `##` sections for longer posts.", {
      category: "geo",
      severity: "medium",
    });
  }

  if (metrics.bulletListCount < 1) {
    addItem(recommendations, "missing_list", "The article has no list structure.", "Add a short list, checklist, or steps section to improve scannability.", {
      category: "geo",
      severity: "medium",
    });
  }

  if (metrics.internalLinkCount < 1) {
    addItem(recommendations, "missing_internal_links", "No internal links were found.", "Link to at least one relevant Porizo page or article.", {
      category: "seo",
      severity: "medium",
    });
  }

  if (metrics.externalLinkCount < 1) {
    addItem(recommendations, "missing_external_links", "No external citations or references were found.", "Add at least one credible external source when making claims.", {
      category: "geo",
      severity: "medium",
    });
  }

  if (metrics.faqCount < 1 && metrics.questionHeadingCount < 1) {
    addItem(recommendations, "missing_faq", "The article has no FAQ or question-oriented section.", "Add a short FAQ or a question-led section to help answer engines.", {
      category: "aeo",
      severity: "medium",
    });
  }

  if (!heroImageUrl) {
    addItem(recommendations, "missing_hero_image", "Hero image is missing.", "Add a hero image URL so social previews are stronger.", {
      category: "seo",
      severity: "low",
    });
  }

  if (!includesKeyword(answerSummary, targetQuery || primaryKeyword)) {
    addItem(recommendations, "answer_summary_alignment", "The answer summary does not clearly repeat the target query or keyword.", "Make the summary answer the target query more directly in plain language.", {
      category: "aeo",
      severity: "medium",
    });
  }

  if (metrics.firstParagraph && countWords(metrics.firstParagraph) > 90) {
    addItem(recommendations, "slow_opening", "The opening paragraph is long and may bury the answer.", "Open with a tighter first paragraph and push detail lower.", {
      category: "aeo",
      severity: "medium",
    });
  }

  if (formatMetrics.firstParagraphWords > 65) {
    addItem(recommendations, "format_opening_density", "The formatter still leaves a dense opening block.", "Shorten the opening, split the first section earlier, or move setup detail below the answer summary.", {
      category: "format",
      severity: "medium",
    });
  }

  let seoScore = 100;
  let geoScore = 100;
  let aeoScore = 100;
  let formatScore = 100;

  seoScore -= blockers.filter((item) => /title|slug|excerpt|keyword|thin_content/.test(item.code)).length * 12;
  seoScore -= recommendations.filter((item) => item.category === "seo").length * 6;
  geoScore -= blockers.filter((item) => /missing_structure|thin_content/.test(item.code)).length * 12;
  geoScore -= recommendations.filter((item) => item.category === "geo").length * 8;
  aeoScore -= blockers.filter((item) => /answer_summary|thin_content/.test(item.code)).length * 15;
  aeoScore -= recommendations.filter((item) => item.category === "aeo").length * 8;
  formatScore -= blockers.filter((item) => item.category === "format").length * 18;
  formatScore -= recommendations.filter((item) => item.category === "format").length * 6;

  const overallScore = clampScore((clampScore(seoScore) + clampScore(geoScore) + clampScore(aeoScore) + clampScore(formatScore)) / 4);
  const decision = blockers.length === 0 ? "approved" : "rejected";

  return {
    decision,
    overallScore,
    seoScore: clampScore(seoScore),
    geoScore: clampScore(geoScore),
    aeoScore: clampScore(aeoScore),
    formatScore: clampScore(formatScore),
    blockers,
    recommendations,
    metrics,
    formatMetrics,
    summary: escapeHtml(
      decision === "approved"
        ? "This draft clears the hard review gate and can be published."
        : "This draft has blocking issues that should be fixed before publishing."
    ),
  };
}

module.exports = {
  reviewBlogDraft,
  extractFormatQualityMetrics,
  extractMarkdownMetrics,
  stripMarkdown,
};
