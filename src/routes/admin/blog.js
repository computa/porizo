"use strict";

const { normalizePostInput } = require("../../services/blog-service");
const { inferBlogDraftFields } = require("../../services/blog-autofill-service");
const { reviewBlogDraft } = require("../../services/blog-review-service");
const {
  generateEditorialReview,
} = require("../../services/blog-editorial-review-service");
const blogRepairService = require("../../services/blog-repair-service");
const { renderBlogPostPage } = require("../../services/blog-render-service");
const { nowIso } = require("../../utils/common");

const BLOG_TARGET_INTENTS = [
  "informational",
  "commercial",
  "comparison",
  "navigational",
];

function validateBlogPayload(sendError, payload, reply, { requireBody = false } = {}) {
  const normalized = normalizePostInput(payload || {});
  if (!normalized.title) {
    sendError(reply, 400, "MISSING_TITLE", "Title is required");
    return null;
  }
  if (!normalized.slug) {
    sendError(reply, 400, "MISSING_SLUG", "Slug is required");
    return null;
  }
  if (normalized.title.length > 160) {
    sendError(
      reply,
      400,
      "TITLE_TOO_LONG",
      "Title must not exceed 160 characters",
    );
    return null;
  }
  if (normalized.slug.length > 160) {
    sendError(
      reply,
      400,
      "SLUG_TOO_LONG",
      "Slug must not exceed 160 characters",
    );
    return null;
  }
  if (normalized.excerpt.length > 300) {
    sendError(
      reply,
      400,
      "EXCERPT_TOO_LONG",
      "Excerpt must not exceed 300 characters",
    );
    return null;
  }
  if (normalized.answer_summary.length > 600) {
    sendError(
      reply,
      400,
      "SUMMARY_TOO_LONG",
      "Answer summary must not exceed 600 characters",
    );
    return null;
  }
  if (normalized.target_query.length > 240) {
    sendError(
      reply,
      400,
      "TARGET_QUERY_TOO_LONG",
      "Target query must not exceed 240 characters",
    );
    return null;
  }
  if (normalized.primary_keyword.length > 120) {
    sendError(
      reply,
      400,
      "PRIMARY_KEYWORD_TOO_LONG",
      "Primary keyword must not exceed 120 characters",
    );
    return null;
  }
  if (normalized.author_name.length > 120) {
    sendError(
      reply,
      400,
      "AUTHOR_NAME_TOO_LONG",
      "Author name must not exceed 120 characters",
    );
    return null;
  }
  if (!BLOG_TARGET_INTENTS.includes(normalized.target_intent)) {
    sendError(
      reply,
      400,
      "INVALID_TARGET_INTENT",
      `Target intent must be one of: ${BLOG_TARGET_INTENTS.join(", ")}`,
    );
    return null;
  }
  if (requireBody && normalized.body_markdown.trim().length === 0) {
    sendError(reply, 400, "MISSING_BODY", "Body markdown is required");
    return null;
  }
  return normalized;
}

function registerAdminBlogRoutes(
  app,
  {
    appConfig,
    adminService,
    blogService,
    parsePagination,
    requireAdminSession,
    sendError,
  },
) {
  app.get("/admin/dashboard/blog/posts", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, search } = request.query || {};
    const { limit, offset } = parsePagination(request.query, 25);
    const posts = await blogService.listPosts({
      status,
      search,
      limit,
      offset,
    });
    reply.send({ posts, limit, offset });
  });

  app.post("/admin/dashboard/blog/posts/autofill", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const bodyMarkdown = String(request.body?.body_markdown || "").trim();
    if (!bodyMarkdown) {
      return sendError(
        reply,
        400,
        "MISSING_BODY",
        "Body markdown is required to infer blog metadata",
      );
    }

    const draft = inferBlogDraftFields({
      title: request.body?.title || "",
      body_markdown: bodyMarkdown,
    });

    reply.send({ draft });
  });

  app.get("/admin/dashboard/blog/posts/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const post = await blogService.getPostById(request.params.id);
    if (!post) {
      return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
    }
    reply.send({ post });
  });

  app.post("/admin/dashboard/blog/posts", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const normalized = validateBlogPayload(
      sendError,
      {
        ...request.body,
        author_name:
          request.body?.author_name || admin.displayName || admin.email,
      },
      reply,
      { requireBody: true },
    );
    if (!normalized) return;

    try {
      const post = await blogService.createPost(normalized, admin.adminId);
      await adminService._audit(
        admin.adminId,
        "blog_post_create",
        "blog_post",
        post.id,
        {
          slug: post.slug,
          title: post.title,
        },
      );
      reply.send({ post });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create blog post";
      const code = /slug already exists/i.test(message)
        ? "SLUG_CONFLICT"
        : "BAD_REQUEST";
      sendError(reply, code === "SLUG_CONFLICT" ? 409 : 400, code, message);
    }
  });

  app.put("/admin/dashboard/blog/posts/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const normalized = validateBlogPayload(
      sendError,
      {
        ...request.body,
        author_name:
          request.body?.author_name || admin.displayName || admin.email,
      },
      reply,
      { requireBody: true },
    );
    if (!normalized) return;

    try {
      const post = await blogService.updatePost(
        request.params.id,
        normalized,
        admin.adminId,
      );
      if (!post) {
        return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
      }
      await adminService._audit(
        admin.adminId,
        "blog_post_update",
        "blog_post",
        post.id,
        {
          slug: post.slug,
          title: post.title,
        },
      );
      reply.send({ post });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update blog post";
      const code = /slug already exists/i.test(message)
        ? "SLUG_CONFLICT"
        : "BAD_REQUEST";
      sendError(reply, code === "SLUG_CONFLICT" ? 409 : 400, code, message);
    }
  });

  app.post("/admin/dashboard/blog/posts/preview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const normalized = validateBlogPayload(
      sendError,
      {
        ...request.body,
        slug: request.body?.slug || "preview-post",
        author_name:
          request.body?.author_name || admin.displayName || admin.email,
      },
      reply,
    );
    if (!normalized) return;

    const previewPost = {
      ...normalized,
      id: "preview",
      tags: normalized.tags,
      published_at: nowIso(),
      updated_at: nowIso(),
    };
    const siteOrigin =
      appConfig.PUBLIC_BASE_URL ||
      appConfig.STREAM_BASE_URL ||
      "https://porizo.co";
    reply.send({ html: renderBlogPostPage(previewPost, { siteOrigin }) });
  });

  app.post("/admin/dashboard/blog/posts/:id/review", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const post = await blogService.getPostById(request.params.id);
    if (!post) {
      return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
    }
    const reviewedRevisionNumber = post.current_revision_number;
    const report = reviewBlogDraft(post);
    report.editorial_review = await generateEditorialReview(post, report);
    let updated;
    try {
      updated = await blogService.saveReviewResult(
        post.id,
        report,
        admin.adminId,
        { expectedRevisionNumber: reviewedRevisionNumber },
      );
    } catch (error) {
      if (error?.code === "BLOG_POST_CHANGED") {
        return sendError(reply, 409, "BLOG_POST_CHANGED", error.message);
      }
      throw error;
    }
    await adminService._audit(
      admin.adminId,
      "blog_post_review",
      "blog_post",
      post.id,
      {
        decision: report.decision,
        overall_score: report.overallScore,
        editorial_status: report.editorial_review?.status || null,
      },
    );
    reply.send({ post: updated, report });
  });

  app.post("/admin/dashboard/blog/posts/:id/repair", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const post = await blogService.getPostById(request.params.id);
    if (!post) {
      return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
    }
    const sourceRevisionNumber = post.current_revision_number;

    let reviewReport = post.review_report || reviewBlogDraft(post);
    if (!reviewReport.editorial_review) {
      reviewReport.editorial_review = await generateEditorialReview(
        post,
        reviewReport,
      );
    }

    const repairResult = await blogRepairService.generateBlogRepairDraft(
      post,
      reviewReport,
    );
    if (repairResult.status !== "available" || !repairResult.draft) {
      const message =
        repairResult.error ||
        repairResult.summary ||
        "AI draft repair is unavailable right now.";
      return sendError(reply, 503, "BLOG_REPAIR_UNAVAILABLE", message);
    }

    const normalized = validateBlogPayload(
      sendError,
      {
        ...repairResult.draft,
        author_name:
          repairResult.draft.author_name ||
          post.author_name ||
          admin.displayName ||
          admin.email,
      },
      reply,
      { requireBody: true },
    );
    if (!normalized) return;

    try {
      const repairedPost = await blogService.updatePost(
        request.params.id,
        normalized,
        admin.adminId,
        { expectedRevisionNumber: sourceRevisionNumber },
      );
      if (!repairedPost) {
        return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
      }

      await adminService._audit(
        admin.adminId,
        "blog_post_repair_draft_applied",
        "blog_post",
        repairedPost.id,
        {
          slug: repairedPost.slug,
          source_revision_number: sourceRevisionNumber,
          repaired_revision_number: repairedPost.current_revision_number,
          repair_provider: repairResult.provider,
          repair_model: repairResult.model,
        },
      );

      const repairedReport = reviewBlogDraft(repairedPost);
      const repairedRevisionNumber = repairedPost.current_revision_number;
      repairedReport.editorial_review = await generateEditorialReview(
        repairedPost,
        repairedReport,
      );
      const updated = await blogService.saveReviewResult(
        repairedPost.id,
        repairedReport,
        admin.adminId,
        { expectedRevisionNumber: repairedRevisionNumber },
      );

      await adminService._audit(
        admin.adminId,
        "blog_post_repair",
        "blog_post",
        repairedPost.id,
        {
          slug: repairedPost.slug,
          review_score_before: reviewReport.overallScore,
          review_score_after: repairedReport.overallScore,
          repair_provider: repairResult.provider,
          repair_model: repairResult.model,
        },
      );

      reply.send({
        post: updated,
        repair: {
          summary: repairResult.summary,
          provider: repairResult.provider,
          model: repairResult.model,
          before: reviewReport,
          after: repairedReport,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to repair blog draft";
      const code = error?.code === "BLOG_POST_CHANGED"
        ? "BLOG_POST_CHANGED"
        : "BLOG_REPAIR_FAILED";
      sendError(reply, code === "BLOG_POST_CHANGED" ? 409 : 400, code, message);
    }
  });

  app.post(
    "/admin/dashboard/blog/posts/:id/publish",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      try {
        const post = await blogService.publishPost(
          request.params.id,
          admin.adminId,
        );
        if (!post) {
          return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
        }
        await adminService._audit(
          admin.adminId,
          "blog_post_publish",
          "blog_post",
          post.id,
          {
            slug: post.slug,
            published_at: post.published_at,
          },
        );
        reply.send({ post });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to publish blog post";
        sendError(reply, 400, "PUBLISH_BLOCKED", message);
      }
    },
  );

  app.post(
    "/admin/dashboard/blog/posts/:id/unpublish",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const post = await blogService.unpublishPost(
        request.params.id,
        admin.adminId,
      );
      if (!post) {
        return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
      }
      await adminService._audit(
        admin.adminId,
        "blog_post_unpublish",
        "blog_post",
        post.id,
        {
          slug: post.slug,
        },
      );
      reply.send({ post });
    },
  );
}

module.exports = { registerAdminBlogRoutes };
