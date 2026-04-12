const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { inferBlogDraftFields } = require("../src/services/blog-autofill-service");

describe("blog autofill service", () => {
  test("infers most draft metadata from a pasted article", () => {
    const draft = inferBlogDraftFields({
      body_markdown: [
        "# How to make a personalized song gift feel truly personal",
        "",
        "A personalized song gift feels personal when it anchors the song in one vivid memory, uses language the recipient would recognize, and makes the emotional point clear in the first few lines.",
        "",
        "The strongest briefs explain what happened, why that moment mattered, and what the listener should feel when the song lands. That gives the writer enough texture to make the piece memorable instead of generic.",
        "",
        "## Steps that make the brief stronger",
        "- Name the occasion.",
        "- Add one specific memory.",
        "- Explain the emotional truth.",
        "",
        "## FAQ",
        "### What makes a personalized song gift better?",
        "A personalized song gift works better when it is concrete, emotionally clear, and easy to scan.",
      ].join("\n"),
    });

    assert.equal(draft.title, "How to make a personalized song gift feel truly personal");
    assert.equal(draft.slug, "how-to-make-a-personalized-song-gift-feel-truly-personal");
    assert.match(draft.excerpt, /personalized song gift feels personal/i);
    assert.match(draft.answer_summary, /vivid memory/i);
    assert.equal(draft.target_intent, "informational");
    assert.equal(draft.primary_keyword, "personalized song gift");
    assert.ok(draft.tags.includes("gifting"));
    assert.ok(draft.tags.includes("personalized songs"));
  });

  test("detects comparison intent from the title", () => {
    const draft = inferBlogDraftFields({
      body_markdown: [
        "# Personalized song gift vs custom poem gift",
        "",
        "This guide compares when a personalized song gift works better than a custom poem gift and how to choose the right format for the relationship and occasion.",
        "",
        "## Which gift fits each moment?",
        "The answer depends on whether music or reading will carry the emotion better.",
      ].join("\n"),
    });

    assert.equal(draft.target_intent, "comparison");
    assert.match(draft.target_query, /personalized song gift vs custom poem gift/i);
  });

  test("infers keyword, query, and title from body content when no heading is provided", () => {
    const draft = inferBlogDraftFields({
      body_markdown: [
        "Your dad remembers the song that was playing the day you took your first steps. He remembers the drive home from the hospital and the broken AC.",
        "",
        "A personalized song gift for dad works best when the story uses one clear memory, one line he still says, and one emotional truth about what he gave you.",
        "",
        "These gift ideas for parents are strongest when they stay concrete instead of trying to summarize an entire childhood.",
      ].join("\n"),
    });

    assert.equal(draft.title, "Personalized Song Gift Ideas for Dad");
    assert.equal(draft.primary_keyword, "personalized song gift for dad");
    assert.equal(draft.target_query, "personalized song gift for dad");
    assert.ok(!draft.primary_keyword.includes(","));
    assert.ok(draft.tags.includes("gifting"));
  });
});
