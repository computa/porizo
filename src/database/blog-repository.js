"use strict";

function rowsFromQueryResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result?.rows) ? result.rows : [];
}

function createQueryBackedDb(query, parentDb) {
  return {
    isPostgres: Boolean(parentDb?.isPostgres),
    prepare(sql) {
      return {
        async get(...params) {
          const result = await query(sql, params);
          return rowsFromQueryResult(result)[0];
        },
        async all(...params) {
          const result = await query(sql, params);
          return rowsFromQueryResult(result);
        },
        async run(...params) {
          const result = await query(sql, params);
          return {
            changes: Number(result?.rowCount ?? result?.changes ?? 0),
          };
        },
      };
    },
  };
}

function createBlogRepository(db) {
  function postSelectSql() {
    return `
      SELECT
        blog_posts.*,
        CASE
          WHEN blog_posts.status = 'published' OR blog_posts.published_at IS NOT NULL THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM blog_post_revisions AS revisions
            WHERE revisions.post_id = blog_posts.id
              AND revisions.status = 'published'
          ) THEN 1
          ELSE 0
        END AS has_publication_history,
        COALESCE((
          SELECT MAX(revision_number)
          FROM blog_post_revisions AS current_revisions
          WHERE current_revisions.post_id = blog_posts.id
        ), 0) AS current_revision_number
      FROM blog_posts
    `;
  }

  async function listPosts({ status, search, limit = 50, offset = 0 } = {}) {
    let sql = `${postSelectSql()} WHERE 1=1`;
    const params = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (search) {
      sql += " AND (title LIKE ? OR slug LIKE ? OR excerpt LIKE ? OR primary_keyword LIKE ?)";
      const pattern = `%${String(search).trim()}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    sql += " ORDER BY COALESCE(published_at, updated_at) DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function listPublishedPosts({ limit = 100 } = {}) {
    return db.prepare(`
      ${postSelectSql()}
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?
    `).all(limit);
  }

  async function listPublishedSitemapPosts() {
    return db.prepare(`
      SELECT slug, published_at, updated_at
      FROM blog_posts
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
    `).all();
  }

  async function listDraftPostsForDuplicateCheck() {
    return db.prepare(`
      ${postSelectSql()}
      WHERE status = 'draft'
      ORDER BY COALESCE(published_at, updated_at) DESC
    `).all();
  }

  async function findPostById(id) {
    return db.prepare(`${postSelectSql()} WHERE id = ?`).get(id);
  }

  async function findRawPostById(id) {
    return db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id);
  }

  async function findRawPostByIdForUpdate(id) {
    const lockClause = db.isPostgres ? " FOR UPDATE" : "";
    return db.prepare(`SELECT * FROM blog_posts WHERE id = ?${lockClause}`).get(id);
  }

  async function findPublishedPostBySlug(slug) {
    return db.prepare(`
      ${postSelectSql()}
      WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL
      LIMIT 1
    `).get(slug);
  }

  async function findSlugConflict(slug, excludingId = null) {
    return excludingId
      ? db.prepare("SELECT id FROM blog_posts WHERE slug = ? AND id != ?").get(slug, excludingId)
      : db.prepare("SELECT id FROM blog_posts WHERE slug = ?").get(slug);
  }

  async function getNextRevisionNumber(postId) {
    const row = await db.prepare(
      "SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM blog_post_revisions WHERE post_id = ?",
    ).get(postId);
    return Number(row?.max_revision || 0) + 1;
  }

  async function createRevisionSnapshot({
    id,
    post,
    revisionNumber,
    revisionReason,
    createdBy,
    now,
  }) {
    return db.prepare(`
      INSERT INTO blog_post_revisions (
        id, post_id, revision_number, title, slug, excerpt, answer_summary, target_query,
        target_intent, primary_keyword, hero_image_url, body_markdown, tags_json, author_name,
        status, review_status, review_report_json, revision_reason, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      post.id,
      revisionNumber,
      post.title,
      post.slug,
      post.excerpt,
      post.answer_summary,
      post.target_query,
      post.target_intent,
      post.primary_keyword,
      post.hero_image_url,
      post.body_markdown,
      post.tags_json,
      post.author_name,
      post.status,
      post.review_status,
      post.review_report_json || null,
      revisionReason,
      createdBy || null,
      now,
    );
  }

  async function archivePost({ id, updatedBy, now }) {
    return db.prepare(`
        UPDATE blog_posts
        SET status = 'archived', updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(updatedBy || null, now, id);
  }

  async function createPost({ id, post, createdBy, now }) {
    return db.prepare(`
      INSERT INTO blog_posts (
        id, slug, title, excerpt, answer_summary, target_query, target_intent, primary_keyword,
        hero_image_url, body_markdown, tags_json, author_name, status, review_status,
        created_by, updated_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unreviewed', ?, ?, ?, ?)
    `).run(
      id,
      post.slug,
      post.title,
      post.excerpt,
      post.answer_summary,
      post.target_query,
      post.target_intent,
      post.primary_keyword,
      post.hero_image_url,
      post.body_markdown,
      JSON.stringify(post.tags),
      post.author_name,
      createdBy || null,
      createdBy || null,
      now,
      now,
    );
  }

  async function updatePostDraft({
    id,
    post,
    status,
    publishedAt,
    updatedBy,
    now,
  }) {
    return db.prepare(`
      UPDATE blog_posts
      SET slug = ?, title = ?, excerpt = ?, answer_summary = ?, target_query = ?, target_intent = ?,
          primary_keyword = ?, hero_image_url = ?, body_markdown = ?, tags_json = ?, author_name = ?,
          status = ?, published_at = ?, review_status = 'unreviewed', review_report_json = NULL, reviewed_at = NULL,
          updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      post.slug,
      post.title,
      post.excerpt,
      post.answer_summary,
      post.target_query,
      post.target_intent,
      post.primary_keyword,
      post.hero_image_url,
      post.body_markdown,
      JSON.stringify(post.tags),
      post.author_name,
      status,
      publishedAt,
      updatedBy || null,
      now,
      id,
    );
  }

  async function updateReviewResult({
    id,
    reviewStatus,
    reportJson,
    reviewedBy,
    now,
  }) {
    return db.prepare(`
      UPDATE blog_posts
      SET review_status = ?, review_report_json = ?, reviewed_at = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(reviewStatus, reportJson, now, reviewedBy || null, now, id);
  }

  async function createReviewRun({
    id,
    postId,
    revisionNumber,
    report,
    reportJson,
    createdBy,
    now,
  }) {
    return db.prepare(`
      INSERT INTO blog_review_runs (
        id, post_id, revision_number, decision, overall_score, seo_score, geo_score, aeo_score,
        report_json, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      postId,
      revisionNumber,
      report.decision,
      report.overallScore,
      report.seoScore,
      report.geoScore,
      report.aeoScore,
      reportJson,
      createdBy || null,
      now,
    );
  }

  async function publishPost({ id, updatedBy, now }) {
    return db.prepare(`
      UPDATE blog_posts
      SET status = 'published', published_at = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(now, updatedBy || null, now, id);
  }

  async function unpublishPost({ id, updatedBy, now }) {
    return db.prepare(`
      UPDATE blog_posts
      SET status = 'draft', published_at = NULL, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(updatedBy || null, now, id);
  }

  async function transaction(callback) {
    if (typeof db.transaction !== "function") {
      throw new Error("Blog repository mutations require database transaction support");
    }
    return db.transaction(async (query) => {
      const transactionDb = createQueryBackedDb(query, db);
      return callback(createBlogRepository(transactionDb));
    });
  }

  return {
    transaction,
    listPosts,
    listPublishedPosts,
    listPublishedSitemapPosts,
    listDraftPostsForDuplicateCheck,
    findPostById,
    findRawPostById,
    findRawPostByIdForUpdate,
    findPublishedPostBySlug,
    findSlugConflict,
    getNextRevisionNumber,
    createRevisionSnapshot,
    archivePost,
    createPost,
    updatePostDraft,
    updateReviewResult,
    createReviewRun,
    publishPost,
    unpublishPost,
  };
}

module.exports = { createBlogRepository };
