"use strict";

const { generateText, isAvailable } = require("./llm-provider");
const { stripMarkdown } = require("./blog-review-service");

const BODY_MARKDOWN_MAX_CHARS = 12000;
const BODY_TEXT_PREVIEW_MAX_CHARS = 2200;

const EDITORIAL_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    pageType: { type: "string" },
    retrievalGoal: { type: "string" },
    verdict: { type: "string" },
    confidence: { type: "string" },
    citationPotential: { type: "number" },
    aeoStrength: { type: "number" },
    frameworkAlignment: { type: "number" },
    summary: { type: "string" },
    blockers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
    priorityRewrites: {
      type: "object",
      properties: {
        title: { type: "string" },
        answerBlock: { type: "string" },
        faq: { type: "string" },
      },
    },
  },
};

function clampTenPointScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(10, Math.round(numeric * 10) / 10));
}

function normalizeList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      title: String(item?.title || "").trim(),
      detail: String(item?.detail || "").trim(),
      recommendation: String(item?.recommendation || "").trim(),
    }))
    .filter((item) => item.title || item.detail || item.recommendation)
    .slice(0, 6);
}

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

function sanitizeEditorialErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "Editorial review is unavailable right now.";
  if (
    /unterminated string|unexpected end of json input|json\.parse|structured json response could not be parsed/i.test(message)
  ) {
    return "Editorial review returned an incomplete structured response.";
  }
  return message;
}

function buildUnavailableEditorialReview() {
  return {
    status: "unavailable",
    summary: "Editorial LLM review is unavailable. Deterministic SEO/GEO/AEO review still ran.",
    provider: null,
    model: null,
    verdict: "deterministic_only",
    confidence: "low",
    citationPotential: 0,
    aeoStrength: 0,
    frameworkAlignment: 0,
    pageType: "blog_post",
    retrievalGoal: "informational_citation",
    blockers: [],
    improvements: [],
    priorityRewrites: {},
  };
}

function normalizeEditorialReview(data, meta = {}) {
  return {
    status: "available",
    summary: String(data?.summary || "").trim(),
    provider: meta.provider || null,
    model: meta.model || null,
    verdict: String(data?.verdict || "revise_before_publishing").trim() || "revise_before_publishing",
    confidence: String(data?.confidence || "medium").trim() || "medium",
    citationPotential: clampTenPointScore(data?.citationPotential),
    aeoStrength: clampTenPointScore(data?.aeoStrength),
    frameworkAlignment: clampTenPointScore(data?.frameworkAlignment),
    pageType: String(data?.pageType || "blog_post").trim() || "blog_post",
    retrievalGoal: String(data?.retrievalGoal || "informational_citation").trim() || "informational_citation",
    blockers: normalizeList(data?.blockers).map((item) => ({
      title: item.title,
      detail: item.detail,
    })),
    improvements: normalizeList(data?.improvements).map((item) => ({
      title: item.title,
      recommendation: item.recommendation || item.detail,
    })),
    priorityRewrites: {
      title: String(data?.priorityRewrites?.title || "").trim(),
      answerBlock: String(data?.priorityRewrites?.answerBlock || "").trim(),
      faq: String(data?.priorityRewrites?.faq || "").trim(),
    },
  };
}

function buildEditorialPrompt(post, deterministicReport) {
  const bodyMarkdown = truncateText(post.body_markdown, BODY_MARKDOWN_MAX_CHARS);
  const bodyTextPreview = truncateText(stripMarkdown(post.body_markdown), BODY_TEXT_PREVIEW_MAX_CHARS);

  return [
    "You are an editorial reviewer for articles that should perform in SEO, GEO, and AEO.",
    "You do not decide the hard publish gate. Deterministic review already does that.",
    "Your job is to diagnose citation potential, answer-engine clarity, and suggest concrete rewrites.",
    "Return JSON only.",
    "",
    "Evaluate this draft as a likely citation and answer-engine source.",
    "",
    "Deterministic review context:",
    JSON.stringify({
      decision: deterministicReport.decision,
      overallScore: deterministicReport.overallScore,
      seoScore: deterministicReport.seoScore,
      geoScore: deterministicReport.geoScore,
      aeoScore: deterministicReport.aeoScore,
      blockers: deterministicReport.blockers?.map((item) => item.code),
      recommendations: deterministicReport.recommendations?.map((item) => item.code),
      metrics: deterministicReport.metrics,
    }, null, 2),
    "",
    "Article draft:",
    JSON.stringify({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      answer_summary: post.answer_summary,
      target_query: post.target_query,
      target_intent: post.target_intent,
      primary_keyword: post.primary_keyword,
      author_name: post.author_name,
      tags: post.tags,
      body_markdown_excerpt: bodyMarkdown.text,
      body_markdown_truncated: bodyMarkdown.truncated,
      body_text_preview: bodyTextPreview.text,
      body_text_preview_truncated: bodyTextPreview.truncated,
    }, null, 2),
    "",
    "Rules:",
    "- Assume the article is for Porizo and should help real searchers, not just rank.",
    "- Prefer practical citation blockers over generic SEO advice.",
    "- Keep blockers to the 3 most important issues.",
    "- Keep improvements to the 5 highest leverage edits.",
    "- Provide rewrite suggestions that are concrete and usable, not vague principles.",
    "- Use one of these verdicts: publish_as_is, publish_after_light_edits, revise_before_publishing, rewrite_substantially.",
    "- Confidence must be one of: high, medium, low.",
    "- Use a 0-10 scale for citationPotential, aeoStrength, frameworkAlignment.",
  ].join("\n");
}

async function generateEditorialReview(post, deterministicReport, { generateTextFn = generateText } = {}) {
  const runningUnderNodeTest =
    process.execArgv.includes("--test") ||
    process.argv.includes("--test");
  const testsAllowLiveReview = process.env.BLOG_EDITORIAL_REVIEW_ENABLE_IN_TEST === "true";
  const editorialReviewDisabledInTests =
    (process.env.NODE_ENV === "test" || runningUnderNodeTest) &&
    generateTextFn === generateText &&
    !testsAllowLiveReview;

  if (editorialReviewDisabledInTests || (generateTextFn === generateText && !isAvailable())) {
    return buildUnavailableEditorialReview();
  }

  try {
    const result = await generateTextFn({
      prompt: buildEditorialPrompt(post, deterministicReport),
      taskType: "simple",
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: EDITORIAL_REVIEW_SCHEMA,
      maxOutputTokens: 900,
      providers: ["gemini", "anthropic", "openai"],
    });
    const parsed = JSON.parse(String(result.text || "{}"));
    return normalizeEditorialReview(parsed, { provider: result.provider, model: result.model });
  } catch (error) {
    console.error("[BlogEditorialReview] Failed:", error);
    return {
      ...buildUnavailableEditorialReview(),
      status: "error",
      summary: "Editorial LLM review failed. Deterministic SEO/GEO/AEO review still ran.",
      error: sanitizeEditorialErrorMessage(error),
    };
  }
}

module.exports = {
  buildEditorialPrompt,
  buildUnavailableEditorialReview,
  generateEditorialReview,
  normalizeEditorialReview,
};
