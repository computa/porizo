process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { BlogService } = require("../src/services/blog-service");

function buildPostPayload(overrides = {}) {
  const title = overrides.title || "How to make a personalized song gift feel specific";
  const slug = overrides.slug || "how-to-make-a-personalized-song-gift-feel-specific";
  const primaryKeyword = overrides.primary_keyword || "personalized song gift";

  return {
    title,
    slug,
    excerpt: "A practical guide to turning one real memory into a song gift people remember.",
    answer_summary: "A personalized song gift works best when it starts from one specific memory and explains why that moment matters.",
    target_query: "how to make a personalized song gift",
    target_intent: "informational",
    primary_keyword: primaryKeyword,
    hero_image_url: "https://cdn.porizo.co/blog/personalized-song-gift.jpg",
    body_markdown: [
      `# ${title}`,
      "",
      "A strong personalized song gift starts with a concrete scene, a clear recipient, and one emotional reason the moment matters.",
      "",
      "## What to include",
      "",
      "- The exact occasion.",
      "- One vivid memory.",
      "- A phrase the recipient would recognize.",
    ].join("\n"),
    author_name: "Porizo",
    tags: ["gifting", "personalized songs"],
    ...overrides,
  };
}

function buildApprovedReview(overrides = {}) {
  return {
    decision: "approved",
    overallScore: 96,
    seoScore: 94,
    geoScore: 93,
    aeoScore: 92,
    summary: "Approved for publication.",
    findings: [],
    ...overrides,
  };
}

async function reviewAndPublish(service, postId) {
  await service.saveReviewResult(postId, buildApprovedReview(), "reviewer");
  return service.publishPost(postId, "publisher");
}

function createRollbackProbeRepository() {
  const post = {
    id: "post_rollback_probe",
    slug: "rollback-probe",
    title: "Rollback probe",
    excerpt: "A rollback probe post.",
    answer_summary: "Rollback probe summary.",
    target_query: "rollback probe",
    target_intent: "informational",
    primary_keyword: "rollback probe",
    hero_image_url: null,
    body_markdown: "Rollback probe body.",
    tags_json: "[]",
    author_name: "Porizo",
    status: "draft",
    review_status: "unreviewed",
    review_report_json: null,
  };
  let committed = {
    post: { ...post },
    reviewUpdates: [],
    reviewRuns: [],
    revisions: [
      { post_id: post.id, revision_number: 1 },
      { post_id: post.id, revision_number: 2 },
    ],
  };

  function cloneState(state) {
    return {
      post: { ...state.post },
      reviewUpdates: state.reviewUpdates.map((update) => ({ ...update })),
      reviewRuns: state.reviewRuns.map((run) => ({ ...run })),
      revisions: state.revisions.map((revision) => ({ ...revision })),
    };
  }

  function buildRepository(state) {
    return {
      async transaction(callback) {
        const scopedState = cloneState(committed);
        const result = await callback(buildRepository(scopedState));
        committed = scopedState;
        return result;
      },
      async findRawPostById(id) {
        return id === state.post.id ? { ...state.post } : null;
      },
      async findPostById(id) {
        return id === state.post.id ? { ...state.post, has_publication_history: 0 } : null;
      },
      async getNextRevisionNumber(postId) {
        const maxRevision = state.revisions
          .filter((revision) => revision.post_id === postId)
          .reduce((max, revision) => Math.max(max, revision.revision_number), 0);
        return maxRevision + 1;
      },
      async updateReviewResult(update) {
        state.reviewUpdates.push({ ...update });
        state.post.review_status = update.reviewStatus;
        state.post.review_report_json = update.reportJson;
        state.post.reviewed_at = update.now;
        state.post.updated_by = update.reviewedBy || null;
        state.post.updated_at = update.now;
      },
      async createReviewRun(run) {
        state.reviewRuns.push({ ...run });
      },
      async createRevisionSnapshot() {
        throw new Error("revision snapshot conflict");
      },
      getCommittedState() {
        return cloneState(committed);
      },
    };
  }

  return buildRepository(committed);
}

describe("BlogService", () => {
  let db;
  let service;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    service = new BlogService(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("records revision and review lifecycle in the current sequence", async () => {
    const created = await service.createPost(buildPostPayload(), "creator");
    assert.equal(created.status, "draft");
    assert.equal(created.review_status, "unreviewed");

    const updated = await service.updatePost(
      created.id,
      buildPostPayload({
        title: "How to make a personalized song gift feel unforgettable",
        slug: "how-to-make-a-personalized-song-gift-feel-unforgettable",
      }),
      "editor"
    );
    assert.equal(updated.status, "draft");
    assert.equal(updated.review_status, "unreviewed");

    const reviewed = await service.saveReviewResult(
      created.id,
      buildApprovedReview({
        overallScore: 98,
        seoScore: 97,
        geoScore: 96,
        aeoScore: 95,
      }),
      "reviewer"
    );
    assert.equal(reviewed.review_status, "approved");

    const published = await service.publishPost(created.id, "publisher");
    assert.equal(published.status, "published");
    assert.ok(published.published_at);

    const unpublished = await service.unpublishPost(created.id, "publisher");
    assert.equal(unpublished.status, "draft");
    assert.equal(unpublished.published_at, null);

    const revisions = await db.prepare(`
      SELECT revision_number, revision_reason
      FROM blog_post_revisions
      WHERE post_id = ?
      ORDER BY revision_number ASC
    `).all(created.id);
    assert.deepEqual(
      revisions.map((revision) => revision.revision_reason),
      ["create", "update", "review", "publish", "unpublish"]
    );
    assert.deepEqual(
      revisions.map((revision) => Number(revision.revision_number)),
      [1, 2, 3, 4, 5]
    );

    const reviewRuns = await db.prepare(`
      SELECT revision_number, decision, overall_score, seo_score, geo_score, aeo_score
      FROM blog_review_runs
      WHERE post_id = ?
      ORDER BY created_at ASC
    `).all(created.id);
    assert.equal(reviewRuns.length, 1);
    assert.deepEqual(
      {
        revision_number: Number(reviewRuns[0].revision_number),
        decision: reviewRuns[0].decision,
        overall_score: Number(reviewRuns[0].overall_score),
        seo_score: Number(reviewRuns[0].seo_score),
        geo_score: Number(reviewRuns[0].geo_score),
        aeo_score: Number(reviewRuns[0].aeo_score),
      },
      {
        revision_number: 2,
        decision: "approved",
        overall_score: 98,
        seo_score: 97,
        geo_score: 96,
        aeo_score: 95,
      }
    );
  });

  test("rolls back review status and review run when review revision snapshot fails", async () => {
    const repository = createRollbackProbeRepository();
    const transactionService = new BlogService(null, { repository });

    await assert.rejects(
      () => transactionService.saveReviewResult(
        "post_rollback_probe",
        buildApprovedReview({ overallScore: 91 }),
        "reviewer"
      ),
      /revision snapshot conflict/
    );

    const committed = repository.getCommittedState();
    assert.equal(committed.post.review_status, "unreviewed");
    assert.equal(committed.post.review_report_json, null);
    assert.deepEqual(committed.reviewUpdates, []);
    assert.deepEqual(committed.reviewRuns, []);
  });

  test("records imported post review runs against revision 1 instead of revision 0", async () => {
    db.prepare(`
      INSERT INTO blog_posts (
        id, slug, title, excerpt, answer_summary, target_query, target_intent, primary_keyword,
        body_markdown, tags_json, author_name, status, review_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unreviewed')
    `).run(
      "imported_no_revisions",
      "imported-no-revisions",
      "Imported no revisions",
      "Imported draft without a historical revision.",
      "Imported draft summary.",
      "imported no revisions",
      "informational",
      "imported draft",
      "Imported body.",
      "[]",
      "Porizo"
    );

    await service.saveReviewResult(
      "imported_no_revisions",
      buildApprovedReview(),
      "reviewer"
    );

    const reviewRun = db.prepare(`
      SELECT revision_number
      FROM blog_review_runs
      WHERE post_id = ?
    `).get("imported_no_revisions");
    assert.equal(Number(reviewRun.revision_number), 1);

    const revision = db.prepare(`
      SELECT revision_number, revision_reason
      FROM blog_post_revisions
      WHERE post_id = ?
    `).get("imported_no_revisions");
    assert.deepEqual(
      {
        revision_number: Number(revision.revision_number),
        revision_reason: revision.revision_reason,
      },
      {
        revision_number: 1,
        revision_reason: "review",
      }
    );
  });

  test("rejects review results when the post changed after review started", async () => {
    const created = await service.createPost(buildPostPayload(), "creator");
    assert.equal(created.current_revision_number, 1);

    await service.updatePost(
      created.id,
      buildPostPayload({
        title: "Changed while review was in flight",
        slug: "changed-while-review-was-in-flight",
      }),
      "editor"
    );

    await assert.rejects(
      () => service.saveReviewResult(
        created.id,
        buildApprovedReview(),
        "reviewer",
        { expectedRevisionNumber: created.current_revision_number }
      ),
      /changed during review/i
    );

    const post = await service.getPostById(created.id);
    assert.equal(post.review_status, "unreviewed");
    assert.equal(post.review_report_json, null);

    const reviewRuns = db.prepare(`
      SELECT id
      FROM blog_review_runs
      WHERE post_id = ?
    `).all(created.id);
    assert.equal(reviewRuns.length, 0);
  });

  test("rejects updates when the post changed after a repair started", async () => {
    const created = await service.createPost(buildPostPayload(), "creator");

    await service.updatePost(
      created.id,
      buildPostPayload({
        title: "Human edit while repair was in flight",
        slug: "human-edit-while-repair-was-in-flight",
      }),
      "editor"
    );

    await assert.rejects(
      () => service.updatePost(
        created.id,
        buildPostPayload({
          title: "Stale AI repair draft",
          slug: "stale-ai-repair-draft",
        }),
        "repairer",
        { expectedRevisionNumber: created.current_revision_number }
      ),
      /changed during review/i
    );

    const post = await service.getPostById(created.id);
    assert.equal(post.title, "Human edit while repair was in flight");
    assert.equal(post.slug, "human-edit-while-repair-was-in-flight");
  });

  test("selectors hide edited published posts and preserve publication history", async () => {
    const publishedDraft = await service.createPost(
      buildPostPayload({
        title: "Anniversary song gift guide",
        slug: "anniversary-song-gift-guide",
        primary_keyword: "anniversary song gift",
      }),
      "creator"
    );
    const untouchedDraft = await service.createPost(
      buildPostPayload({
        title: "Mother's Day personalized song ideas",
        slug: "mothers-day-personalized-song-ideas",
        primary_keyword: "mother day song",
        body_markdown: "A Mother's Day song works when it names one memory and one thank-you.",
      }),
      "creator"
    );

    await reviewAndPublish(service, publishedDraft.id);
    assert.deepEqual(
      (await service.listPublishedPosts()).map((post) => post.id),
      [publishedDraft.id]
    );

    const editedDraft = await service.updatePost(
      publishedDraft.id,
      buildPostPayload({
        title: "Anniversary song gift draft refresh",
        slug: "anniversary-song-gift-draft-refresh",
        primary_keyword: "anniversary song gift draft",
      }),
      "editor"
    );
    assert.equal(editedDraft.status, "draft");

    const publishedPosts = await service.listPublishedPosts();
    assert.equal(publishedPosts.some((post) => post.id === editedDraft.id), false);
    assert.equal(await service.getPublishedPostBySlug(editedDraft.slug), null);

    const fetchedDraft = await service.getPostById(editedDraft.id);
    assert.equal(fetchedDraft.status, "draft");
    assert.equal(fetchedDraft.published_at, null);
    assert.equal(fetchedDraft.review_status, "unreviewed");
    assert.equal(fetchedDraft.has_publication_history, true);

    const draftIds = new Set((await service.listPosts({ status: "draft" })).map((post) => post.id));
    assert.equal(draftIds.has(editedDraft.id), true);
    assert.equal(draftIds.has(untouchedDraft.id), true);

    const titleMatches = await service.listPosts({ search: "draft refresh" });
    assert.equal(titleMatches.some((post) => post.id === editedDraft.id), true);

    const slugMatches = await service.listPosts({ search: "mothers-day" });
    assert.equal(slugMatches.some((post) => post.id === untouchedDraft.id), true);

    const keywordMatches = await service.listPosts({ search: "anniversary song gift draft" });
    assert.equal(keywordMatches.some((post) => post.id === editedDraft.id), true);
  });

  test("reuses duplicate drafts beyond the admin list page size", async () => {
    const oldDuplicateBody = "One very specific memory about a custom birthday song gift that should be reused.";
    db.prepare(`
      INSERT INTO blog_posts (
        id, slug, title, excerpt, answer_summary, target_query, target_intent, primary_keyword,
        body_markdown, tags_json, author_name, status, review_status, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unreviewed', ?)
    `).run(
      "old_duplicate_draft",
      "old-duplicate-draft",
      "Old duplicate draft",
      "Old duplicate draft.",
      "Old duplicate summary.",
      "old duplicate draft",
      "informational",
      "birthday song gift",
      oldDuplicateBody,
      "[]",
      "Porizo",
      "2026-01-01T00:00:00.000Z"
    );

    for (let index = 0; index < 100; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const hour = String(Math.floor(index / 60)).padStart(2, "0");
      const minute = String(index % 60).padStart(2, "0");
      db.prepare(`
        INSERT INTO blog_posts (
          id, slug, title, excerpt, answer_summary, target_query, target_intent, primary_keyword,
          body_markdown, tags_json, author_name, status, review_status, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unreviewed', ?)
      `).run(
        `newer_draft_${suffix}`,
        `newer-draft-${suffix}`,
        `Newer draft ${suffix}`,
        `Newer draft ${suffix}.`,
        `Newer summary ${suffix}.`,
        `newer draft ${suffix}`,
        "informational",
        `newer keyword ${suffix}`,
        `Distinct newer body ${suffix}.`,
        "[]",
        "Porizo",
        `2026-01-02T${hour}:${minute}:00.000Z`
      );
    }

    const reused = await service.createPost(
      buildPostPayload({
        title: "Fresh duplicate draft",
        slug: "fresh-duplicate-draft",
        primary_keyword: "birthday song gift",
        body_markdown: oldDuplicateBody,
      }),
      "creator"
    );

    assert.equal(reused.id, "old_duplicate_draft");
    assert.equal(reused.slug, "fresh-duplicate-draft");

    const duplicateRows = db.prepare(`
      SELECT id
      FROM blog_posts
      WHERE body_markdown = ?
        AND status = 'draft'
      ORDER BY id ASC
    `).all(oldDuplicateBody);
    assert.deepEqual(duplicateRows.map((row) => row.id), ["old_duplicate_draft"]);
  });
});
