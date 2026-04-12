"use strict";

const { newUuid } = require("../utils/ids");
const { stripMarkdown } = require("./blog-format-service");

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createBodyFingerprint(markdown) {
  return normalizeComparableText(stripMarkdown(markdown)).slice(0, 280);
}

function createTitleFingerprint(title) {
  return normalizeComparableText(title);
}

function countSharedPrefixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function tokenOverlapRatio(left, right) {
  const leftTokens = new Set(createTitleFingerprint(left).split(" ").filter(Boolean));
  const rightTokens = new Set(createTitleFingerprint(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function postsAreDuplicateDrafts(existing, incoming) {
  const existingSlug = slugify(existing?.slug || existing?.title || "");
  const incomingSlug = slugify(incoming?.slug || incoming?.title || "");
  if (existingSlug && incomingSlug && existingSlug === incomingSlug) {
    return true;
  }

  const existingBody = createBodyFingerprint(existing?.body_markdown || "");
  const incomingBody = createBodyFingerprint(incoming?.body_markdown || "");
  if (existingBody && incomingBody && existingBody === incomingBody) {
    return true;
  }

  const sharedPrefix = countSharedPrefixLength(existingBody, incomingBody);
  const overlap = tokenOverlapRatio(existing?.title || "", incoming?.title || "");
  return sharedPrefix >= 140 && overlap >= 0.7;
}

function normalizePostInput(input) {
  const title = String(input?.title || "").trim();
  const inferredSlug = slugify(title);
  const slug = slugify(input?.slug || inferredSlug);
  return {
    title,
    slug,
    excerpt: String(input?.excerpt || "").trim(),
    answer_summary: String(input?.answer_summary || "").trim(),
    target_query: String(input?.target_query || "").trim(),
    target_intent: String(input?.target_intent || "informational").trim() || "informational",
    primary_keyword: String(input?.primary_keyword || "").trim(),
    hero_image_url: String(input?.hero_image_url || "").trim() || null,
    body_markdown: String(input?.body_markdown || ""),
    tags: normalizeTags(input?.tags),
    author_name: String(input?.author_name || "").trim(),
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

class BlogService {
  constructor(db) {
    this.db = db;
  }

  postSelectSql() {
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
        END AS has_publication_history
      FROM blog_posts
    `;
  }

  mapPostRow(row) {
    if (!row) return null;
    return {
      ...row,
      tags: parseJsonArray(row.tags_json),
      review_report: parseJsonObject(row.review_report_json),
      has_publication_history: Boolean(row.has_publication_history),
    };
  }

  async listPosts({ status, search, limit = 50, offset = 0 } = {}) {
    let sql = `${this.postSelectSql()} WHERE 1=1`;
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

    const rows = await this.db.prepare(sql).all(...params);
    return rows.map((row) => this.mapPostRow(row));
  }

  async listPublishedPosts({ limit = 100 } = {}) {
    const rows = await this.db.prepare(`
      ${this.postSelectSql()}
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map((row) => this.mapPostRow(row));
  }

  async getPostById(id) {
    const row = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    return this.mapPostRow(row);
  }

  async getPublishedPostBySlug(slug) {
    const row = await this.db.prepare(`
      ${this.postSelectSql()}
      WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL
      LIMIT 1
    `).get(slug);
    return this.mapPostRow(row);
  }

  async assertSlugAvailable(slug, excludingId = null) {
    const existing = excludingId
      ? await this.db.prepare("SELECT id FROM blog_posts WHERE slug = ? AND id != ?").get(slug, excludingId)
      : await this.db.prepare("SELECT id FROM blog_posts WHERE slug = ?").get(slug);
    if (existing) {
      throw new Error("Slug already exists");
    }
  }

  async getNextRevisionNumber(postId) {
    const row = await this.db.prepare(
      "SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM blog_post_revisions WHERE post_id = ?"
    ).get(postId);
    return Number(row?.max_revision || 0) + 1;
  }

  async createRevisionSnapshot(post, createdBy, revisionReason) {
    const revisionNumber = await this.getNextRevisionNumber(post.id);
    await this.db.prepare(`
      INSERT INTO blog_post_revisions (
        id, post_id, revision_number, title, slug, excerpt, answer_summary, target_query,
        target_intent, primary_keyword, hero_image_url, body_markdown, tags_json, author_name,
        status, review_status, review_report_json, revision_reason, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newUuid(),
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
      nowIso()
    );
    return revisionNumber;
  }

  async findReusableDraft(input) {
    const drafts = await this.listPosts({ status: "draft", limit: 100, offset: 0 });
    return drafts.find((draft) => postsAreDuplicateDrafts(draft, input)) || null;
  }

  async archiveDuplicateDrafts(canonicalPost, updatedBy) {
    const drafts = await this.listPosts({ status: "draft", limit: 100, offset: 0 });
    const duplicates = drafts.filter((draft) => {
      if (draft.id === canonicalPost.id) return false;
      return postsAreDuplicateDrafts(draft, canonicalPost);
    });

    if (duplicates.length === 0) return;

    const now = nowIso();
    for (const duplicate of duplicates) {
      await this.db.prepare(`
        UPDATE blog_posts
        SET status = 'archived', updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(updatedBy || null, now, duplicate.id);
    }
  }

  async createPost(input, createdBy) {
    const post = normalizePostInput(input);
    if (!post.title) throw new Error("Title is required");
    if (!post.slug) throw new Error("Slug is required");
    const reusableDraft = await this.findReusableDraft(post);
    if (reusableDraft) {
      return this.updatePost(reusableDraft.id, post, createdBy);
    }
    await this.assertSlugAvailable(post.slug);

    const id = newUuid();
    const now = nowIso();
    await this.db.prepare(`
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
      now
    );

    const created = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    await this.createRevisionSnapshot(created, createdBy, "create");
    return this.mapPostRow(created);
  }

  async updatePost(id, input, updatedBy) {
    const existing = await this.db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id);
    if (!existing) return null;

    const next = normalizePostInput({ ...existing, ...input, tags: input?.tags ?? parseJsonArray(existing.tags_json) });
    if (!next.title) throw new Error("Title is required");
    if (!next.slug) throw new Error("Slug is required");
    await this.assertSlugAvailable(next.slug, id);

    const now = nowIso();
    const nextStatus = existing.status === "published" ? "draft" : existing.status;
    const nextPublishedAt = nextStatus === "published" ? existing.published_at : null;
    await this.db.prepare(`
      UPDATE blog_posts
      SET slug = ?, title = ?, excerpt = ?, answer_summary = ?, target_query = ?, target_intent = ?,
          primary_keyword = ?, hero_image_url = ?, body_markdown = ?, tags_json = ?, author_name = ?,
          status = ?, published_at = ?, review_status = 'unreviewed', review_report_json = NULL, reviewed_at = NULL,
          updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.slug,
      next.title,
      next.excerpt,
      next.answer_summary,
      next.target_query,
      next.target_intent,
      next.primary_keyword,
      next.hero_image_url,
      next.body_markdown,
      JSON.stringify(next.tags),
      next.author_name,
      nextStatus,
      nextPublishedAt,
      updatedBy || null,
      now,
      id
    );

    const updated = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    await this.createRevisionSnapshot(updated, updatedBy, "update");
    const mapped = this.mapPostRow(updated);
    await this.archiveDuplicateDrafts(mapped, updatedBy);
    return this.getPostById(id);
  }

  async saveReviewResult(id, report, reviewedBy) {
    const existing = await this.db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id);
    if (!existing) return null;

    const now = nowIso();
    const nextReviewStatus = report.decision === "approved" ? "approved" : "rejected";
    await this.db.prepare(`
      UPDATE blog_posts
      SET review_status = ?, review_report_json = ?, reviewed_at = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(nextReviewStatus, JSON.stringify(report), now, reviewedBy || null, now, id);

    const revisionNumber = await this.getNextRevisionNumber(id);
    await this.db.prepare(`
      INSERT INTO blog_review_runs (
        id, post_id, revision_number, decision, overall_score, seo_score, geo_score, aeo_score,
        report_json, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newUuid(),
      id,
      revisionNumber - 1,
      report.decision,
      report.overallScore,
      report.seoScore,
      report.geoScore,
      report.aeoScore,
      JSON.stringify(report),
      reviewedBy || null,
      now
    );

    const updated = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    await this.createRevisionSnapshot(updated, reviewedBy, "review");
    return this.mapPostRow(updated);
  }

  async publishPost(id, updatedBy) {
    const existing = await this.db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id);
    if (!existing) return null;
    if (existing.review_status !== "approved") {
      throw new Error("Post must pass review before publishing");
    }

    const now = nowIso();
    await this.db.prepare(`
      UPDATE blog_posts
      SET status = 'published', published_at = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(now, updatedBy || null, now, id);

    const updated = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    await this.createRevisionSnapshot(updated, updatedBy, "publish");
    return this.mapPostRow(updated);
  }

  async unpublishPost(id, updatedBy) {
    const existing = await this.db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id);
    if (!existing) return null;

    const now = nowIso();
    await this.db.prepare(`
      UPDATE blog_posts
      SET status = 'draft', published_at = NULL, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(updatedBy || null, now, id);

    const updated = await this.db.prepare(`${this.postSelectSql()} WHERE id = ?`).get(id);
    await this.createRevisionSnapshot(updated, updatedBy, "unpublish");
    return this.mapPostRow(updated);
  }
}

module.exports = {
  BlogService,
  slugify,
  normalizePostInput,
};
