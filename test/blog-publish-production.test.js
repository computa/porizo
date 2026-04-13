require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  applyLinkReplacements,
  buildRemotePublishScript,
  chooseCandidate,
  extractMarkdownLinks,
  mergeMissingMetadata,
  parseArticlePack,
  normalizeIntentOptions,
  parseLinkReplacement,
} = require("../tools/blog-publish-production");

describe("blog publish production tool helpers", () => {
  test("mergeMissingMetadata preserves manual fields unless overwrite is enabled", () => {
    const current = {
      title: "Manual title",
      slug: "",
      excerpt: "",
      answer_summary: "Manual summary",
      target_query: "",
      target_intent: "informational",
      primary_keyword: "",
      tags: [],
    };
    const inferred = {
      title: "Generated title",
      slug: "generated-title",
      excerpt: "Generated excerpt",
      answer_summary: "Generated summary",
      target_query: "generated query",
      target_intent: "informational",
      primary_keyword: "generated keyword",
      tags: ["seo", "gifting"],
    };

    const merged = mergeMissingMetadata(current, inferred, { overwrite: false });
    assert.equal(merged.title, "Manual title");
    assert.equal(merged.slug, "generated-title");
    assert.equal(merged.excerpt, "Generated excerpt");
    assert.equal(merged.answer_summary, "Manual summary");
    assert.equal(merged.primary_keyword, "generated keyword");
    assert.deepEqual(merged.tags, ["seo", "gifting"]);
  });

  test("extractMarkdownLinks flags porizo-labeled external links as suspicious", () => {
    const links = extractMarkdownLinks(
      "Read [create a Porizo song](https://atom.com/premium-domains-for-sale) or [pricing](/pricing.html)."
    );

    assert.equal(links.length, 2);
    assert.equal(links[0].isSuspicious, true);
    assert.equal(links[0].isExternal, true);
    assert.equal(links[1].isInternal, true);
    assert.equal(links[1].isSuspicious, false);
  });

  test("applyLinkReplacements swaps imported urls before publish", () => {
    const markdown = "Try [Porizo](https://atom.com/premium-domains-for-sale) today.";
    const updated = applyLinkReplacements(markdown, [
      { from: "https://atom.com/premium-domains-for-sale", to: "https://porizo.co" },
    ]);
    assert.equal(updated, "Try [Porizo](https://porizo.co) today.");
  });

  test("parseArticlePack extracts body and metadata from Porizo article packs", () => {
    const pack = parseArticlePack(`TITLE:\nBenchmark Title\n\nSLUG:\nbenchmark-slug\n\nAUTHOR:\nAmbrose\n\nEXCERPT:\nShort excerpt.\n\nTARGET_QUERY:\nhow to benchmark\n\nPRIMARY_KEYWORD:\nbenchmark keyword\n\nHERO_IMAGE:\n/assets/og-song.png\n\nARTICLE CONTENT:\n# Heading\n\nBody text here.\n`);

    assert.equal(pack.title, "Benchmark Title");
    assert.equal(pack.slug, "benchmark-slug");
    assert.equal(pack.author_name, "Ambrose");
    assert.equal(pack.excerpt, "Short excerpt.");
    assert.equal(pack.target_query, "how to benchmark");
    assert.equal(pack.primary_keyword, "benchmark keyword");
    assert.equal(pack.hero_image_url, "/assets/og-song.png");
    assert.equal(pack.body_markdown, "# Heading\n\nBody text here.");
  });

  test("parseArticlePack returns null for plain markdown input", () => {
    assert.equal(parseArticlePack("# Plain article\n\nJust body."), null);
  });

  test("chooseCandidate prefers exact slug matches and rejects ambiguous duplicates", () => {
    const single = chooseCandidate(
      [
        { id: "a", slug: "why-a-personalized-song-gift", title: "Why a Personalized Song Gift" },
        { id: "b", slug: "other", title: "Other" },
      ],
      { slug: "why-a-personalized-song-gift", title: "Why a Personalized Song Gift" }
    );
    assert.equal(single.id, "a");

    assert.throws(
      () =>
        chooseCandidate(
          [
            { id: "a", slug: "why-a-personalized-song-gift", title: "First" },
            { id: "b", slug: "why-a-personalized-song-gift", title: "Second" },
          ],
          { slug: "why-a-personalized-song-gift", title: "Why a Personalized Song Gift" }
        ),
      /Multiple posts match slug/
    );
  });

  test("parseLinkReplacement enforces OLD=NEW format", () => {
    assert.deepEqual(parseLinkReplacement("https://bad=https://good"), {
      from: "https://bad",
      to: "https://good",
    });
    assert.throws(() => parseLinkReplacement("https://bad"), /Use OLD=NEW/);
  });

  test("remote publish script guards body persistence and defaults to deterministic editorial fallback", () => {
    const script = buildRemotePublishScript();
    assert.match(script, /ensureBodyPersisted/);
    assert.match(script, /Saved draft body is empty after remote update/);
    assert.match(script, /buildUnavailableEditorialReview/);
    assert.match(script, /skipEditorialLlm/);
  });

  test("safe-publish intent defaults to no remote AI repair and skips editorial LLM", () => {
    const options = normalizeIntentOptions({ intent: "safe-publish", allowRemoteRepair: false });
    assert.equal(options.intent, "safe-publish");
    assert.equal(options.allowRemoteRepair, false);
    assert.equal(options.skipEditorialLlm, true);
  });

  test("full-auto-publish intent enables remote repair and keeps editorial LLM on by default", () => {
    const options = normalizeIntentOptions({ intent: "full-auto-publish" });
    assert.equal(options.intent, "full-auto-publish");
    assert.equal(options.allowRemoteRepair, true);
    assert.equal(options.skipEditorialLlm, false);
  });
});
