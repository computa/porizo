const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  pickRelatedPosts,
  landingForPost,
} = require("../src/services/blog-render-service");

const POSTS = [
  {
    slug: "anniversary-song-gift",
    title: "Anniversary",
    tags: ["anniversary", "gift"],
    published_at: "2026-05-10",
  },
  {
    slug: "birthday-song-gift-ideas",
    title: "Birthday ideas",
    tags: ["birthday", "gift"],
    published_at: "2026-05-09",
  },
  {
    slug: "memorial-song-gift",
    title: "Memorial",
    tags: ["memorial"],
    published_at: "2026-05-08",
  },
  {
    slug: "why-personalized-song-gift-is-better",
    title: "Why better",
    tags: ["gift"],
    published_at: "2026-04-12",
  },
  {
    slug: "why-personalized-song-gift-hits-harder-than-any-present",
    title: "Why harder",
    tags: ["gift"],
    published_at: "2026-04-11",
  },
];

describe("blog related posts", () => {
  test("ranks by shared-tag overlap, excludes self", () => {
    const self = POSTS[0]; // anniversary, tags [anniversary, gift]
    const related = pickRelatedPosts(self, POSTS, 3);
    assert.ok(!related.some((p) => p.slug === self.slug), "excludes self");
    // birthday-song-gift-ideas shares 'gift' (1) — should rank above memorial (0).
    assert.equal(related[0].slug, "birthday-song-gift-ideas");
  });

  test("does NOT cross-link the cannibalizing 'why' cluster to itself", () => {
    const self = POSTS[3]; // a 'why' post
    const related = pickRelatedPosts(self, POSTS, 3);
    const otherWhy = related.find(
      (p) =>
        p.slug === "why-personalized-song-gift-hits-harder-than-any-present",
    );
    assert.equal(otherWhy, undefined, "must not suggest a sibling 'why' post");
  });

  test("non-'why' posts may still link to a 'why' post", () => {
    const self = POSTS[1]; // birthday, tags [birthday, gift]
    const related = pickRelatedPosts(self, POSTS, 5);
    assert.ok(
      related.some((p) => p.slug === "why-personalized-song-gift-is-better"),
      "a 'why' post (shares 'gift') is a valid related read for a non-why post",
    );
  });

  test("landingForPost maps occasion slugs to the right landing page", () => {
    assert.equal(
      landingForPost({ slug: "fathers-day-song-gift-personalized" }).href,
      "/fathers-day-song",
    );
    assert.equal(
      landingForPost({ slug: "anniversary-song-gift" }).href,
      "/anniversary-song-gift",
    );
    assert.equal(
      landingForPost({ slug: "birthday-song-for-dad" }).href,
      "/fathers-day-song",
    ); // dad wins (rule order)
    assert.equal(
      landingForPost({ slug: "wedding-song-gift" }).href,
      "/wedding-song-gift",
    );
    assert.equal(
      landingForPost({ slug: "some-random-post" }).href,
      "/custom-song-gift",
    ); // default
  });
});
