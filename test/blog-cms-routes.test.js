require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const blogRepairService = require("../src/services/blog-repair-service");

function buildApprovedPayload(overrides = {}) {
  const bodyMarkdown = [
    "## Why a personalized song gift works",
    ...Array.from({ length: 12 }, (_, index) =>
      `Paragraph ${index + 1}: A personalized song gift works when the story is specific, emotionally clear, and easy to understand. ` +
      "A strong draft names the recipient, explains the occasion, gives a concrete memory, and shows why the moment matters."
    ),
    "",
    "## How to brief the writer",
    "- Share the exact occasion.",
    "- Include one vivid memory and one quote.",
    "- Explain the emotional truth behind the story.",
    "",
    "## FAQ",
    "### What makes a personalized song gift good?",
    "A personalized song gift is strongest when the answer summary directly answers the target query and the body repeats the keyword naturally.",
    "",
    "See [Porizo gifting](/gift) and [Google helpful content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).",
  ].join("\n");

  return {
    title: "How a personalized song gift becomes a story people remember",
    slug: "how-a-personalized-song-gift-becomes-a-story-people-remember",
    excerpt: "Use a personalized song gift to capture the exact memory, emotional truth, and occasion in a format that works for search and sharing.",
    answer_summary: "A personalized song gift performs best when it answers the target query directly, names a specific memory, and gives search engines a clear summary at the top.",
    target_query: "how to write a personalized song gift",
    target_intent: "informational",
    primary_keyword: "personalized song gift",
    hero_image_url: "https://cdn.porizo.co/blog/song-gift.jpg",
    body_markdown: bodyMarkdown,
    author_name: "Ambrose",
    tags: ["seo", "geo", "song gifts"],
    ...overrides,
  };
}

describe("blog CMS routes", () => {
  let db;
  let app;
  let adminToken;

  async function loginAdmin() {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });
    assert.equal(response.statusCode, 200);
    return response.json().token;
  }

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
    adminToken = await loginAdmin();
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("supports create -> review -> publish -> public fetch lifecycle", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/blog/posts",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: buildApprovedPayload(),
    });
    assert.equal(createResponse.statusCode, 200);
    const created = createResponse.json().post;
    assert.equal(created.status, "draft");
    assert.equal(created.review_status, "unreviewed");

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/blog/posts/${created.id}/review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(reviewResponse.statusCode, 200);
    const reviewed = reviewResponse.json();
    assert.equal(reviewed.report.decision, "approved");
    assert.equal(reviewed.post.review_status, "approved");
    assert.ok(reviewed.report.editorial_review);
    assert.ok(["available", "unavailable", "error"].includes(reviewed.report.editorial_review.status));

    const publishResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/blog/posts/${created.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(publishResponse.statusCode, 200);
    const published = publishResponse.json().post;
    assert.equal(published.status, "published");
    assert.ok(published.published_at);

    const indexResponse = await app.inject({ method: "GET", url: "/blog" });
    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.body, /How a personalized song gift becomes a story people remember/);

    const postResponse = await app.inject({ method: "GET", url: `/blog/${published.slug}` });
    assert.equal(postResponse.statusCode, 200);
    assert.match(postResponse.body, /Article/);
    assert.match(postResponse.body, /A personalized song gift performs best/);
    assert.match(postResponse.body, /In this article/);
    assert.match(postResponse.body, /min read/);
    assert.match(postResponse.body, /id="why-a-personalized-song-gift-works"/);

    const sitemapResponse = await app.inject({ method: "GET", url: "/sitemap.xml" });
    assert.equal(sitemapResponse.statusCode, 200);
    assert.match(sitemapResponse.body, new RegExp(`/blog/${published.slug}`));
  });

  test("serves admin JS assets as javascript instead of falling through to the SPA HTML shell", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/assets/admin.js" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] || "", /application\/javascript/);
    assert.doesNotMatch(response.body, /<!doctype html>/i);
  });

  test("editing a published post returns it to draft and removes it from public routes until re-reviewed", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/admin/dashboard/blog/posts",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: buildApprovedPayload(),
    });
    const post = createResponse.json().post;

    await app.inject({
      method: "POST",
      url: `/admin/dashboard/blog/posts/${post.id}/review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/admin/dashboard/blog/posts/${post.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/admin/dashboard/blog/posts/${post.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: buildApprovedPayload({
        title: "How a personalized song gift becomes a family keepsake",
        slug: "how-a-personalized-song-gift-becomes-a-family-keepsake",
      }),
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = updateResponse.json().post;
    assert.equal(updated.status, "draft");
    assert.equal(updated.review_status, "unreviewed");
    assert.equal(updated.published_at, null);

    const hiddenResponse = await app.inject({
      method: "GET",
      url: `/blog/${updated.slug}`,
    });
    assert.equal(hiddenResponse.statusCode, 404);

    const publishBlockedResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/blog/posts/${post.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(publishBlockedResponse.statusCode, 400);
    assert.match(publishBlockedResponse.body, /pass review before publishing/i);
  });

  test("rejects invalid target_intent values at the API boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/blog/posts",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: buildApprovedPayload({ target_intent: "viral" }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /target intent must be one of/i);
  });

  test("autofills metadata from body markdown for faster drafting", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/blog/posts/autofill",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        body_markdown: [
          "# How to write a personalized song gift brief",
          "",
          "A personalized song gift brief works when it answers the occasion quickly, names one specific memory, and explains what emotion the final song should leave behind.",
          "",
          "That makes the piece easier to write, easier to review, and easier for search and answer engines to understand.",
          "",
          "## Checklist",
          "- Name the recipient.",
          "- Describe the moment.",
          "- Explain why it matters.",
        ].join("\n"),
      },
    });

    assert.equal(response.statusCode, 200);
    const draft = response.json().draft;
    assert.equal(draft.title, "How to write a personalized song gift brief");
    assert.equal(draft.slug, "how-to-write-a-personalized-song-gift-brief");
    assert.equal(draft.primary_keyword, "personalized song gift");
    assert.equal(draft.target_intent, "informational");
    assert.ok(Array.isArray(draft.tags));
    assert.ok(draft.tags.includes("gifting"));
  });

  test("autofill still generates search metadata when the article has no markdown heading", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/blog/posts/autofill",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        body_markdown: [
          "Your dad remembers the song that was playing the day you took your first steps and the drive home from the hospital with the windows down.",
          "",
          "A personalized song gift for dad lands better when the draft centers one vivid memory, one detail he would instantly recognize, and one emotional truth about what he gave you.",
          "",
          "The best gift ideas for parents stay specific instead of trying to retell an entire life story.",
        ].join("\n"),
      },
    });

    assert.equal(response.statusCode, 200);
    const draft = response.json().draft;
    assert.equal(draft.title, "Personalized Song Gift Ideas for Dad");
    assert.equal(draft.primary_keyword, "personalized song gift for dad");
    assert.equal(draft.target_query, "personalized song gift for dad");
    assert.ok(draft.tags.includes("gifting"));
  });

  test("repair route rewrites the draft from review findings and reruns review", async () => {
    const originalGenerateRepair = blogRepairService.generateBlogRepairDraft;
    blogRepairService.generateBlogRepairDraft = async () => ({
      status: "available",
      summary: "Expanded the draft and fixed the review blockers.",
      provider: "gemini",
      model: "gemini-2.0-flash",
      draft: {
        title: "Personalized Song Gift Ideas for Dad",
        slug: "personalized-song-gift-ideas-for-dad",
        excerpt: "Learn how to turn one vivid family memory into a personalized song gift for dad that feels specific, warm, and easy to share.",
        answer_summary: "A personalized song gift for dad works when it answers the emotional why quickly, then supports it with a concrete memory and clear structure.",
        target_query: "personalized song gift for dad",
        target_intent: "informational",
        primary_keyword: "personalized song gift for dad",
        hero_image_url: "",
        body_markdown: [
          "A personalized song gift for dad works best when the article opens with one clear memory and explains why that moment still matters.",
          "",
          "## How to write it well",
          "",
          "- Start with one scene he would recognize instantly.",
          "- Add one quote or phrase he always says.",
          "- Explain the emotional truth the song should carry.",
          "",
          "Read more about [gift ideas](/gift) and see [Google's helpful content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).",
          "",
          "## FAQ",
          "",
          "### What makes a good personalized song gift for dad?",
          "It should stay specific, emotionally clear, and easy to scan.",
        ].join("\n"),
        tags: ["gifting", "personalized songs"],
      },
    });

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: "/admin/dashboard/blog/posts",
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: buildApprovedPayload({
          title: "Gift Ideas for Dad",
          slug: "gift-ideas-for-dad",
          excerpt: "Short excerpt.",
          answer_summary: "Short summary.",
          target_query: "",
          primary_keyword: "",
          hero_image_url: "",
          body_markdown: "Your dad remembers the song from the drive home after the hospital.",
        }),
      });
      assert.equal(createResponse.statusCode, 200);
      const post = createResponse.json().post;

      const reviewResponse = await app.inject({
        method: "POST",
        url: `/admin/dashboard/blog/posts/${post.id}/review`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      assert.equal(reviewResponse.statusCode, 200);
      assert.equal(reviewResponse.json().report.decision, "rejected");

      const repairResponse = await app.inject({
        method: "POST",
        url: `/admin/dashboard/blog/posts/${post.id}/repair`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      assert.equal(repairResponse.statusCode, 200);
      const repaired = repairResponse.json();
      assert.equal(repaired.post.title, "Personalized Song Gift Ideas for Dad");
      assert.equal(repaired.post.primary_keyword, "personalized song gift for dad");
      assert.equal(repaired.post.target_query, "personalized song gift for dad");
      assert.match(repaired.post.body_markdown, /## How to write it well/);
      assert.equal(repaired.repair.provider, "gemini");
      assert.equal(repaired.repair.before.decision, "rejected");
      assert.ok(typeof repaired.repair.after.overallScore === "number");
    } finally {
      blogRepairService.generateBlogRepairDraft = originalGenerateRepair;
    }
  });
});
