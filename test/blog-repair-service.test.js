const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  buildRepairPrompt,
  buildUnavailableRepairResult,
  generateBlogRepairDraft,
} = require("../src/services/blog-repair-service");

const samplePost = {
  title: "Gift Ideas for Dad",
  slug: "gift-ideas-for-dad",
  excerpt: "A short excerpt.",
  answer_summary: "A short summary.",
  target_query: "",
  target_intent: "informational",
  primary_keyword: "",
  hero_image_url: "",
  author_name: "Ambrose",
  tags: ["gifting"],
  body_markdown: "Your dad remembers the song from the drive home after the hospital.",
};

const sampleReport = {
  decision: "rejected",
  overallScore: 61,
  seoScore: 22,
  geoScore: 61,
  aeoScore: 61,
  formatScore: 100,
  blockers: [
    { code: "missing_target_query", message: "Target query is missing.", recommendation: "State the search question this article answers." },
    { code: "missing_structure", message: "The article needs section headings.", recommendation: "Add at least one ## section heading." },
  ],
  recommendations: [
    { code: "missing_faq", message: "The article has no FAQ section.", recommendation: "Add a short FAQ to help answer engines." },
  ],
  editorial_review: {
    status: "available",
    summary: "The article needs a stronger intro and clearer query alignment.",
    provider: "gemini",
    model: "gemini-2.0-flash",
    verdict: "rewrite_substantially",
    confidence: "medium",
    citationPotential: 2,
    aeoStrength: 0,
    frameworkAlignment: 3,
    pageType: "blog_post",
    retrievalGoal: "informational_citation",
    blockers: [{ title: "No clear search target", detail: "The draft reads like notes instead of an article answering a query." }],
    improvements: [{ title: "Use headings", recommendation: "Break the draft into sections with a direct answer up top." }],
    priorityRewrites: {
      title: "Personalized Song Gift Ideas for Dad",
      answerBlock: "A personalized song gift for dad works best when it starts with one vivid memory and a direct explanation of why it matters.",
      faq: "## FAQ\n\n### What makes a good song gift for dad?\nUse a memory he instantly recognizes.",
    },
  },
};

describe("blog repair service", () => {
  test("exposes an unavailable helper shape", () => {
    const result = buildUnavailableRepairResult();
    assert.equal(result.status, "unavailable");
    assert.equal(result.draft, null);
  });

  test("builds a bounded repair prompt with review findings", () => {
    const prompt = buildRepairPrompt(
      {
        ...samplePost,
        body_markdown: `${"Long paragraph. ".repeat(3000)}\n\n## FAQ\n\nMore detail.`,
      },
      sampleReport
    );

    assert.match(prompt, /Deterministic review:/);
    assert.match(prompt, /Editorial review:/);
    assert.match(prompt, /body_markdown_truncated/);
    assert.ok(prompt.length < 25000);
  });

  test("normalizes a repaired draft from the LLM response", async () => {
    const result = await generateBlogRepairDraft(samplePost, sampleReport, {
      generateTextFn: async () => ({
        text: JSON.stringify({
          title: "Personalized Song Gift Ideas for Dad",
          excerpt: "Learn how to turn one memory into a personalized song gift for dad that feels specific, warm, and easy to share.",
          answer_summary: "A personalized song gift for dad works when it opens with one vivid memory, explains why it matters, and gives the writer concrete emotional detail.",
          target_query: "personalized song gift for dad",
          target_intent: "informational",
          primary_keyword: "personalized song gift for dad",
          body_markdown: [
            "A personalized song gift for dad works best when you start with one memory he would recognize immediately.",
            "",
            "## How to make it feel personal",
            "",
            "- Start with one vivid scene.",
            "- Quote something he actually says.",
            "- Explain why the memory still matters.",
            "",
            "## FAQ",
            "",
            "### What makes a good song gift for dad?",
            "It should center one specific memory and one emotional truth.",
          ].join("\n"),
          tags: ["gifting", "personalized songs"],
          change_summary: "Expanded the draft, added structure, and aligned the keyword with a concrete query.",
        }),
        provider: "gemini",
        model: "gemini-2.0-flash",
      }),
    });

    assert.equal(result.status, "available");
    assert.equal(result.provider, "gemini");
    assert.equal(result.draft.title, "Personalized Song Gift Ideas for Dad");
    assert.equal(result.draft.primary_keyword, "personalized song gift for dad");
    assert.equal(result.draft.target_query, "personalized song gift for dad");
    assert.match(result.draft.body_markdown, /## How to make it feel personal/);
    assert.ok(result.draft.tags.includes("gifting"));
  });
});
