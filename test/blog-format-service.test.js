const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  autoFormatArticleMarkdown,
  buildFormattedArticle,
  estimateReadingTimeMinutes,
  extractFaqPairs,
} = require("../src/services/blog-format-service");
const {
  renderBlogIndexPage,
  renderBlogPostPage,
} = require("../src/services/blog-render-service");

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
    assert.ok(
      paragraphs.every(
        (paragraph) => paragraph.split(/\s+/).filter(Boolean).length <= 55,
      ),
    );
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
    assert.equal(
      article.readingTimeMinutes,
      estimateReadingTimeMinutes(article.formattedMarkdown),
    );
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

  test("blog index and post pages expose attributed install paths", () => {
    const post = {
      slug: "personalized-song-gift-guide",
      title: "Personalized song gift guide",
      excerpt: "How to make a personalized song gift.",
      answer_summary: "Start with one specific memory.",
      body_markdown: "A short article body.",
      tags: ["seo"],
      author_name: "Ambrose",
      published_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
    };

    const indexHtml = renderBlogIndexPage([post]);
    assert.match(indexHtml, /name="apple-itunes-app"/);
    assert.match(indexHtml, /utm_medium=blog/);
    assert.match(indexHtml, /utm_campaign=blog_index/);

    const postHtml = renderBlogPostPage(post);
    assert.match(postHtml, /name="apple-itunes-app"/);
    assert.match(postHtml, /utm_medium=blog/);
    assert.match(postHtml, /utm_campaign=personalized-song-gift-guide/);
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
    assert.match(
      html,
      /<audio controls preload="metadata" src="https:\/\/cdn\.porizo\.co\/audio\/example\.mp3">/,
    );
    assert.match(html, /Song example/);
    assert.match(html, /Preview clip/);
  });

  test("inline links do not double-escape apostrophes in their label", () => {
    const html = renderBlogPostPage({
      slug: "double-escape-regression",
      title: "Double escape regression",
      excerpt: "Apostrophes inside link labels must not double-escape.",
      answer_summary: "",
      body_markdown: [
        "Turn it into a [Mother's Day song](/mothers-day-song) with Porizo.",
      ].join("\n"),
      tags: [],
      author_name: "Ambrose",
      published_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
    });

    assert.doesNotMatch(html, /Mother&amp;#39;s Day song/);
    assert.match(html, /Mother&#39;s Day song/);
  });

  test("BreadcrumbList JSON-LD is emitted on every post with Home -> Blog -> Post hierarchy", () => {
    const html = renderBlogPostPage({
      slug: "breadcrumb-test",
      title: "Breadcrumb test post",
      excerpt: "Any post should surface the breadcrumb schema.",
      answer_summary: "",
      body_markdown: "A short article body.",
      tags: [],
      author_name: "Ambrose",
      published_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
    });

    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /"position":1,"name":"Home"/);
    assert.match(html, /"position":2,"name":"Blog"/);
    assert.match(html, /"position":3,"name":"Breadcrumb test post"/);
    assert.match(html, /"item":"https:\/\/porizo\.co\/blog\/breadcrumb-test"/);
  });

  test("extractFaqPairs picks up question-style headings with paragraph answers", () => {
    const markdown = [
      "## How do I write a song for a birthday?",
      "Start with one real memory the recipient will recognize, then build the chorus from the emotional core of that memory.",
      "",
      "## What occasions work best?",
      "Birthdays, anniversaries, Mother's Day, Father's Day, and proposals all work because the recipient already expects something meaningful.",
      "",
      "## Pricing notes",
      "This heading should be skipped because it is not phrased as a question.",
    ].join("\n\n");

    const pairs = extractFaqPairs(markdown);

    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].question, "How do I write a song for a birthday?");
    assert.match(pairs[0].answer, /one real memory/);
    assert.equal(pairs[1].question, "What occasions work best?");
  });

  test("FAQPage JSON-LD is injected when the post has multiple question headings", () => {
    const html = renderBlogPostPage({
      slug: "faq-style-article",
      title: "Song-gift FAQ article",
      excerpt: "FAQ-style answers for personalized songs.",
      answer_summary: "How to think about song-gift FAQs.",
      body_markdown: [
        "## How long does a personalized song take?",
        "A free preview is ready in about ninety seconds and the full song finishes in a few minutes.",
        "",
        "## What occasions work best for a song gift?",
        "Milestone birthdays, anniversaries, weddings, and family thank-yous all carry the emotional weight a song amplifies.",
      ].join("\n\n"),
      tags: [],
      author_name: "Ambrose",
      published_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
    });

    assert.match(html, /"@type":"FAQPage"/);
    assert.match(html, /"@type":"Question"/);
    assert.match(html, /How long does a personalized song take\?/);
    assert.match(html, /What occasions work best for a song gift\?/);
  });
});
