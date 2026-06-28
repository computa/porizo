"use strict";

const { newUuid } = require("../utils/ids");
const { createBlogRepository } = require("../database/blog-repository");
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

function createBlogPostChangedError() {
  const error = new Error("Blog post changed during review; rerun review before saving the result.");
  error.code = "BLOG_POST_CHANGED";
  error.statusCode = 409;
  return error;
}

class BlogService {
  constructor(db, options = {}) {
    this.db = db;
    this.repository = options.repository || createBlogRepository(db);
  }

  mapPostRow(row) {
    if (!row) return null;
    return {
      ...row,
      tags: parseJsonArray(row.tags_json),
      review_report: parseJsonObject(row.review_report_json),
      has_publication_history: Boolean(row.has_publication_history),
      current_revision_number: Number(row.current_revision_number || 0),
    };
  }

  async listPosts({ status, search, limit = 50, offset = 0 } = {}) {
    const rows = await this.repository.listPosts({ status, search, limit, offset });
    return rows.map((row) => this.mapPostRow(row));
  }

  async listPublishedPosts({ limit = 100 } = {}) {
    const rows = await this.repository.listPublishedPosts({ limit });
    return rows.map((row) => this.mapPostRow(row));
  }

  async getPostById(id) {
    const row = await this.repository.findPostById(id);
    return this.mapPostRow(row);
  }

  async getPublishedPostBySlug(slug) {
    const row = await this.repository.findPublishedPostBySlug(slug);
    return this.mapPostRow(row);
  }

  async withBlogTransaction(callback) {
    if (typeof this.repository.transaction === "function") {
      return this.repository.transaction(callback);
    }
    throw new Error("BlogService mutations require repository transaction support");
  }

  async findRawPostByIdForMutation(repository, id) {
    if (typeof repository.findRawPostByIdForUpdate === "function") {
      return repository.findRawPostByIdForUpdate(id);
    }
    return repository.findRawPostById(id);
  }

  async assertSlugAvailable(slug, excludingId = null, repository = this.repository) {
    const existing = await repository.findSlugConflict(slug, excludingId);
    if (existing) {
      throw new Error("Slug already exists");
    }
  }

  async getNextRevisionNumber(postId, repository = this.repository) {
    return repository.getNextRevisionNumber(postId);
  }

  async getCurrentRevisionNumber(postId, repository = this.repository) {
    const nextRevisionNumber = await this.getNextRevisionNumber(postId, repository);
    return Math.max(0, Number(nextRevisionNumber || 1) - 1);
  }

  async createRevisionSnapshot(
    post,
    createdBy,
    revisionReason,
    repository = this.repository,
    now = nowIso()
  ) {
    const revisionNumber = await this.getNextRevisionNumber(post.id, repository);
    await repository.createRevisionSnapshot({
      id: newUuid(),
      post,
      revisionNumber,
      revisionReason,
      createdBy,
      now,
    });
    return revisionNumber;
  }

  async findReusableDraft(input, repository = this.repository) {
    const rows = typeof repository.listDraftPostsForDuplicateCheck === "function"
      ? await repository.listDraftPostsForDuplicateCheck()
      : await repository.listPosts({ status: "draft", limit: 100, offset: 0 });
    const drafts = rows.map((row) => this.mapPostRow(row));
    return drafts.find((draft) => postsAreDuplicateDrafts(draft, input)) || null;
  }

  async archiveDuplicateDrafts(canonicalPost, updatedBy, repository = this.repository, now = nowIso()) {
    const rows = typeof repository.listDraftPostsForDuplicateCheck === "function"
      ? await repository.listDraftPostsForDuplicateCheck()
      : await repository.listPosts({ status: "draft", limit: 100, offset: 0 });
    const drafts = rows.map((row) => this.mapPostRow(row));
    const duplicates = drafts.filter((draft) => {
      if (draft.id === canonicalPost.id) return false;
      return postsAreDuplicateDrafts(draft, canonicalPost);
    });

    if (duplicates.length === 0) return;

    for (const duplicate of duplicates) {
      await repository.archivePost({
        id: duplicate.id,
        updatedBy,
        now,
      });
    }
  }

  async createPost(input, createdBy) {
    const post = normalizePostInput(input);
    if (!post.title) throw new Error("Title is required");
    if (!post.slug) throw new Error("Slug is required");

    return this.withBlogTransaction(async (repository) => {
      const reusableDraft = await this.findReusableDraft(post, repository);
      if (reusableDraft) {
        return this.updatePostWithRepository(repository, reusableDraft.id, post, createdBy);
      }
      await this.assertSlugAvailable(post.slug, null, repository);

      const id = newUuid();
      const now = nowIso();
      await repository.createPost({
        id,
        post,
        createdBy,
        now,
      });

      const created = await repository.findPostById(id);
      await this.createRevisionSnapshot(created, createdBy, "create", repository, now);
      return this.mapPostRow(await repository.findPostById(id));
    });
  }

  async updatePostWithRepository(repository, id, input, updatedBy, options = {}) {
    const existing = await this.findRawPostByIdForMutation(repository, id);
    if (!existing) return null;

    const currentRevisionNumber = await this.getCurrentRevisionNumber(id, repository);
    if (
      options.expectedRevisionNumber !== undefined &&
      Number(options.expectedRevisionNumber) !== currentRevisionNumber
    ) {
      throw createBlogPostChangedError();
    }

    const next = normalizePostInput({ ...existing, ...input, tags: input?.tags ?? parseJsonArray(existing.tags_json) });
    if (!next.title) throw new Error("Title is required");
    if (!next.slug) throw new Error("Slug is required");
    await this.assertSlugAvailable(next.slug, id, repository);

    const now = nowIso();
    const nextStatus = existing.status === "published" ? "draft" : existing.status;
    const nextPublishedAt = nextStatus === "published" ? existing.published_at : null;
    await repository.updatePostDraft({
      id,
      post: next,
      status: nextStatus,
      publishedAt: nextPublishedAt,
      updatedBy,
      now,
    });

    const updated = await repository.findPostById(id);
    await this.createRevisionSnapshot(updated, updatedBy, "update", repository, now);
    const mapped = this.mapPostRow(updated);
    await this.archiveDuplicateDrafts(mapped, updatedBy, repository, now);
    return this.mapPostRow(await repository.findPostById(id));
  }

  async updatePost(id, input, updatedBy, options = {}) {
    return this.withBlogTransaction((repository) => (
      this.updatePostWithRepository(repository, id, input, updatedBy, options)
    ));
  }

  async saveReviewResultWithRepository(repository, id, report, reviewedBy, options = {}) {
    const existing = await this.findRawPostByIdForMutation(repository, id);
    if (!existing) return null;

    const now = nowIso();
    const currentRevisionNumber = await this.getCurrentRevisionNumber(id, repository);
    if (
      options.expectedRevisionNumber !== undefined &&
      Number(options.expectedRevisionNumber) !== currentRevisionNumber
    ) {
      throw createBlogPostChangedError();
    }

    const nextReviewStatus = report.decision === "approved" ? "approved" : "rejected";
    const reportJson = JSON.stringify(report);
    await repository.updateReviewResult({
      id,
      reviewStatus: nextReviewStatus,
      reportJson,
      reviewedBy,
      now,
    });

    await repository.createReviewRun({
      id: newUuid(),
      postId: id,
      revisionNumber: Math.max(1, currentRevisionNumber),
      report,
      reportJson,
      createdBy: reviewedBy,
      now,
    });

    const updated = await repository.findPostById(id);
    await this.createRevisionSnapshot(updated, reviewedBy, "review", repository, now);
    return this.mapPostRow(await repository.findPostById(id));
  }

  async saveReviewResult(id, report, reviewedBy, options = {}) {
    return this.withBlogTransaction((repository) => (
      this.saveReviewResultWithRepository(repository, id, report, reviewedBy, options)
    ));
  }

  async publishPostWithRepository(repository, id, updatedBy) {
    const existing = await this.findRawPostByIdForMutation(repository, id);
    if (!existing) return null;
    if (existing.review_status !== "approved") {
      throw new Error("Post must pass review before publishing");
    }

    const now = nowIso();
    await repository.publishPost({
      id,
      updatedBy,
      now,
    });

    const updated = await repository.findPostById(id);
    await this.createRevisionSnapshot(updated, updatedBy, "publish", repository, now);
    return this.mapPostRow(await repository.findPostById(id));
  }

  async publishPost(id, updatedBy) {
    return this.withBlogTransaction((repository) => (
      this.publishPostWithRepository(repository, id, updatedBy)
    ));
  }

  async unpublishPostWithRepository(repository, id, updatedBy) {
    const existing = await this.findRawPostByIdForMutation(repository, id);
    if (!existing) return null;

    const now = nowIso();
    await repository.unpublishPost({
      id,
      updatedBy,
      now,
    });

    const updated = await repository.findPostById(id);
    await this.createRevisionSnapshot(updated, updatedBy, "unpublish", repository, now);
    return this.mapPostRow(await repository.findPostById(id));
  }

  async unpublishPost(id, updatedBy) {
    return this.withBlogTransaction((repository) => (
      this.unpublishPostWithRepository(repository, id, updatedBy)
    ));
  }
}

module.exports = {
  BlogService,
  slugify,
  normalizePostInput,
};
