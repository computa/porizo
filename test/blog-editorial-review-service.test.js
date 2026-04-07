const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  buildUnavailableEditorialReview,
  generateEditorialReview,
} = require("../src/services/blog-editorial-review-service");

const samplePost = {
  title: "How a personalized song gift becomes easier to cite and share",
  slug: "how-a-personalized-song-gift-becomes-easier-to-cite-and-share",
  excerpt: "Learn how to structure a personalized song gift article so search and answer engines can index, summarize, and cite it more confidently.",
  answer_summary: "A personalized song gift article is easier to cite when it opens with a direct answer, supports claims with evidence, and uses scannable structure.",
  target_query: "how to structure a personalized song gift article",
  target_intent: "informational",
  primary_keyword: "personalized song gift",
  author_name: "Ambrose",
  tags: ["seo", "geo"],
  body_markdown: "## Intro\n\nA detailed article body with enough content to audit.",
};

const deterministicReport = {
  decision: "approved",
  overallScore: 82,
  seoScore: 84,
  geoScore: 78,
  aeoScore: 83,
  blockers: [],
  recommendations: [{ code: "missing_internal_links" }],
  metrics: { wordCount: 650, h2Count: 2 },
};

describe("blog editorial review service", () => {
  test("returns deterministic-only review when no LLM is configured", async () => {
    const review = await generateEditorialReview(samplePost, deterministicReport, {
      generateTextFn: async () => {
        throw new Error("LLM should not have been called");
      },
    });

    assert.equal(review.status, "error");
    assert.match(review.summary, /deterministic seo\/geo\/aeo review still ran/i);
  });

  test("exposes an unavailable helper shape for UI fallback", () => {
    const review = buildUnavailableEditorialReview();
    assert.equal(review.status, "unavailable");
    assert.equal(review.verdict, "deterministic_only");
  });

  test("normalizes structured editorial suggestions from an LLM response", async () => {
    const review = await generateEditorialReview(samplePost, deterministicReport, {
      generateTextFn: async () => ({
        text: JSON.stringify({
          pageType: "guide",
          retrievalGoal: "informational_citation",
          verdict: "publish_after_light_edits",
          confidence: "high",
          citationPotential: 8.4,
          aeoStrength: 8.1,
          frameworkAlignment: 7.9,
          summary: "Strong draft, but the intro and FAQ can be sharper for AI retrieval.",
          blockers: [
            { title: "Weak evidence density", detail: "The article makes claims without enough cited support." },
          ],
          improvements: [
            { title: "Tighten intro", recommendation: "Lead with a direct answer in the first two sentences." },
          ],
          priorityRewrites: {
            title: "How to structure a personalized song gift article for search and AI answers",
            answerBlock: "A personalized song gift article performs best when it answers the target query immediately and backs it with concrete examples.",
            faq: "What should a personalized song gift article include?\nIt should include a direct answer, clear structure, and at least one concrete example.",
          },
        }),
        provider: "gemini",
        model: "gemini-2.0-flash",
      }),
    });

    assert.equal(review.status, "available");
    assert.equal(review.provider, "gemini");
    assert.equal(review.verdict, "publish_after_light_edits");
    assert.equal(review.citationPotential, 8.4);
    assert.equal(review.improvements[0].title, "Tighten intro");
    assert.match(review.priorityRewrites.answerBlock, /answers the target query immediately/i);
  });
});
