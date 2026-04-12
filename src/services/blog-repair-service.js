"use strict";

const { generateText, isAvailable } = require("./llm-provider");
const { inferBlogDraftFields } = require("./blog-autofill-service");
const { autoFormatArticleMarkdown } = require("./blog-format-service");
const { normalizePostInput } = require("./blog-service");
const { extractMarkdownMetrics, stripMarkdown } = require("./blog-review-service");

const BODY_MARKDOWN_MAX_CHARS = 16000;
const DEFAULT_INTERNAL_LINKS = [
  {
    url: "/pricing.html",
    label: "See Porizo pricing and plan options",
  },
  {
    url: "/support.html",
    label: "Read Porizo support and creation guidance",
  },
  {
    url: "/blog",
    label: "Browse more personalized song ideas on the Porizo blog",
  },
];
const DEFAULT_HERO_IMAGES = {
  song: "/assets/og-song.png",
  poem: "/assets/og-poem.png",
};

const BLOG_REPAIR_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    excerpt: { type: "string" },
    answer_summary: { type: "string" },
    target_query: { type: "string" },
    target_intent: { type: "string" },
    primary_keyword: { type: "string" },
    hero_image_url: { type: "string" },
    body_markdown: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    change_summary: { type: "string" },
  },
};

function truncateText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`,
    truncated: true,
  };
}

function buildUnavailableRepairResult() {
  return {
    status: "unavailable",
    summary: "AI draft repair is unavailable right now.",
    provider: null,
    model: null,
    draft: null,
  };
}

function sanitizeRepairErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "AI draft repair is unavailable right now.";
  if (
    /unterminated string|unexpected end of json input|json\.parse|structured json response could not be parsed/i.test(message)
  ) {
    return "AI draft repair returned an incomplete structured response.";
  }
  return message;
}

function normalizeRepairTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeComparableValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesComparablePhrase(text, phrase) {
  const normalizedText = normalizeComparableValue(stripMarkdown(text));
  const normalizedPhrase = normalizeComparableValue(phrase);
  return normalizedPhrase.length > 0 && normalizedText.includes(normalizedPhrase);
}

function inferContentMedium(post) {
  const haystack = [
    post?.title,
    post?.primary_keyword,
    post?.target_query,
    post?.body_markdown,
  ].join(" ").toLowerCase();
  return /\bpoem\b/.test(haystack) ? "poem" : "song";
}

function buildRepairContext(post) {
  const medium = inferContentMedium(post);
  return {
    suggested_internal_links: DEFAULT_INTERNAL_LINKS,
    suggested_hero_image_url: DEFAULT_HERO_IMAGES[medium] || DEFAULT_HERO_IMAGES.song,
    medium,
  };
}

function reportHasFinding(report, code) {
  const blockers = Array.isArray(report?.blockers) ? report.blockers : [];
  const recommendations = Array.isArray(report?.recommendations) ? report.recommendations : [];
  return blockers.some((item) => item?.code === code) || recommendations.some((item) => item?.code === code);
}

function ensureAnswerSummaryAlignment(draft) {
  const query = String(draft?.target_query || draft?.primary_keyword || "").trim();
  if (!query) return draft;
  if (includesComparablePhrase(draft.answer_summary, query)) {
    return draft;
  }

  const audienceLead = /\bfor\s+([a-z0-9' -]+)$/i.exec(query)?.[1]?.trim();
  const summary = audienceLead
    ? `If you're looking for ${query}, this guide explains how to turn one specific memory into a meaningful gift for ${audienceLead}.`
    : `If you're looking for ${query}, this guide explains how to make it feel specific, personal, and memorable.`;

  return {
    ...draft,
    answer_summary: summary,
  };
}

function ensureInternalLinks(draft, report) {
  if (!reportHasFinding(report, "missing_internal_links")) {
    return draft;
  }

  const metrics = extractMarkdownMetrics(draft.body_markdown);
  if (metrics.internalLinkCount > 0) {
    return draft;
  }

  const resourcesSection = [
    "## Related Porizo Resources",
    "",
    ...DEFAULT_INTERNAL_LINKS.slice(0, 2).map((link) => `- [${link.label}](${link.url})`),
  ].join("\n");

  const body = String(draft.body_markdown || "").trim();
  const separator = body.endsWith("\n") ? "" : "\n\n";
  return {
    ...draft,
    body_markdown: `${body}${separator}${resourcesSection}`.trim(),
  };
}

function ensureHeroImage(draft, report, post) {
  if (String(draft?.hero_image_url || "").trim()) {
    return draft;
  }
  if (!reportHasFinding(report, "missing_hero_image")) {
    return draft;
  }

  const medium = inferContentMedium(post);
  return {
    ...draft,
    hero_image_url: DEFAULT_HERO_IMAGES[medium] || DEFAULT_HERO_IMAGES.song,
  };
}

function applyDeterministicRepairFixups(post, draft, report) {
  let next = { ...draft };
  next = ensureAnswerSummaryAlignment(next);
  next = ensureInternalLinks(next, report);
  next = ensureHeroImage(next, report, post);
  next.body_markdown = autoFormatArticleMarkdown(next.body_markdown || "");
  return next;
}

function normalizeRepairDraft(post, repaired) {
  const generatedBody = String(repaired?.body_markdown || "").trim() || String(post?.body_markdown || "");
  const formattedBody = autoFormatArticleMarkdown(generatedBody);
  const inferred = inferBlogDraftFields({
    title: repaired?.title || post?.title || "",
    body_markdown: formattedBody,
  });

  const merged = normalizePostInput({
    ...post,
    ...repaired,
    title: String(repaired?.title || inferred.title || post?.title || "").trim(),
    excerpt: String(repaired?.excerpt || inferred.excerpt || post?.excerpt || "").trim(),
    answer_summary: String(repaired?.answer_summary || inferred.answer_summary || post?.answer_summary || "").trim(),
    target_query: String(repaired?.target_query || inferred.target_query || post?.target_query || "").trim(),
    target_intent: String(repaired?.target_intent || inferred.target_intent || post?.target_intent || "informational").trim(),
    primary_keyword: String(repaired?.primary_keyword || inferred.primary_keyword || post?.primary_keyword || "").trim(),
    hero_image_url: String(repaired?.hero_image_url || post?.hero_image_url || "").trim() || null,
    body_markdown: formattedBody,
    author_name: String(post?.author_name || "").trim(),
    tags: normalizeRepairTags(repaired?.tags).length > 0
      ? normalizeRepairTags(repaired?.tags)
      : (inferred.tags?.length > 0 ? inferred.tags : post?.tags || []),
  });

  const fixed = applyDeterministicRepairFixups(post, merged, repaired?.__review_report || null);

  return {
    ...fixed,
    change_summary: String(repaired?.change_summary || "").trim(),
  };
}

function buildRepairPrompt(post, report) {
  const bodyMarkdown = truncateText(post.body_markdown, BODY_MARKDOWN_MAX_CHARS);
  const repairContext = buildRepairContext(post);

  return [
    "You repair blog article drafts for Porizo after a deterministic SEO/GEO/AEO review and an editorial LLM review.",
    "Your job is to return a materially improved draft, not generic advice.",
    "Return JSON only.",
    "",
    "Rules:",
    "- Fix the review blockers directly in the rewritten article and metadata.",
    "- Preserve the article's factual meaning and emotional examples unless a review item requires structural change.",
    "- Produce clean markdown with a strong title, direct intro, clear ## sections, at least one list when useful, and an FAQ section when the review asks for answer-engine support.",
    "- If the review says internal links or external citations are missing, add realistic placeholder links only when you can do so credibly. Use Porizo links as relative paths like /gift or /blog/example-slug. Use reputable external URLs only when the claim clearly needs one.",
    "- Do not invent hero image URLs. Keep the existing one unless you have a real value.",
    "- Return one primary keyword, not a comma-separated list.",
    "- Return one target query that matches what the article should rank for.",
    "- Keep target_intent to one of: informational, commercial, comparison, navigational.",
    "",
    "Current draft:",
    JSON.stringify({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      answer_summary: post.answer_summary,
      target_query: post.target_query,
      target_intent: post.target_intent,
      primary_keyword: post.primary_keyword,
      hero_image_url: post.hero_image_url,
      author_name: post.author_name,
      tags: post.tags,
      body_markdown: bodyMarkdown.text,
      body_markdown_truncated: bodyMarkdown.truncated,
    }, null, 2),
    "",
    "Deterministic review:",
    JSON.stringify({
      decision: report.decision,
      overallScore: report.overallScore,
      seoScore: report.seoScore,
      geoScore: report.geoScore,
      aeoScore: report.aeoScore,
      formatScore: report.formatScore,
      blockers: report.blockers || [],
      recommendations: report.recommendations || [],
    }, null, 2),
    "",
    "Editorial review:",
    JSON.stringify(report.editorial_review || null, null, 2),
    "",
    "Repair context:",
    JSON.stringify(repairContext, null, 2),
    "",
    "Return a full repaired draft in the requested schema.",
  ].join("\n");
}

async function generateBlogRepairDraft(post, report, { generateTextFn = generateText } = {}) {
  const runningUnderNodeTest =
    process.execArgv.includes("--test") ||
    process.argv.includes("--test");
  const testsAllowLiveRepair = process.env.BLOG_DRAFT_REPAIR_ENABLE_IN_TEST === "true";
  const repairDisabledInTests =
    (process.env.NODE_ENV === "test" || runningUnderNodeTest) &&
    generateTextFn === generateText &&
    !testsAllowLiveRepair;

  if (repairDisabledInTests || (generateTextFn === generateText && !isAvailable())) {
    return buildUnavailableRepairResult();
  }

  try {
    const result = await generateTextFn({
      prompt: buildRepairPrompt(post, report),
      taskType: "simple",
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: BLOG_REPAIR_SCHEMA,
      maxOutputTokens: 3000,
      providers: ["gemini", "anthropic", "openai"],
    });

    const parsed = JSON.parse(String(result.text || "{}"));
    parsed.__review_report = report;
    return {
      status: "available",
      summary: String(parsed?.change_summary || "AI repaired the draft using the review findings.").trim(),
      provider: result.provider || null,
      model: result.model || null,
      draft: normalizeRepairDraft(post, parsed),
    };
  } catch (error) {
    console.error("[BlogRepair] Failed:", error);
    return {
      ...buildUnavailableRepairResult(),
      status: "error",
      summary: "AI draft repair failed.",
      error: sanitizeRepairErrorMessage(error),
    };
  }
}

module.exports = {
  BLOG_REPAIR_SCHEMA,
  buildRepairPrompt,
  buildUnavailableRepairResult,
  generateBlogRepairDraft,
  normalizeRepairDraft,
};
