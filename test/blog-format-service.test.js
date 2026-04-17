const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  autoFormatArticleMarkdown,
  buildFormattedArticle,
  estimateReadingTimeMinutes,
} = require("../src/services/blog-format-service");
const { renderBlogPostPage } = require("../src/services/blog-render-service");

describe("blog format service", () => {
  test("splits dense prose into shorter readable paragraphs", () => {
    const denseParagraph = [
      "A personalized song gift works best when it starts with a clear answer to the reader's question and then quickly grounds that answer in a specific memory that feels real rather than generic.",
      "That means naming the recipient, the occasion, and the emotional truth early so the reader understands both the situation and why the song matters before the article moves into process advice.",
      "Writers then benefit from shorter paragraphs because they make each idea easier to scan, easier to quote, and easier to reuse in search snippets or answer engines.",
    ].join(" ");

    const formatted = autoFormatArticleMarkdown(denseParagraph);
    const paragraphs = formatted.split("\n\n");

    assert.ok(paragraphs.length >= 2);
    assert.ok(paragraphs.every((paragraph) => paragraph.split(/\s+/).filter(Boolean).length <= 55));
  });

  test("builds headings and reading-time metadata from formatted markdown", () => {
    const post = {
      body_markdown: [
        "## Why this works",
        "",
        "A personalized song article should answer the main question quickly and clearly.",
        "",
        "## How to structure it",
        "",
        "Use shorter paragraphs, meaningful headings, and one idea per block to keep the reading rhythm steady.",
        "",
        "### FAQ",
        "",
        "Answer the obvious follow-up questions directly.",
      ].join("\n"),
    };

    const article = buildFormattedArticle(post);

    assert.deepEqual(
      article.headings.map((heading) => heading.id),
      ["why-this-works", "how-to-structure-it", "faq"],
    );
    assert.ok(article.readingTimeMinutes >= 1);
    assert.equal(article.readingTimeMinutes, estimateReadingTimeMinutes(article.formattedMarkdown));
  });

  test("renders published articles with reading time, table of contents, and anchored headings", () => {
    const html = renderBlogPostPage({
      slug: "formatted-article",
      title: "Formatted article",
      excerpt: "A short excerpt.",
      answer_summary: "Lead with the answer, then make the body easy to scan.",
      body_markdown: [
        "## Why readable formatting matters",
        "",
        "A good article should be easy to scan and easy to understand.",
        "",
        "## How to break up sections",
        "",
        "Shorter paragraphs and useful headings improve comprehension.",
        "",
        "### FAQ",
        "",
        "Answer follow-up questions near the end.",
      ].join("\n"),
      tags: ["seo"],
      author_name: "Ambrose",
      published_at: "2026-04-07T00:00:00.000Z",
      updated_at: "2026-04-07T00:00:00.000Z",
    });

    assert.match(html, />Contents</);
    assert.match(html, /min read/);
    assert.match(html, /id="why-readable-formatting-matters"/);
    assert.match(html, /href="#how-to-break-up-sections"/);
  });

  test("renders explicit youtube and audio embed directives safely", () => {
    const html = renderBlogPostPage({
      slug: "embedded-article",
      title: "Embedded article",
      excerpt: "An article with media.",
      answer_summary: "Use explicit media directives instead of raw HTML.",
      body_markdown: [
        "## Watch the example",
        "",
        "@[youtube Song example](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
        "",
        "## Listen to the clip",
        "",
        "@[audio Preview clip](https://cdn.porizo.co/audio/example.mp3)",
        "",
        "### FAQ",
        "",
        "Media can sit inside an article without breaking structure.",
      ].join("\n"),
      tags: [],
      author_name: "Ambrose",
      published_at: "2026-04-07T00:00:00.000Z",
      updated_at: "2026-04-07T00:00:00.000Z",
    });

    assert.match(html, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(html, /<audio controls preload="metadata" src="https:\/\/cdn\.porizo\.co\/audio\/example\.mp3">/);
    assert.match(html, /Song example/);
    assert.match(html, /Preview clip/);
  });
});
