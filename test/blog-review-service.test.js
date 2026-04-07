const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { reviewBlogDraft, extractMarkdownMetrics } = require("../src/services/blog-review-service");

function buildRichBody() {
  const filler = Array.from({ length: 12 }, (_, index) =>
    `Paragraph ${index + 1}: Personalized song gifts work best when the story is concrete, specific, and emotionally honest. ` +
    "The reader should understand who the song is for, what happened, why it mattered, and what feeling the song should leave behind."
  ).join("\n\n");

  return [
    "## Why personalized song gifts work",
    filler,
    "",
    "## Steps to write a strong brief",
    "- Start with the occasion and recipient.",
    "- Add one vivid memory and one concrete detail.",
    "- Explain the emotional truth in plain language.",
    "",
    "## FAQ",
    "### What should a personalized song include?",
    "It should include the primary keyword personalized song gift, a direct answer, and a clear emotional point of view.",
    "",
    "Read more at [Porizo songs](/songs) and see [search guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).",
  ].join("\n");
}

describe("blog review service", () => {
  test("rejects thin drafts with blocking SEO/GEO/AEO issues", () => {
    const report = reviewBlogDraft({
      title: "Song ideas",
      slug: "Song Ideas",
      excerpt: "Too short.",
      answer_summary: "Short answer.",
      target_query: "",
      primary_keyword: "personalized song gift",
      body_markdown: "A tiny paragraph with almost nothing in it.",
    });

    assert.equal(report.decision, "rejected");
    assert.ok(report.blockers.some((item) => item.code === "invalid_slug"));
    assert.ok(report.blockers.some((item) => item.code === "missing_target_query"));
    assert.ok(report.blockers.some((item) => item.code === "thin_content"));
    assert.ok(report.blockers.some((item) => item.code === "missing_structure"));
  });

  test("approves well-structured drafts and emits only recommendations", () => {
    const report = reviewBlogDraft({
      title: "How a personalized song gift creates a stronger family memory",
      slug: "how-a-personalized-song-gift-creates-a-stronger-family-memory",
      excerpt: "Learn how a personalized song gift turns a vague celebration idea into a memorable story people want to share and revisit.",
      answer_summary: "A personalized song gift works best when it answers the recipient's story directly, names a specific memory, and gives search engines a clear summary near the top.",
      target_query: "how to write a personalized song gift",
      primary_keyword: "personalized song gift",
      hero_image_url: "https://cdn.porizo.co/blog/personalized-song-gift.jpg",
      body_markdown: buildRichBody(),
    });

    assert.equal(report.decision, "approved");
    assert.equal(report.blockers.length, 0);
    assert.ok(report.overallScore >= 70);
  });

  test("extracts useful markdown structure metrics for review", () => {
    const metrics = extractMarkdownMetrics(buildRichBody());

    assert.ok(metrics.wordCount > 450);
    assert.ok(metrics.h2Count >= 2);
    assert.ok(metrics.internalLinkCount >= 1);
    assert.ok(metrics.externalLinkCount >= 1);
    assert.ok(metrics.faqCount >= 1 || metrics.questionHeadingCount >= 1);
  });
});
