"use strict";

const fs = require("fs");
const path = require("path");
const {
  AdminService,
  escapeLikePattern,
} = require("../services/admin-service");
const { AdminGiftOpsService } = require("../services/admin-gift-ops-service");
const { BlogService, normalizePostInput } = require("../services/blog-service");
const { inferBlogDraftFields } = require("../services/blog-autofill-service");
const { reviewBlogDraft } = require("../services/blog-review-service");
const {
  generateEditorialReview,
} = require("../services/blog-editorial-review-service");
const blogRepairService = require("../services/blog-repair-service");
const { renderBlogPostPage } = require("../services/blog-render-service");
const {
  analyzeBlend,
  formatAnalysisReport,
} = require("../utils/blend-analyzer");
const { newUuid } = require("../utils/ids");
const { nowIso } = require("../utils/common");
const { acknowledgeGiftIncident } = require("../services/gift-delivery-ops");
const defaultOneSignalService = require("../services/onesignal");

function registerAdminRoutes(
  app,
  {
    db,
    appConfig,
    sendError,
    adminAuthService,
    subscriptionManager,
    planConfigService,
    emailService,
    oneSignalService = defaultOneSignalService,
  },
) {
  // ============ ADMIN DASHBOARD API ============

  const adminService = new AdminService(db);
  const adminGiftOpsService = new AdminGiftOpsService(db);
  const blogService = new BlogService(db);
  adminAuthService.initialize(db);
  const BLOG_TARGET_INTENTS = [
    "informational",
    "commercial",
    "comparison",
    "navigational",
  ];
  const MARKETING_CONTACT_STATUSES = ["active", "bounced", "unsubscribed"];
  const ADMIN_STATIC_MIME_TYPES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
  };
  const GIFT_OPS_READ_ROLES = ["admin", "superadmin"];

  /**
   * Admin session auth helper - validates Bearer token from Authorization header
   * Returns admin info if valid, null if invalid (and sends error response)
   */
  async function requireAdminSession(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(reply, 401, "UNAUTHORIZED", "Missing authorization token");
      return null;
    }

    const token = authHeader.slice(7);
    const admin = await adminAuthService.validateSession(token);

    if (!admin) {
      sendError(reply, 401, "UNAUTHORIZED", "Invalid or expired session");
      return null;
    }

    return admin;
  }

  /**
   * Require specific admin role(s) for an endpoint.
   * @param {object} request - Fastify request
   * @param {object} reply - Fastify reply
   * @param {string[]} allowedRoles - Array of allowed roles (e.g., ['superadmin'])
   * @returns {object|null} Admin object if authorized, null if denied
   */
  async function requireAdminRole(request, reply, allowedRoles) {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return null;

    if (!allowedRoles.includes(admin.role)) {
      sendError(
        reply,
        403,
        "FORBIDDEN",
        `This action requires one of: ${allowedRoles.join(", ")}`,
      );
      return null;
    }

    return admin;
  }

  function isGiftOpsSchemaError(err) {
    const message = String(err?.message || "").toLowerCase();
    return (
      message.includes("no such table: gift_delivery_incidents") ||
      message.includes("no such table: gift_delivery_outbox") ||
      message.includes("no such column: overdue_detected_at") ||
      message.includes("no such column: provider_accepted_at") ||
      message.includes("no such column: receipt_status") ||
      message.includes('relation "gift_delivery_incidents" does not exist') ||
      message.includes('relation "gift_delivery_outbox" does not exist') ||
      message.includes('column "overdue_detected_at" does not exist') ||
      message.includes('column "provider_accepted_at" does not exist') ||
      message.includes('column "receipt_status" does not exist')
    );
  }

  function handleGiftOpsRouteError(reply, err) {
    if (!isGiftOpsSchemaError(err)) {
      return false;
    }
    sendError(
      reply,
      503,
      "GIFT_OPS_MIGRATION_REQUIRED",
      "Gift operations observability schema is not applied in this environment yet.",
    );
    return true;
  }

  /**
   * Parse pagination params from query with defaults
   */
  function parsePagination(query, defaultLimit = 50) {
    return {
      limit: Math.max(
        1,
        Math.min(100, parseInt(query.limit, 10) || defaultLimit),
      ),
      offset: Math.max(0, parseInt(query.offset, 10) || 0),
    };
  }

  function validateReason(reason, reply) {
    if (!reason || reason.trim().length < 10) {
      sendError(
        reply,
        400,
        "MISSING_REASON",
        "Reason must be at least 10 characters",
      );
      return null;
    }
    if (reason.trim().length > 500) {
      sendError(
        reply,
        400,
        "INVALID_REASON",
        "Reason must not exceed 500 characters",
      );
      return null;
    }
    return reason.trim();
  }

  function isValidVersionString(value) {
    return /^\d+(?:\.\d+){0,3}$/.test(value);
  }

  function parseBooleanFilter(value, fieldName, reply) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "true") return 1;
    if (value === "false") return 0;
    sendError(
      reply,
      400,
      "INVALID_FILTER",
      `${fieldName} must be true or false`,
    );
    return null;
  }

  function validateBlogPayload(payload, reply, { requireBody = false } = {}) {
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

  function getAdminStaticContentType(filePath) {
    return (
      ADMIN_STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream"
    );
  }

  async function sendAdminStaticFile(reply, rootDir, relativePath) {
    const resolvedPath = path.resolve(rootDir, relativePath);
    const relativeToRoot = path.relative(rootDir, resolvedPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return reply.code(403).type("text/plain").send("Forbidden");
    }
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return reply.code(404).type("text/plain").send("Not Found");
    }
    const content = await fs.promises.readFile(resolvedPath);
    return reply
      .type(getAdminStaticContentType(resolvedPath))
      .header("Cache-Control", "public, max-age=14400")
      .send(content);
  }

  // --- Admin Authentication ---

  // One-time setup endpoint - protected by ADMIN_SETUP_SECRET env var
  // Remove this after initial admin is created
  app.post("/admin/auth/setup", async (request, reply) => {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return sendError(reply, 404, "NOT_FOUND", "Setup disabled");
    }

    const { secret, email, password, displayName } = request.body || {};
    if (secret !== setupSecret) {
      return sendError(reply, 401, "UNAUTHORIZED", "Invalid setup secret");
    }

    if (!email || !password) {
      return sendError(
        reply,
        400,
        "BAD_REQUEST",
        "Email and password required",
      );
    }

    const result = await adminAuthService.createAdmin(
      email,
      password,
      displayName || "Admin",
      "superadmin",
    );
    if (!result.success) {
      return sendError(reply, 400, "BAD_REQUEST", result.error);
    }

    reply.send({
      success: true,
      id: result.id,
      message:
        "Admin created. Remove ADMIN_SETUP_SECRET to disable this endpoint.",
    });
  });

  app.post("/admin/auth/login", async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return sendError(
        reply,
        400,
        "BAD_REQUEST",
        "Email and password required",
      );
    }

    const ip = request.ip;
    const userAgent = request.headers["user-agent"];
    const result = await adminAuthService.login(email, password, ip, userAgent);

    if (!result.success) {
      return sendError(reply, 401, "UNAUTHORIZED", result.error);
    }

    reply.send(result);
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      adminAuthService.logout(authHeader.slice(7));
    }
    reply.send({ success: true });
  });

  app.get("/admin/auth/me", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(admin);
  });

  app.post("/admin/auth/change-password", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({
        error: "MISSING_FIELDS",
        message: "Current and new password required",
      });
    }
    if (newPassword.length < 8) {
      return reply.code(400).send({
        error: "WEAK_PASSWORD",
        message: "Password must be at least 8 characters",
      });
    }

    // Verify current password first
    const loginResult = await adminAuthService.login(
      admin.email,
      currentPassword,
    );
    if (!loginResult.success) {
      return reply.code(401).send({
        error: "INVALID_PASSWORD",
        message: "Current password is incorrect",
      });
    }

    // Change password (this also invalidates all sessions)
    await adminAuthService.changePassword(admin.adminId, newPassword);
    reply.send({
      success: true,
      message: "Password changed. Please log in again.",
    });
  });

  // --- Admin Password Reset (Forgot / Reset) ---

  // Generic response used by /admin/auth/forgot-password regardless of
  // whether the email maps to an admin. Always returning the same body +
  // status code is what prevents this endpoint from being an account-
  // enumeration oracle. Do not change to something more specific.
  const ADMIN_FORGOT_GENERIC_RESPONSE = {
    message: "If an account exists for that email, a reset link has been sent.",
  };

  /**
   * DB-backed sliding-window rate limit for the public admin auth endpoints.
   *
   * Lighter than the user-side `consumeAuthRateLimit` (no in-memory cache)
   * since admin traffic volume doesn't warrant the cache complexity. Uses
   * the same `rate_limits` table so ops dashboards see admin traffic in
   * the same place.
   *
   * @param {string} key   - Subject of the limit (e.g. an email or IP)
   * @param {string} scope - Distinguishes limit type, e.g. "admin_forgot_email"
   * @param {number} limit - Max events per window
   * @param {number} windowMs - Window width in ms
   * @returns {Promise<boolean>} true when the request should be rejected
   */
  async function consumeAdminAuthRateLimit(key, scope, limit, windowMs) {
    try {
      const windowSeconds = Math.ceil(windowMs / 1000);
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const actionKey = `admin_auth:${scope}`;

      await db
        .prepare(
          `INSERT INTO rate_limits (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(user_id, action_type, window_start_ms)
           DO UPDATE SET count = rate_limits.count + 1`,
        )
        .run(key, actionKey, windowStart, windowSeconds, limit);

      const row = await db
        .prepare(
          "SELECT count FROM rate_limits WHERE user_id = ? AND action_type = ? AND window_start_ms = ?",
        )
        .get(key, actionKey, windowStart);
      return Boolean(row && row.count > limit);
    } catch (err) {
      // Fail-open on DB errors: a transient rate-limit table issue should
      // not lock admins out of password recovery. The risk of a brief
      // bypass window is lower than the risk of an admin permanently
      // unable to regain access during an incident.
      console.error("[Admin:rate-limit] error:", err.message);
      return false;
    }
  }

  function getAdminClientIp(request) {
    return request.ip || "unknown";
  }

  // POST /admin/auth/forgot-password
  //
  // Public. Always returns 200 with ADMIN_FORGOT_GENERIC_RESPONSE so the
  // endpoint cannot be used to enumerate admin accounts. Side effects (token
  // creation, email send, audit log) happen only when the email actually
  // belongs to an admin AND the email service is configured.
  app.post("/admin/auth/forgot-password", async (request, reply) => {
    const body = request.body || {};
    const rawEmail = typeof body.email === "string" ? body.email : "";
    const normalizedEmail = rawEmail.toLowerCase().trim();
    const clientIp = getAdminClientIp(request);

    // Basic shape gate. Still return the generic 200 so a malformed body
    // can't be used to distinguish "email format invalid" from "email not
    // found" timing-wise.
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !normalizedEmail.includes("@")
    ) {
      return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);
    }

    // Two rate-limit dimensions to make abuse harder:
    //   - per-email: stops mailbox-flooding a specific admin
    //   - per-IP:   stops a single host probing many emails
    const emailLimited = await consumeAdminAuthRateLimit(
      normalizedEmail,
      "admin_forgot_email",
      3,
      60 * 60 * 1000,
    );
    if (emailLimited) return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);

    const ipLimited = await consumeAdminAuthRateLimit(
      clientIp,
      "admin_forgot_ip",
      10,
      60 * 60 * 1000,
    );
    if (ipLimited) return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);

    try {
      const admin = await adminAuthService.findAdminByEmail(normalizedEmail);
      if (admin && emailService && emailService.isConfigured()) {
        const { token, expiresAt } =
          await adminAuthService.createPasswordResetToken(admin.id, {
            ipAddress: clientIp,
          });
        // Send is awaited so failures surface in the error path below
        // (still returning the generic 200). Without await, the request
        // would 200 even when delivery failed silently.
        await emailService.sendAdminPasswordResetEmail(
          normalizedEmail,
          token,
          expiresAt,
        );
        console.log(
          `[Admin:forgot-password] reset email queued for adminId=${admin.id}`,
        );
      } else if (admin && !(emailService && emailService.isConfigured())) {
        // Operational signal: an admin tried to recover but email is off.
        // Generic response still returned to the client; this log is for
        // the admin team to notice and fix the email config.
        console.warn(
          "[Admin:forgot-password] admin exists but email service is not configured — reset email NOT sent",
        );
      }
    } catch (err) {
      // Never leak details to the client. Log for ops.
      console.error("[Admin:forgot-password] error:", err.message);
    }

    return reply.send(ADMIN_FORGOT_GENERIC_RESPONSE);
  });

  // POST /admin/auth/reset-password
  //
  // Public. Consumes a single-use reset token, sets the new password, wipes
  // every active admin_sessions row for the admin, invalidates any other
  // outstanding reset tokens for the admin, clears the lockout state, and
  // sends a confirmation email.
  app.post("/admin/auth/reset-password", async (request, reply) => {
    const body = request.body || {};
    const token = typeof body.token === "string" ? body.token : "";
    const newPassword =
      typeof body.new_password === "string" ? body.new_password : "";

    if (!token || !newPassword) {
      return sendError(
        reply,
        400,
        "MISSING_FIELDS",
        "token and new_password are required",
      );
    }
    if (newPassword.length < 8) {
      // Match the threshold used by /admin/auth/change-password so the rule
      // is identical across both entry points.
      return sendError(
        reply,
        400,
        "WEAK_PASSWORD",
        "Password must be at least 8 characters",
      );
    }

    let adminId;
    let tokenId;
    try {
      ({ adminId, tokenId } =
        await adminAuthService.verifyPasswordResetToken(token));
    } catch (_err) {
      // Single generic error response for all token failure modes (not
      // found, expired, already used) so an attacker probing tokens can't
      // distinguish them.
      return sendError(
        reply,
        400,
        "INVALID_TOKEN",
        "Invalid or expired reset link",
      );
    }

    try {
      // Burn the token FIRST so a transient downstream failure can't leave
      // it usable for another ~30min. Worst-case UX on partial failure is
      // "request a new reset link" — better than "your token is still
      // accepted alongside whatever new password just got set."
      await adminAuthService.markPasswordResetTokenUsed(tokenId);
      // Sweep any other still-valid tokens issued to this admin (e.g. a
      // duplicate forgot-password request). Belt-and-suspenders.
      await adminAuthService.invalidateAllPasswordResetTokens(adminId);

      // changePassword updates the password hash AND deletes all
      // admin_sessions rows for the admin, forcing re-login on every
      // device. See admin-auth-service.js:changePassword.
      await adminAuthService.changePassword(adminId, newPassword);

      // Clear failed-login counter + lockout. An admin who got locked out
      // (e.g. via brute-force triggering the threshold) and then reset
      // their password should be able to log in immediately — without
      // this, a successful reset would leave them locked.
      await adminAuthService.clearLockout(adminId);

      // Best-effort security alert. Don't fail the reset if the alert
      // can't be sent (e.g. transient email-provider issue) — the
      // important security action (the password change) has already
      // committed. We catch errors so they don't surface as a 5xx that
      // would leave the client confused about whether the reset took.
      const admin = await adminAuthService.findAdminById(adminId);
      if (admin?.email && emailService && emailService.isConfigured()) {
        emailService
          .sendAdminSecurityAlertEmail(admin.email, {
            event: "password_reset_completed",
          })
          .catch((err) => {
            console.error(
              "[Admin:reset-password] alert send failed:",
              err.message,
            );
          });
      }

      return reply.send({
        success: true,
        message: "Password reset. Please log in.",
      });
    } catch (err) {
      console.error("[Admin:reset-password] error:", err.message);
      return sendError(reply, 500, "RESET_FAILED", "Could not complete reset");
    }
  });

  // --- Blog Publishing CMS ---

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
    const report = reviewBlogDraft(post);
    report.editorial_review = await generateEditorialReview(post, report);
    const updated = await blogService.saveReviewResult(
      post.id,
      report,
      admin.adminId,
    );
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
      );
      if (!repairedPost) {
        return sendError(reply, 404, "NOT_FOUND", "Blog post not found");
      }

      const repairedReport = reviewBlogDraft(repairedPost);
      repairedReport.editorial_review = await generateEditorialReview(
        repairedPost,
        repairedReport,
      );
      const updated = await blogService.saveReviewResult(
        repairedPost.id,
        repairedReport,
        admin.adminId,
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
      sendError(reply, 400, "BLOG_REPAIR_FAILED", message);
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

  // --- User Management ---

  app.get("/admin/dashboard/users", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { email, userId, riskLevel, tier, trackId, shareId, recipientName } =
      request.query;
    const users = await adminService.searchUsers({
      email,
      userId,
      riskLevel,
      tier,
      trackId,
      shareId,
      recipientName,
      ...parsePagination(request.query),
    });
    reply.send({ users });
  });

  app.get("/admin/dashboard/users/stats", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const stats = await adminService.getUserStats();
    reply.send(stats);
  });

  app.get("/admin/dashboard/attribution/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getAttributionHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await adminService.getUserDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "User not found");
      return;
    }
    reply.send(detail);
  });

  app.put("/admin/dashboard/users/:id/risk", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { riskLevel, reason } = request.body || {};
    if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
      sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "riskLevel must be low, medium, or high",
      );
      return;
    }
    const result = await adminService.updateUserRisk(
      request.params.id,
      riskLevel,
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.post("/admin/dashboard/users/:id/lock", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { locked, reason } = request.body || {};
    const result = await adminService.lockUser(
      request.params.id,
      Boolean(locked),
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.delete("/admin/dashboard/users/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.deleteUser(
      request.params.id,
      admin.adminId,
      reason || "Admin deletion",
    );
    if (!result.success) {
      sendError(reply, 404, "USER_NOT_FOUND", result.error);
      return;
    }
    reply.send(result);
  });

  app.post("/admin/dashboard/users/bulk-action", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { action, userIds, reason } = request.body || {};
    if (!action || !Array.isArray(userIds) || userIds.length === 0) {
      sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "action and userIds[] are required",
      );
      return;
    }
    const result = await adminService.bulkUserAction(
      userIds,
      action,
      admin.adminId,
      reason || "",
    );
    reply.send(result);
  });

  app.put("/admin/dashboard/users/:id/profile", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const fields = request.body || {};
    const result = await adminService.updateUserProfile(
      request.params.id,
      fields,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  app.put("/admin/dashboard/users/:id/entitlements", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const fields = request.body || {};
    const result = await adminService.updateUserEntitlements(
      request.params.id,
      fields,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "INVALID_PARAMS", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Admin Complimentary Upgrades ---

  app.post(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { tier, duration_days, reason } = request.body || {};

      if (!tier || !["plus", "pro"].includes(tier)) {
        return sendError(
          reply,
          400,
          "INVALID_TIER",
          "Tier must be 'plus' or 'pro'",
        );
      }
      if (
        !Number.isInteger(duration_days) ||
        duration_days < 1 ||
        duration_days > 365
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DURATION",
          "Duration must be 1-365 days (integer)",
        );
      }
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.adminComplimentaryUpgrade(
          request.params.id,
          tier,
          duration_days,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Complimentary upgrade error:", err);
        sendError(
          reply,
          500,
          "UPGRADE_ERROR",
          "Internal error processing upgrade",
        );
      }
    },
  );

  app.delete(
    "/admin/dashboard/users/:id/complimentary-upgrade",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { reason } = request.body || {};
      const trimmedReason = validateReason(reason, reply);
      if (!trimmedReason) return;

      try {
        const result = await subscriptionManager.revokeComplimentaryUpgrade(
          request.params.id,
          trimmedReason,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        console.error("[Admin] Revoke upgrade error:", err);
        sendError(
          reply,
          500,
          "REVOKE_ERROR",
          "Internal error processing revocation",
        );
      }
    },
  );

  // --- User Session Management ---

  app.get("/admin/dashboard/users/:userId/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId } = request.params;
    const sessions = await adminService.getUserSessions(userId);
    reply.send({ sessions });
  });

  app.post(
    "/admin/dashboard/users/:userId/sessions/:sessionId/revoke",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId, sessionId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.revokeUserSession(
        userId,
        sessionId,
        admin.adminId,
        reason || "Admin revocation",
      );
      if (!result.success) {
        sendError(reply, 404, "SESSION_NOT_FOUND", result.error);
        return;
      }
      reply.send(result);
    },
  );

  app.post(
    "/admin/dashboard/users/:userId/sessions/revoke-all",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.revokeAllUserSessions(
        userId,
        admin.adminId,
        reason || "Admin revocation",
      );
      reply.send(result);
    },
  );

  // --- Voice Profile Management ---

  app.post(
    "/admin/dashboard/users/:userId/voice/force-reverify",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.forceVoiceReverify(
        userId,
        admin.adminId,
        reason || "Admin-initiated re-verification",
      );
      if (!result.success) {
        sendError(reply, 404, "VOICE_PROFILE_NOT_FOUND", result.error);
        return;
      }
      reply.send(result);
    },
  );

  // --- Metrics ---

  app.get("/admin/dashboard/metrics/overview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getOverviewMetrics());
  });

  app.get("/admin/dashboard/metrics/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getJobMetrics());
  });

  app.get("/admin/dashboard/metrics/costs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    reply.send(await adminService.getCostMetrics(days ? parseInt(days) : 30));
  });

  app.get("/admin/dashboard/metrics/enrollment", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getEnrollmentMetrics());
  });

  app.get(
    "/admin/dashboard/metrics/render-pipeline",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      reply.send(await adminService.getRenderSuccessMetrics());
    },
  );

  app.get("/admin/dashboard/security/risk-metrics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send(await adminService.getRiskMetrics());
  });

  // --- Jobs ---

  app.get("/admin/dashboard/jobs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, workflowType } = request.query;
    reply.send({
      jobs: await adminService.listJobs({
        status,
        workflowType,
        ...parsePagination(request.query),
      }),
    });
  });

  app.post("/admin/dashboard/jobs/:id/retry", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const result = await adminService.retryJob(
      request.params.id,
      admin.adminId,
    );
    if (!result.success) {
      sendError(reply, 400, "RETRY_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Dead Letter Queue ---

  app.get("/admin/dashboard/dlq", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({
      entries: await adminService.listDLQ(parsePagination(request.query)),
    });
  });

  app.post("/admin/dashboard/dlq/:id/reprocess", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.reprocessDLQ(
      request.params.id,
      admin.adminId,
      reason || "Admin reprocess",
    );
    if (!result.success) {
      sendError(reply, 400, "DLQ_REPROCESS_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Moderation ---

  app.get("/admin/dashboard/moderation/queue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    reply.send({
      items: await adminService.getModerationQueue(
        parsePagination(request.query),
      ),
    });
  });

  app.post(
    "/admin/dashboard/moderation/:versionId/override",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { reason } = request.body || {};
      if (!reason) {
        sendError(reply, 400, "INVALID_PARAMS", "reason is required");
        return;
      }
      const result = await adminService.overrideModeration(
        request.params.versionId,
        admin.adminId,
        reason,
      );
      reply.send(result);
    },
  );

  // --- Story Sessions ---

  app.get("/admin/dashboard/story/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, engineVersion } = request.query;
    const sessions = await adminService.listStorySessions({
      status,
      engineVersion,
      ...parsePagination(request.query),
    });
    reply.send({ sessions });
  });

  app.get("/admin/dashboard/story/sessions/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await adminService.getStorySessionDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "Story session not found");
      return;
    }
    reply.send(detail);
  });

  // --- Share Management ---

  app.get("/admin/dashboard/shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, trackId, userId } = request.query;
    const shares = await adminService.listShares({
      status,
      trackId,
      userId,
      ...parsePagination(request.query),
    });
    reply.send({ shares });
  });

  app.post("/admin/dashboard/share/:id/rebind", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const { newDeviceId, reason } = request.body || {};
    if (!newDeviceId) {
      sendError(reply, 400, "INVALID_PARAMS", "newDeviceId is required");
      return;
    }
    const result = await adminService.rebindShare(
      request.params.id,
      newDeviceId,
      admin.adminId,
      reason || "",
    );
    if (!result.success) {
      sendError(reply, 400, "REBIND_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Poem Share Management ---

  app.get("/admin/dashboard/poem-shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, poemId, userId } = request.query;
    const shares = await adminService.listPoemShares({
      status,
      poemId,
      userId,
      ...parsePagination(request.query),
    });
    reply.send({ shares });
  });

  app.post(
    "/admin/dashboard/poem-share/:id/reset-attempts",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, [
        "admin",
        "superadmin",
      ]);
      if (!admin) return;
      const { reason } = request.body || {};
      const result = await adminService.resetPoemShareAttempts(
        request.params.id,
        admin.adminId,
        reason || "",
      );
      if (!result.success) {
        sendError(reply, 400, "RESET_ERROR", result.error);
        return;
      }
      reply.send(result);
    },
  );

  app.post("/admin/dashboard/poem-share/:id/revoke", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, [
      "admin",
      "superadmin",
    ]);
    if (!admin) return;
    const { reason } = request.body || {};
    const result = await adminService.revokePoemShare(
      request.params.id,
      admin.adminId,
      reason || "",
    );
    if (!result.success) {
      sendError(reply, 400, "REVOKE_ERROR", result.error);
      return;
    }
    reply.send(result);
  });

  // --- Gift Operations ---

  app.get("/admin/dashboard/gifts/overview", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    try {
      reply.send(await adminGiftOpsService.getOverview());
    } catch (err) {
      if (!handleGiftOpsRouteError(reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/orders", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 50);
    try {
      const orders = await adminGiftOpsService.listOrders(
        {
          status: request.query?.status,
          dispatchStatus: request.query?.dispatchStatus,
          deliveryMode: request.query?.deliveryMode,
          channel: request.query?.channel,
          overdue: request.query?.overdue,
          search: request.query?.search,
          senderUserId: request.query?.senderUserId,
          creator: request.query?.creator,
          recipient: request.query?.recipient,
          dateFrom: request.query?.dateFrom,
          dateTo: request.query?.dateTo,
        },
        { limit, offset },
      );
      reply.send({ orders, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/orders/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const includeSensitive =
      admin.role === "superadmin" &&
      String(request.query?.include_sensitive || "") === "true";
    try {
      const detail = await adminGiftOpsService.getOrderDetail(
        request.params.id,
        { includeSensitive },
      );
      if (!detail) {
        sendError(reply, 404, "NOT_FOUND", "Gift order not found");
        return;
      }
      reply.send(detail);
    } catch (err) {
      if (!handleGiftOpsRouteError(reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/outbox", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 100);
    try {
      const outbox = await adminGiftOpsService.listOutbox(
        {
          status: request.query?.status,
          receiptStatus: request.query?.receiptStatus,
          provider: request.query?.provider,
          channel: request.query?.channel,
          overdue: request.query?.overdue,
          attemptMin: request.query?.attemptMin,
          attemptMax: request.query?.attemptMax,
        },
        { limit, offset },
      );
      reply.send({ outbox, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(reply, err)) throw err;
    }
  });

  app.get("/admin/dashboard/gifts/incidents", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, GIFT_OPS_READ_ROLES);
    if (!admin) return;
    const { limit, offset } = parsePagination(request.query, 100);
    try {
      const incidents = await adminGiftOpsService.listIncidents(
        {
          status: request.query?.status,
          severity: request.query?.severity,
          type: request.query?.type,
        },
        { limit, offset },
      );
      reply.send({ incidents, limit, offset });
    } catch (err) {
      if (!handleGiftOpsRouteError(reply, err)) throw err;
    }
  });

  app.post(
    "/admin/dashboard/gifts/incidents/:id/acknowledge",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const incidentRecord = await adminGiftOpsService.getIncidentById(
          request.params.id,
        );
        if (!incidentRecord) {
          sendError(reply, 404, "NOT_FOUND", "Gift incident not found");
          return;
        }
        const incident = await acknowledgeGiftIncident(
          db,
          incidentRecord.incident_key,
          admin.adminId,
        );
        await adminService._audit(
          admin.adminId,
          "gift_incident_acknowledged",
          "gift_incident",
          incidentRecord.id,
          {
            gift_order_id: incidentRecord.gift_order_id,
            incident_type: incidentRecord.incident_type,
            note: request.body?.note || null,
          },
        );
        reply.send({ incident });
      } catch (err) {
        if (!handleGiftOpsRouteError(reply, err)) throw err;
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/retry",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const gift = await app.retryGiftOrderById(request.params.id, {
          actorUserId: admin.adminId,
          actorType: "admin",
        });
        await adminService._audit(
          admin.adminId,
          "gift_dispatch_requeued",
          "gift_order",
          request.params.id,
          {
            reason: request.body?.reason || null,
          },
        );
        reply.send({ gift });
      } catch (err) {
        const code = err?.code || "GIFT_RETRY_FAILED";
        if (code === "GIFT_NOT_FOUND")
          return sendError(reply, 404, code, "Gift order not found");
        if (code === "GIFT_CANCELLED")
          return sendError(
            reply,
            409,
            code,
            "Cancelled gifts cannot be retried",
          );
        if (code === "GIFT_NOT_RETRYABLE")
          return sendError(reply, 409, code, "Gift is not retryable");
        if (code === "GIFT_ALREADY_PARTIALLY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift has already delivered at least one channel and cannot be requeued blindly",
          );
        request.log.error({ err }, "Admin gift retry failed");
        sendError(
          reply,
          500,
          "GIFT_RETRY_FAILED",
          "Failed to retry gift order",
        );
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/cancel",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      try {
        const result = await app.cancelGiftOrderById(request.params.id, {
          actorUserId: admin.adminId,
          actorType: "admin",
        });
        await adminService._audit(
          admin.adminId,
          "gift_cancelled_by_admin",
          "gift_order",
          request.params.id,
          {
            reason: request.body?.reason || null,
            refund_transaction_id: result.refundTxId || null,
          },
        );
        reply.send({
          cancelled: true,
          gift: result.gift,
          wallet_balance: result.walletBalance,
        });
      } catch (err) {
        const code = err?.code || "GIFT_CANCEL_FAILED";
        if (code === "GIFT_NOT_FOUND")
          return sendError(reply, 404, code, "Gift order not found");
        if (code === "GIFT_ALREADY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift has already been dispatched",
          );
        if (code === "GIFT_NOT_CANCELLABLE")
          return sendError(
            reply,
            409,
            code,
            "Gift cannot be cancelled in its current state",
          );
        if (code === "GIFT_ALREADY_PARTIALLY_DISPATCHED")
          return sendError(
            reply,
            409,
            code,
            "Gift already partially delivered and cannot be cancelled",
          );
        request.log.error({ err }, "Admin gift cancel failed");
        sendError(
          reply,
          500,
          "GIFT_CANCEL_FAILED",
          "Failed to cancel gift order",
        );
      }
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/mark-overdue-reviewed",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const incident = await acknowledgeGiftIncident(
        db,
        `gift_overdue:${request.params.id}`,
        admin.adminId,
      );
      await adminService._audit(
        admin.adminId,
        "gift_overdue_acknowledged",
        "gift_order",
        request.params.id,
        {
          note: request.body?.note || null,
        },
      );
      reply.send({ incident });
    },
  );

  app.post(
    "/admin/dashboard/gifts/orders/:id/manual-recovery-note",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const note =
        typeof request.body?.note === "string" ? request.body.note.trim() : "";
      if (note.length < 5) {
        sendError(
          reply,
          400,
          "INVALID_NOTE",
          "Recovery note must be at least 5 characters",
        );
        return;
      }
      await adminService._audit(
        admin.adminId,
        "gift_manual_recovery_note",
        "gift_order",
        request.params.id,
        {
          note: note.slice(0, 1000),
        },
      );
      reply.send({ ok: true });
    },
  );

  // --- Security Section ---

  app.get("/admin/dashboard/security/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getSystemHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/security/auth-events", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { eventType, userId, startDate, endDate } = request.query;
    const events = await adminService.searchAuthEvents({
      eventType,
      userId,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ events });
  });

  app.get(
    "/admin/dashboard/security/auth-events/stats",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const stats = await adminService.getAuthEventStats();
      reply.send(stats);
    },
  );

  app.get("/admin/dashboard/security/apple-refresh", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { days } = request.query;
    const stats = await adminService.getAppleRefreshTokenStats(
      Number(days) || 7,
    );
    reply.send(stats);
  });

  app.get("/admin/dashboard/security/audit-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { action, resourceType, startDate, endDate } = request.query;
    const logs = await adminService.searchAuditLogs({
      action,
      resourceType,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ logs });
  });

  app.get("/admin/dashboard/security/rate-limits", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { userId, actionType, nearLimit } = request.query;
    const limits = await adminService.getRateLimits({
      userId,
      actionType,
      nearLimit: nearLimit === "true",
      ...parsePagination(request.query),
    });
    reply.send({ limits });
  });

  app.post(
    "/admin/dashboard/security/rate-limits/:userId/:actionType/reset",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { userId, actionType } = request.params;
      const { reason } = request.body || {};
      const result = await adminService.resetUserRateLimit(
        userId,
        actionType,
        admin.adminId,
        reason || "Admin reset",
      );
      reply.send(result);
    },
  );

  app.get("/admin/dashboard/security/consent-logs", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { consentVersion, startDate, endDate } = request.query;
    const consents = await adminService.getConsentLogs({
      consentVersion,
      startDate,
      endDate,
      ...parsePagination(request.query),
    });
    reply.send({ consents });
  });

  app.get("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSecurityConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/security/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const config = request.body;

    // Validate required fields and bounds
    const sessionHours = parseInt(config.sessionDurationHours);
    const maxAttempts = parseInt(config.maxFailedLoginAttempts);
    const lockoutMins = parseInt(config.lockoutDurationMinutes);

    if (
      !Number.isInteger(sessionHours) ||
      sessionHours < 1 ||
      sessionHours > 720
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "sessionDurationHours must be between 1 and 720",
      );
      return;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "maxFailedLoginAttempts must be between 1 and 20",
      );
      return;
    }
    if (
      !Number.isInteger(lockoutMins) ||
      lockoutMins < 1 ||
      lockoutMins > 1440
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "lockoutDurationMinutes must be between 1 and 1440",
      );
      return;
    }
    if (
      config.rateLimitDefaults &&
      typeof config.rateLimitDefaults !== "object"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "rateLimitDefaults must be an object",
      );
      return;
    }
    if (
      config.iosMinSupportedVersion &&
      !isValidVersionString(String(config.iosMinSupportedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosMinSupportedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosRecommendedVersion &&
      !isValidVersionString(String(config.iosRecommendedVersion).trim())
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosRecommendedVersion must look like 1.2.3",
      );
      return;
    }
    if (
      config.iosUpdateMessage &&
      String(config.iosUpdateMessage).length > 280
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosUpdateMessage must be 280 characters or fewer",
      );
      return;
    }
    if (
      config.iosAutoRecommendedVersion != null &&
      typeof config.iosAutoRecommendedVersion !== "boolean"
    ) {
      sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "iosAutoRecommendedVersion must be true or false",
      );
      return;
    }

    // Sanitize to only allowed fields
    const sanitizedConfig = {
      sessionDurationHours: sessionHours,
      maxFailedLoginAttempts: maxAttempts,
      lockoutDurationMinutes: lockoutMins,
      rateLimitDefaults: config.rateLimitDefaults || {},
      iosMinSupportedVersion: String(
        config.iosMinSupportedVersion || "",
      ).trim(),
      iosRecommendedVersion: String(config.iosRecommendedVersion || "").trim(),
      iosUpdateMessage: String(config.iosUpdateMessage || "").trim(),
      iosAutoRecommendedVersion: Boolean(config.iosAutoRecommendedVersion),
      iosLastAppStoreVersion: String(
        config.iosLastAppStoreVersion || "",
      ).trim(),
      iosLastAppStoreSyncAt: String(config.iosLastAppStoreSyncAt || "").trim(),
      iosAppStoreSyncError: String(config.iosAppStoreSyncError || "").trim(),
    };

    const result = await adminService.updateSecurityConfig(
      sanitizedConfig,
      admin.adminId,
    );
    reply.send(result);
  });

  app.post(
    "/admin/dashboard/security/config/sync-ios-version",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      try {
        const result = await adminService.syncIOSVersionFromAppStore(
          admin.adminId,
          { force: true },
        );
        reply.send(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "App Store Connect sync failed";
        sendError(reply, 502, "APP_STORE_SYNC_FAILED", message);
      }
    },
  );

  // --- Provider Control Plane ---

  app.get("/admin/dashboard/providers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const providers = await adminService.getProviderStatus();
    reply.send({ providers });
  });

  app.post(
    "/admin/dashboard/providers/:providerName/status",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { providerName } = request.params;
      const { status, reason } = request.body || {};

      if (!["active", "paused", "disabled"].includes(status)) {
        sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Status must be active, paused, or disabled",
        );
        return;
      }

      const result = await adminService.setProviderStatus(
        providerName,
        status,
        admin.adminId,
        reason,
      );
      reply.send(result);
    },
  );

  // --- Queue Control Plane ---

  app.get("/admin/dashboard/queues", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const queues = await adminService.getQueueStatus();
    reply.send({ queues });
  });

  app.post(
    "/admin/dashboard/queues/:queueName/status",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const { queueName } = request.params;
      const { status, reason } = request.body || {};

      if (!["active", "paused", "draining"].includes(status)) {
        sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Status must be active, paused, or draining",
        );
        return;
      }

      const result = await adminService.setQueueStatus(
        queueName,
        status,
        admin.adminId,
        reason,
      );
      reply.send(result);
    },
  );

  // --- Billing & Revenue ---

  app.get("/admin/dashboard/billing/revenue", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await adminService.getRevenueMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/billing/subscriptions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getSubscriptionHealth();
    reply.send(health);
  });

  app.get("/admin/dashboard/billing/transactions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { limit, offset } = request.query;
    const transactions = await adminService.getBillingTransactions({
      limit,
      offset,
    });
    reply.send({ transactions });
  });

  app.get("/admin/dashboard/webhooks/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await adminService.getWebhookHealth();
    reply.send(health);
  });

  // --- Growth & Attribution ---

  app.get("/admin/dashboard/growth/attribution", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const attribution = await adminService.getAttribution(days);
    reply.send(attribution);
  });

  app.get(
    "/admin/dashboard/growth/apple-ads-keyword-map",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const keywordMap = await adminService.getAppleAdsKeywordMap({
        limit: request.query.limit,
        offset: request.query.offset,
      });
      reply.send(keywordMap);
    },
  );

  app.post(
    "/admin/dashboard/growth/apple-ads-keyword-map",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      try {
        const rows = request.body?.keywords ?? request.body?.rows;
        const result = await adminService.upsertAppleAdsKeywordMap(
          rows,
          admin.adminId,
        );
        reply.send(result);
      } catch (error) {
        sendError(
          reply,
          400,
          "INVALID_KEYWORD_MAP",
          error.message || "Invalid Apple Ads keyword map payload",
        );
      }
    },
  );

  app.get("/admin/dashboard/growth/teasers", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 7;
    const metrics = await adminService.getTeaserMetrics(days);
    reply.send(metrics);
  });

  app.get("/admin/dashboard/growth/shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const metrics = await adminService.getShareMetrics(days);
    reply.send(metrics);
  });

  // --- Funnel Analytics ---
  //
  // These surface iOS-emitted funnel events (auth_completed, create_started,
  // create_completed, first_song_completed, session_resumed) plus server-side
  // events (share_create etc) from the events table. All responses except
  // /user/:userId are cached 60s in AdminService. /user/:userId writes an
  // audit_logs row on every call — admin reads of user behavioral data must
  // be traceable.

  app.get("/admin/dashboard/analytics/overview", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const overview = await adminService.getAnalyticsOverview(
      request.query.days,
    );
    reply.send(overview);
  });

  app.get("/admin/dashboard/analytics/funnel", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const funnel = await adminService.getFunnelCohort(request.query.days);
    reply.send(funnel);
  });

  app.get(
    "/admin/dashboard/analytics/daily/:eventName",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;
      const daily = await adminService.getAnalyticsDaily(
        request.params.eventName,
        request.query.days,
      );
      reply.send(daily);
    },
  );

  app.get("/admin/dashboard/analytics/user/:userId", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const userAnalytics = await adminService.getUserAnalytics(
      admin.adminId,
      admin.email,
      request.params.userId,
      request.query.limit,
    );
    reply.send(userAnalytics);
  });

  // --- KPI Dashboard ---

  app.get("/admin/dashboard/kpis", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const days = parseInt(request.query.days) || 30;
    const { getKPIAggregates } = require("../jobs/compute-daily-aggregates");
    const aggregates = await getKPIAggregates(db, days);
    reply.send({ aggregates });
  });

  app.get("/admin/dashboard/kpis/trends", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const {
      getKPITrends,
      ensureRecentAggregates,
    } = require("../jobs/compute-daily-aggregates");
    // Ensure we have recent data first
    await ensureRecentAggregates(db, 14);
    const trends = await getKPITrends(db);
    reply.send(trends);
  });

  // --- STT Provider Config ---

  app.get("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const config = await adminService.getSTTConfig();
    reply.send(config);
  });

  app.put("/admin/dashboard/stt/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const { primary_provider, fallback_provider, whisperkit_model } =
      request.body || {};

    try {
      const result = await adminService.setSTTConfig(
        { primary_provider, fallback_provider, whisperkit_model },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  // --- Music Provider Routing Config ---

  app.get("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const config = await adminService.getMusicProviderConfig();
      reply.send({
        ...config,
        available_providers: {
          elevenlabs: Boolean(appConfig.ELEVENLABS_API_KEY),
          suno: Boolean(appConfig.SUNO_API_KEY),
        },
        available_suno_models: ["V4_5", "V5", "V5_5"],
        available_generation_modes: ["composition_plan", "compose_detailed"],
      });
    } catch (err) {
      sendError(
        reply,
        500,
        "MUSIC_CONFIG_ERROR",
        "Failed to load music provider config.",
      );
    }
  });

  app.put("/admin/dashboard/music/config", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const {
      default_provider,
      suno_model,
      auto_style_routing,
      elevenlabs_generation_mode,
      auto_reroll_enabled,
      quality_threshold,
      max_rerolls,
      style_overrides,
    } = request.body || {};

    if (
      !request.body ||
      typeof request.body !== "object" ||
      Object.keys(request.body).length === 0
    ) {
      return sendError(
        reply,
        400,
        "INVALID_CONFIG",
        "Request body must contain at least one config key.",
      );
    }

    if (default_provider !== undefined) {
      if (default_provider !== "suno") {
        return sendError(
          reply,
          400,
          "INVALID_CONFIG",
          "default_provider must be suno; ElevenLabs no longer handles song generation.",
        );
      }
    }

    try {
      const result = await adminService.setMusicProviderConfig(
        {
          ...(default_provider !== undefined ? { default_provider } : {}),
          ...(suno_model !== undefined ? { suno_model } : {}),
          ...(auto_style_routing !== undefined ? { auto_style_routing } : {}),
          ...(elevenlabs_generation_mode !== undefined
            ? { elevenlabs_generation_mode }
            : {}),
          ...(auto_reroll_enabled !== undefined ? { auto_reroll_enabled } : {}),
          ...(quality_threshold !== undefined ? { quality_threshold } : {}),
          ...(max_rerolls !== undefined ? { max_rerolls } : {}),
          ...(style_overrides !== undefined ? { style_overrides } : {}),
        },
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      sendError(reply, 400, "INVALID_CONFIG", err.message);
    }
  });

  app.get("/admin/dashboard/music/diagnostics", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const limit = parseInt(request.query.limit, 10) || 30;
    const provider =
      typeof request.query.provider === "string"
        ? request.query.provider
        : null;
    const status =
      typeof request.query.status === "string" ? request.query.status : null;

    try {
      const diagnostics = await adminService.getRecentMusicDiagnostics({
        limit,
        provider,
        status,
      });
      reply.send(diagnostics);
    } catch (err) {
      sendError(
        reply,
        500,
        "MUSIC_DIAGNOSTICS_ERROR",
        "Failed to load music diagnostics.",
      );
    }
  });

  // --- Feature Flags Config ---

  app.get("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    try {
      const flags = await adminService.getAllFeatureFlags();
      reply.send(flags);
    } catch (err) {
      console.error(
        "[Admin] FF_GET_ERROR: Failed to get feature flags:",
        err.message,
      );
      sendError(
        reply,
        500,
        "FEATURE_FLAGS_ERROR",
        "Failed to load feature flags. Please try again.",
      );
    }
  });

  app.put("/admin/dashboard/feature-flags", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;
    const updates = request.body || {};

    if (typeof updates !== "object" || Object.keys(updates).length === 0) {
      return sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "Request body must be an object with flag updates",
      );
    }

    try {
      const result = await adminService.updateFeatureFlags(
        updates,
        admin.adminId,
      );
      reply.send(result);
    } catch (err) {
      console.error(
        "[Admin] FF_UPDATE_ERROR: Failed to update feature flags:",
        err.message,
      );
      sendError(
        reply,
        500,
        "FEATURE_FLAGS_ERROR",
        "Failed to save feature flags. Please try again.",
      );
    }
  });

  // --- Public App Config (for mobile clients) ---

  app.get("/app/config", async (request, reply) => {
    // Public endpoint - no auth required
    // Returns safe-for-client configuration
    const config = await adminService.getAppConfig();
    reply.send(config);
  });

  // --- Subscription Plan Management ---

  app.get("/admin/billing/plans", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const plans = await planConfigService.getPlans({ includeInactive: true });
      reply.send({ plans });
    } catch (err) {
      console.error("[Admin] Get plans error:", err);
      sendError(
        reply,
        500,
        "PLANS_ERROR",
        "Failed to load subscription plans.",
      );
    }
  });

  app.put("/admin/billing/plans/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const body = request.body || {};

    // Allowlist and type-validate fields
    const updates = {};
    const intFields = [
      "songs_per_month",
      "poems_per_month",
      "previews_per_day",
      "price_monthly_cents",
      "price_annual_cents",
      "sort_order",
    ];
    for (const field of intFields) {
      if (body[field] !== undefined) {
        const val = parseInt(body[field], 10);
        if (!Number.isInteger(val) || val < 0) {
          sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be a non-negative integer.`,
          );
          return;
        }
        updates[field] = val;
      }
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length === 0 || name.length > 200) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "name must be 1-200 characters.",
        );
        return;
      }
      updates.name = name;
    }
    if (body.description !== undefined) {
      const desc = String(body.description).trim();
      if (desc.length > 500) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "description must be at most 500 characters.",
        );
        return;
      }
      updates.description = desc;
    }
    if (body.is_active !== undefined)
      updates.is_active = Boolean(body.is_active);
    if (body.features_json !== undefined) {
      if (!Array.isArray(body.features_json)) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must be an array.",
        );
        return;
      }
      if (!body.features_json.every((f) => typeof f === "string")) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json elements must be strings.",
        );
        return;
      }
      if (body.features_json.length > 20) {
        sendError(
          reply,
          400,
          "INVALID_FIELD",
          "features_json must have at most 20 items.",
        );
        return;
      }
      updates.features_json = body.features_json;
    }

    if (Object.keys(updates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    try {
      const updated = await planConfigService.updatePlan(id, updates);
      if (!updated) {
        sendError(reply, 404, "PLAN_NOT_FOUND", "Plan not found.");
        return;
      }

      await adminService._audit(
        admin.adminId,
        "admin_update_plan",
        "subscription_plan",
        id,
        {
          updates,
        },
      );

      reply.send({ plan: updated });
    } catch (err) {
      console.error("[Admin] Update plan error:", err);
      sendError(reply, 500, "PLAN_UPDATE_ERROR", "Failed to update plan.");
    }
  });

  // --- Gift Bundle Management ---

  app.get("/admin/billing/gift-bundles", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const bundles = await db
        .prepare("SELECT * FROM gift_bundles ORDER BY sort_order ASC")
        .all();
      reply.send({ bundles });
    } catch (err) {
      console.error("[Admin] Get gift bundles error:", err);
      sendError(reply, 500, "GIFT_BUNDLES_ERROR", err.message);
    }
  });

  app.put("/admin/billing/gift-bundles/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    const allowedFields = [
      "token_count",
      "display_name",
      "description",
      "is_active",
      "sort_order",
    ];
    const filteredUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      sendError(reply, 400, "NO_UPDATES", "No valid fields to update.");
      return;
    }

    // Validate token_count
    if (filteredUpdates.token_count !== undefined) {
      const tc = parseInt(filteredUpdates.token_count, 10);
      if (!Number.isInteger(tc) || tc < 1 || tc > 10) {
        sendError(
          reply,
          400,
          "INVALID_TOKEN_COUNT",
          "token_count must be an integer between 1 and 10.",
        );
        return;
      }
      filteredUpdates.token_count = tc;
    }

    // Validate sort_order
    if (filteredUpdates.sort_order !== undefined) {
      const so = parseInt(filteredUpdates.sort_order, 10);
      if (!Number.isInteger(so) || so < 0) {
        sendError(
          reply,
          400,
          "INVALID_SORT_ORDER",
          "sort_order must be a non-negative integer.",
        );
        return;
      }
      filteredUpdates.sort_order = so;
    }

    try {
      // Fetch previous values for audit
      const previous = await db
        .prepare("SELECT * FROM gift_bundles WHERE id = ?")
        .get(id);
      if (!previous) {
        sendError(reply, 404, "BUNDLE_NOT_FOUND", "Gift bundle not found.");
        return;
      }

      const ALLOWED_COLUMNS = [
        "token_count",
        "display_name",
        "description",
        "is_active",
        "sort_order",
      ];
      const setClauses = [];
      const params = [];
      for (const [key, value] of Object.entries(filteredUpdates)) {
        if (!ALLOWED_COLUMNS.includes(key))
          throw new Error(`Unsafe column name: ${key}`);
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
      setClauses.push("updated_at = ?");
      params.push(new Date().toISOString());
      setClauses.push("updated_by = ?");
      params.push(admin.adminId);
      params.push(id);

      await db
        .prepare(
          `UPDATE gift_bundles SET ${setClauses.join(", ")} WHERE id = ?`,
        )
        .run(...params);

      // Audit with previous + new values
      await adminService._audit(
        admin.adminId,
        "admin_update_gift_bundle",
        "gift_bundle",
        id,
        {
          previous: {
            token_count: previous.token_count,
            display_name: previous.display_name,
            is_active: previous.is_active,
            sort_order: previous.sort_order,
          },
          updated: filteredUpdates,
        },
      );

      const updated = await db
        .prepare("SELECT * FROM gift_bundles WHERE id = ?")
        .get(id);
      reply.send({ success: true, bundle: updated });
    } catch (err) {
      request.log.error({ err }, "[Admin] Update gift bundle error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });

  // --- Onboarding Samples Management ---

  app.get("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    try {
      const samples = await adminService.getOnboardingSamples();
      reply.send({ samples });
    } catch (err) {
      request.log.error({ err }, "[Admin] Get onboarding samples error");
      sendError(reply, 500, "ONBOARDING_SAMPLES_ERROR", err.message);
    }
  });

  app.post("/admin/dashboard/onboarding-samples", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { label, audio_url } = request.body || {};

    try {
      const sample = await adminService.createOnboardingSample(
        { label, audio_url },
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (
        err.message.includes("is required") ||
        err.message.includes("must start with") ||
        err.message.includes("must be")
      ) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Create onboarding sample error");
      sendError(reply, 500, "CREATE_ERROR", "An internal error occurred.");
    }
  });

  app.put("/admin/dashboard/onboarding-samples/:id", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const { id } = request.params;
    const updates = request.body || {};

    try {
      const sample = await adminService.updateOnboardingSample(
        id,
        updates,
        admin.adminId,
      );
      reply.send({ success: true, sample });
    } catch (err) {
      if (err.message === "Onboarding sample not found") {
        sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
        return;
      }
      if (
        err.message.includes("No valid fields") ||
        err.message.includes("must start with") ||
        err.message.includes("must be")
      ) {
        sendError(reply, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      request.log.error({ err }, "[Admin] Update onboarding sample error");
      sendError(reply, 500, "UPDATE_ERROR", "An internal error occurred.");
    }
  });

  app.put(
    "/admin/dashboard/onboarding-samples/:id/activate",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const sample = await adminService.activateOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send({ success: true, sample });
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Activate onboarding sample error");
        sendError(reply, 500, "ACTIVATE_ERROR", "An internal error occurred.");
      }
    },
  );

  app.delete(
    "/admin/dashboard/onboarding-samples/:id",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { id } = request.params;

      try {
        const result = await adminService.deleteOnboardingSample(
          id,
          admin.adminId,
        );
        reply.send(result);
      } catch (err) {
        if (err.message === "Onboarding sample not found") {
          sendError(reply, 404, "SAMPLE_NOT_FOUND", err.message);
          return;
        }
        request.log.error({ err }, "[Admin] Delete onboarding sample error");
        sendError(reply, 500, "DELETE_ERROR", "An internal error occurred.");
      }
    },
  );

  // --- Blend Analysis (Voice Conversion Diagnostics) ---
  /**
   * Analyze a track's blend quality to diagnose voice conversion issues
   * POST /admin/dashboard/analyze-blend
   *
   * Body:
   * - trackVersionId: string (required) - The track version to analyze
   * - includeReport: boolean (optional) - Include formatted text report
   */
  app.post("/admin/dashboard/analyze-blend", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { trackVersionId, includeReport } = request.body || {};
    if (!trackVersionId) {
      return sendError(
        reply,
        400,
        "INVALID_REQUEST",
        "trackVersionId is required",
      );
    }

    try {
      // Get track version details to find file paths
      const trackVersion = await db
        .prepare(
          `
      SELECT tv.*, t.user_id, t.id as track_id
      FROM track_versions tv
      JOIN tracks t ON tv.track_id = t.id
      WHERE tv.id = ?
    `,
        )
        .get(trackVersionId);

      if (!trackVersion) {
        return sendError(reply, 404, "NOT_FOUND", "Track version not found");
      }

      const userId = trackVersion.user_id;
      const trackId = trackVersion.track_id;
      const version = trackVersion.version_num;

      // Build file paths based on storage layout
      const basePath = path.join(
        process.cwd(),
        "storage/tracks",
        userId,
        trackId,
        `v${version}`,
      );

      const filePaths = {
        userEnrollmentPath: null, // Will try to find from voice profile
        originalVocalPath: path.join(basePath, "stems/vocals.wav"),
        convertedVocalPath: path.join(basePath, "user_vocal.wav"),
        blendedOutputPath: path.join(basePath, "blended_vocal.wav"),
      };

      // Try to find user's enrollment audio
      const voiceProfile = await db
        .prepare(
          `
      SELECT * FROM voice_profiles
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `,
        )
        .get(userId);

      if (voiceProfile) {
        // Try to find enrollment audio in S3 or local storage
        const enrollmentBasePath = path.join(
          process.cwd(),
          "storage/enrollment/raw",
          userId,
        );
        if (fs.existsSync(enrollmentBasePath)) {
          const sessions = fs.readdirSync(enrollmentBasePath);
          if (sessions.length > 0) {
            const sessionPath = path.join(enrollmentBasePath, sessions[0]);
            const chunks = fs
              .readdirSync(sessionPath)
              .filter((f) => f.endsWith(".wav"));
            if (chunks.length > 0) {
              // Prefer sung chunks for voice comparison
              const sungChunk =
                chunks.find((c) => c.includes("sung")) || chunks[0];
              filePaths.userEnrollmentPath = path.join(sessionPath, sungChunk);
            }
          }
        }
      }

      // Check which files exist
      const existingFiles = {};
      for (const [key, filePath] of Object.entries(filePaths)) {
        if (filePath && fs.existsSync(filePath)) {
          existingFiles[key] = filePath;
        }
      }

      if (Object.keys(existingFiles).length === 0) {
        return sendError(
          reply,
          404,
          "NO_FILES_FOUND",
          "No audio files found for analysis. Files may have been cleaned up or render incomplete.",
        );
      }

      // Run analysis
      const analysis = await analyzeBlend(existingFiles);

      // Add track context
      analysis.trackContext = {
        trackVersionId,
        trackId,
        userId,
        version,
        filesAnalyzed: Object.keys(existingFiles),
        filesMissing: Object.keys(filePaths).filter((k) => !existingFiles[k]),
      };

      // Optionally include formatted report
      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", "Failed to analyze blend");
    }
  });

  /**
   * Quick blend analysis from file paths (for CLI/testing)
   * POST /admin/dashboard/analyze-blend/paths
   */
  app.post("/admin/dashboard/analyze-blend/paths", async (request, reply) => {
    const admin = await requireAdminRole(request, reply, ["superadmin"]);
    if (!admin) return;

    const {
      userEnrollmentPath,
      originalVocalPath,
      convertedVocalPath,
      blendedOutputPath,
      includeReport,
    } = request.body || {};

    // Validate all paths are within STORAGE_DIR (prevent arbitrary file read)
    const storageRoot = path.resolve(appConfig.STORAGE_DIR) + path.sep;
    const paths = {
      userEnrollmentPath,
      originalVocalPath,
      convertedVocalPath,
      blendedOutputPath,
    };
    const existingPaths = {};
    for (const [key, filePath] of Object.entries(paths)) {
      if (!filePath) continue;
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(storageRoot)) {
        return sendError(
          reply,
          400,
          "INVALID_PATH",
          `Path "${key}" must be within storage directory`,
        );
      }
      if (fs.existsSync(resolved)) {
        existingPaths[key] = resolved;
      }
    }

    if (Object.keys(existingPaths).length === 0) {
      return sendError(
        reply,
        400,
        "NO_FILES",
        "No valid file paths provided or files don't exist",
      );
    }

    try {
      const analysis = await analyzeBlend(existingPaths);

      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", "Failed to analyze blend");
    }
  });

  // --- Demo Share Links (Marketing) ---

  const DEMO_EXPIRES_AT = "2125-01-01T00:00:00.000Z";

  function buildDemoShareUrl(shareId, resourceType) {
    const publicBase =
      appConfig.PUBLIC_BASE_URL ||
      appConfig.STREAM_BASE_URL ||
      "https://porizo.co";
    if (resourceType === "poem") {
      return `${publicBase}/poem/${shareId}?web=1`;
    }
    return `${publicBase}/play/${shareId}?web=1`;
  }

  app.post("/admin/dashboard/demo-shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { resource_type, resource_id } = request.body || {};
    if (!resource_type || !["song", "poem"].includes(resource_type)) {
      return sendError(
        reply,
        400,
        "INVALID_PARAMS",
        "resource_type must be 'song' or 'poem'",
      );
    }
    if (!resource_id) {
      return sendError(reply, 400, "INVALID_PARAMS", "resource_id is required");
    }

    if (resource_type === "song") {
      const track = await db
        .prepare("SELECT * FROM tracks WHERE id = ? AND deleted_at IS NULL")
        .get(resource_id);
      if (!track) {
        return sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found");
      }

      // Check if share token already exists for this track
      const existing = await db
        .prepare("SELECT * FROM share_tokens WHERE track_id = ?")
        .get(resource_id);

      let shareId;
      if (existing) {
        // Update existing share to demo type
        shareId = existing.id;
        await db
          .prepare(
            `
        UPDATE share_tokens
        SET share_type = 'demo', claim_pin = NULL, expires_at = ?, status = 'unbound',
            web_stream_allowed = 1, bound_device_id = NULL, bound_device_platform = NULL,
            bound_app_version = NULL, bound_at = NULL, bound_user_id = NULL
        WHERE id = ?
      `,
          )
          .run(DEMO_EXPIRES_AT, shareId);
      } else {
        // Insert new demo share
        shareId = newUuid();
        const trackVersion = await db
          .prepare(
            "SELECT id FROM track_versions WHERE track_id = ? ORDER BY version_num DESC LIMIT 1",
          )
          .get(resource_id);
        if (!trackVersion) {
          return sendError(
            reply,
            400,
            "NO_VERSION",
            "Track has no rendered version",
          );
        }
        await db
          .prepare(
            `
        INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, claim_pin,
          expires_at, web_stream_allowed, created_at)
        VALUES (?, ?, ?, ?, 'unbound', 'demo', NULL, ?, 1, ?)
      `,
          )
          .run(
            shareId,
            resource_id,
            trackVersion.id,
            track.user_id,
            DEMO_EXPIRES_AT,
            nowIso(),
          );
        // Link share token to track
        await db
          .prepare("UPDATE tracks SET share_token_id = ? WHERE id = ?")
          .run(shareId, resource_id);
      }

      await adminService._audit(
        admin.adminId,
        "admin_create_demo_share",
        "share_token",
        shareId,
        {
          resource_type: "song",
          resource_id,
          action: existing ? "converted_existing" : "created_new",
        },
      );

      reply.send({
        success: true,
        share_id: shareId,
        share_url: buildDemoShareUrl(shareId, "song"),
        resource_type: "song",
        resource_id,
      });
    } else {
      // Poem demo share
      const poem = await db
        .prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL")
        .get(resource_id);
      if (!poem) {
        return sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found");
      }

      const existing = await db
        .prepare("SELECT * FROM poem_share_tokens WHERE poem_id = ?")
        .get(resource_id);

      let shareId;
      if (existing) {
        shareId = existing.id;
        await db
          .prepare(
            `
        UPDATE poem_share_tokens
        SET share_type = 'demo', claim_pin = NULL, expires_at = ?, status = 'active',
            bound_user_id = NULL, claim_attempts = 0
        WHERE id = ?
      `,
          )
          .run(DEMO_EXPIRES_AT, shareId);
      } else {
        shareId = newUuid();
        await db
          .prepare(
            `
        INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, share_type, claim_pin,
          expires_at, allow_save, created_at)
        VALUES (?, ?, ?, 'active', 'demo', NULL, ?, 1, ?)
      `,
          )
          .run(shareId, resource_id, poem.user_id, DEMO_EXPIRES_AT, nowIso());
      }

      await adminService._audit(
        admin.adminId,
        "admin_create_demo_share",
        "poem_share_token",
        shareId,
        {
          resource_type: "poem",
          resource_id,
          action: existing ? "converted_existing" : "created_new",
        },
      );

      reply.send({
        success: true,
        share_id: shareId,
        share_url: buildDemoShareUrl(shareId, "poem"),
        resource_type: "poem",
        resource_id,
      });
    }
  });

  app.get("/admin/dashboard/demo-shares", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const songShares = await db
      .prepare(
        `
    SELECT st.id, st.track_id as resource_id, 'song' as resource_type,
      t.title, st.access_count, st.created_at, st.status
    FROM share_tokens st
    LEFT JOIN tracks t ON t.id = st.track_id
    WHERE st.share_type = 'demo'
    ORDER BY st.created_at DESC
  `,
      )
      .all();

    const poemShares = await db
      .prepare(
        `
    SELECT pst.id, pst.poem_id as resource_id, 'poem' as resource_type,
      p.title, pst.access_count, pst.created_at, pst.status
    FROM poem_share_tokens pst
    LEFT JOIN poems p ON p.id = pst.poem_id
    WHERE pst.share_type = 'demo'
    ORDER BY pst.created_at DESC
  `,
      )
      .all();

    const allShares = [...songShares, ...poemShares].map((s) => ({
      ...s,
      share_url: buildDemoShareUrl(s.id, s.resource_type),
    }));

    reply.send({ demo_shares: allShares });
  });

  app.post("/admin/dashboard/demo-share/:id/revoke", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const shareId = request.params.id;

    // Try song share first
    let share = await db
      .prepare(
        "SELECT * FROM share_tokens WHERE id = ? AND share_type = 'demo'",
      )
      .get(shareId);
    if (share) {
      await db
        .prepare("UPDATE share_tokens SET status = 'revoked' WHERE id = ?")
        .run(shareId);
      await adminService._audit(
        admin.adminId,
        "admin_revoke_demo_share",
        "share_token",
        shareId,
        {
          resource_type: "song",
          track_id: share.track_id,
        },
      );
      return reply.send({ success: true, revoked: true });
    }

    // Try poem share
    share = await db
      .prepare(
        "SELECT * FROM poem_share_tokens WHERE id = ? AND share_type = 'demo'",
      )
      .get(shareId);
    if (share) {
      await db
        .prepare("UPDATE poem_share_tokens SET status = 'revoked' WHERE id = ?")
        .run(shareId);
      await adminService._audit(
        admin.adminId,
        "admin_revoke_demo_share",
        "poem_share_token",
        shareId,
        {
          resource_type: "poem",
          poem_id: share.poem_id,
        },
      );
      return reply.send({ success: true, revoked: true });
    }

    sendError(reply, 404, "DEMO_SHARE_NOT_FOUND", "Demo share not found");
  });

  // --- Marketing ---

  // RFC 4180 CSV parser with quoted-field support
  function parseCsvRow(line) {
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cols.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cols.push(current.trim());
    return cols;
  }

  // Read and validate a CSV file upload, returning { lines, filename }
  async function readCsvUpload(
    request,
    reply,
    { maxSizeMB = 2, maxRows = 10000 } = {},
  ) {
    const data = await request.file();
    if (!data) {
      sendError(reply, 400, "NO_FILE", "No file uploaded");
      return null;
    }

    const mime = data.mimetype;
    if (
      mime !== "text/csv" &&
      mime !== "application/vnd.ms-excel" &&
      mime !== "application/octet-stream"
    ) {
      sendError(reply, 400, "INVALID_FILE_TYPE", "Only CSV files are accepted");
      return null;
    }

    const maxSize = maxSizeMB * 1024 * 1024;
    const chunks = [];
    let size = 0;
    for await (const chunk of data.file) {
      size += chunk.length;
      if (size > maxSize) {
        sendError(
          reply,
          400,
          "FILE_TOO_LARGE",
          `CSV must be under ${maxSizeMB}MB`,
        );
        return null;
      }
      chunks.push(chunk);
    }

    const csvText = Buffer.concat(chunks).toString("utf8");
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      sendError(reply, 400, "EMPTY_CSV", "CSV has no data rows");
      return null;
    }
    if (maxRows && lines.length > maxRows + 1) {
      sendError(
        reply,
        400,
        "TOO_MANY_ROWS",
        `CSV must have fewer than ${maxRows.toLocaleString()} rows`,
      );
      return null;
    }

    return { lines, filename: data.filename || "unknown.csv" };
  }

  // Normalize email from multiple possible header names
  function normalizeEmail(record) {
    return (
      (record.email || record.emailaddress || record.email_address || "")
        .trim()
        .toLowerCase() || null
    );
  }

  // OWASP formula injection prevention for CSV export cells
  function sanitizeCsvCell(val) {
    if (!val) return "";
    const s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  const TEMPLATE_ALLOWLIST = [
    {
      id: "email-1-introduction",
      file: "email-1-introduction.html",
      subject: "What if your favorite memory became a song?",
      label: "The Introduction",
      day: "Day 0",
    },
    {
      id: "email-2-social-proof",
      file: "email-2-social-proof.html",
      subject: "Re: The gift no one expects",
      label: "The Social Proof",
      day: "Day 3",
    },
    {
      id: "email-3-final-nudge",
      file: "email-3-final-nudge.html",
      subject: "Someone's birthday is coming up",
      label: "The Final Nudge",
      day: "Day 8",
    },
  ];

  const CAMPAIGN_TYPES = ["email", "push", "social", "partnership"];
  const CAMPAIGN_STATUSES = ["draft", "scheduled", "sent", "completed"];
  const MAX_PUSH_TITLE_LENGTH = 80;
  const MAX_PUSH_BODY_LENGTH = 180;

  function validateCampaignFields({ type, status, template_id }, reply) {
    if (type && !CAMPAIGN_TYPES.includes(type)) {
      sendError(
        reply,
        400,
        "INVALID_TYPE",
        `Type must be one of: ${CAMPAIGN_TYPES.join(", ")}`,
      );
      return false;
    }
    if (status && !CAMPAIGN_STATUSES.includes(status)) {
      sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${CAMPAIGN_STATUSES.join(", ")}`,
      );
      return false;
    }
    if (template_id && !TEMPLATE_ALLOWLIST.some((t) => t.id === template_id)) {
      sendError(reply, 400, "INVALID_TEMPLATE", "Invalid template ID");
      return false;
    }
    return true;
  }

  function normalizePushText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeOneSignalSegments({ segment, segments }) {
    const rawSegments = Array.isArray(segments) ? segments : [segment || "All"];
    return rawSegments
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 10);
  }

  function normalizeUserIds(userIds) {
    if (!Array.isArray(userIds)) return [];
    return userIds
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 1000);
  }

  function oneSignalRecipientCount(response) {
    const candidates = [response?.recipients, response?.successful];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return 0;
  }

  app.get(
    "/admin/dashboard/marketing/email-templates",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const emailsDir = path.join(process.cwd(), "marketing", "emails");
      const templates = await Promise.all(
        TEMPLATE_ALLOWLIST.map(async (tpl) => {
          try {
            const html = await fs.promises.readFile(
              path.join(emailsDir, tpl.file),
              "utf8",
            );
            return { ...tpl, html };
          } catch {
            return { ...tpl, html: null, error: "File not found" };
          }
        }),
      );
      reply.send({ templates });
    },
  );

  app.get("/admin/dashboard/marketing/contacts", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { limit, offset } = parsePagination(request.query);
    const { search, category, status } = request.query;
    if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
      return sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
      );
    }

    let sql = "SELECT * FROM marketing_contacts";
    const conditions = [];
    const params = [];

    if (search) {
      const escaped = escapeLikePattern(search);
      conditions.push(
        "(first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\')",
      );
      params.push(
        `%${escaped}%`,
        `%${escaped}%`,
        `%${escaped}%`,
        `%${escaped}%`,
        `%${escaped}%`,
      );
    }
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const contacts = await db.prepare(sql).all(...params);

    // Get total count for pagination
    let countSql = "SELECT COUNT(*) as total FROM marketing_contacts";
    if (conditions.length) countSql += " WHERE " + conditions.join(" AND ");
    const countParams = params.slice(0, params.length - 2); // exclude limit/offset
    const { total } = await db.prepare(countSql).get(...countParams);

    reply.send({ contacts, total, limit, offset });
  });

  app.post(
    "/admin/dashboard/marketing/contacts/upload",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 2,
        maxRows: 10000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const KNOWN_HEADERS = new Set([
        "first_name",
        "last_name",
        "company_name",
        "name",
        "website",
        "description",
        "contact_name",
        "email",
        "emailaddress",
        "email_address",
        "category",
        "channel_type",
        "score",
        "icp_fit_score",
        "icp_fit_reasoning",
        "audience_reach",
        "partnership_opportunity",
        "contact_approach",
      ]);

      const headers = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      let inserted = 0;
      let skipped = 0;

      const insertStmt = db.prepare(`
    INSERT INTO marketing_contacts (id, first_name, last_name, company_name, website, description, contact_name, email, category, score, icp_fit_reasoning, audience_reach, partnership_opportunity, contact_approach, source_file, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

      const now = nowIso();
      await db.prepare("BEGIN").run();
      try {
        for (const row of rows) {
          const cols = parseCsvRow(row);
          // Build record from known headers only (prevents prototype pollution)
          const record = Object.create(null);
          headers.forEach((h, i) => {
            if (KNOWN_HEADERS.has(h)) record[h] = cols[i] || null;
          });

          const email = normalizeEmail(record);
          const firstName = record.first_name || null;
          const lastName = record.last_name || null;
          const companyName = record.company_name || record.name || null;
          let website = record.website || null;
          // Derive contact_name from first+last if not explicitly provided
          const contactName =
            record.contact_name ||
            (firstName && lastName
              ? `${firstName} ${lastName}`
              : firstName || lastName || null);

          // Dual-path dedup: email takes priority, fallback to company_name+website for legacy B2B records
          if (email) {
            const existing = await db
              .prepare("SELECT id FROM marketing_contacts WHERE email = ?")
              .get(email);
            if (existing) {
              skipped++;
              continue;
            }
          } else if (companyName) {
            const existing = await db
              .prepare(
                "SELECT id FROM marketing_contacts WHERE company_name = ? AND (website = ? OR (website IS NULL AND ? IS NULL))",
              )
              .get(companyName, website, website);
            if (existing) {
              skipped++;
              continue;
            }
          } else {
            skipped++;
            continue;
          }

          // Sanitize URL — only allow http(s) schemes
          if (website && !/^https?:\/\//i.test(website)) {
            website = null;
          }

          await insertStmt.run(
            newUuid(),
            firstName,
            lastName,
            companyName,
            website,
            record.description || null,
            contactName,
            email,
            record.category || record.channel_type || null,
            parseInt(record.score || record.icp_fit_score) || 0,
            record.icp_fit_reasoning || null,
            record.audience_reach || null,
            record.partnership_opportunity || null,
            record.contact_approach || null,
            filename,
            now,
            now,
          );
          inserted++;
        }
        await db.prepare("COMMIT").run();
      } catch (err) {
        await db.prepare("ROLLBACK").run();
        throw err;
      }

      await adminService._audit(
        admin.adminId,
        "marketing_contacts_upload",
        "marketing_contacts",
        null,
        {
          filename,
          inserted,
          skipped,
          total_rows: rows.length,
        },
      );

      reply.send({ success: true, inserted, skipped, total: rows.length });
    },
  );

  app.get("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const campaigns = await db
      .prepare("SELECT * FROM marketing_campaigns ORDER BY created_at DESC")
      .all();
    reply.send({ campaigns });
  });

  app.post("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { name, type, status, template_id, sent_at, recipient_count, notes } =
      request.body || {};
    if (!name || !name.trim()) {
      return sendError(reply, 400, "MISSING_NAME", "Campaign name is required");
    }
    if (name.trim().length > 200) {
      return sendError(
        reply,
        400,
        "NAME_TOO_LONG",
        "Campaign name must not exceed 200 characters",
      );
    }
    if (notes && notes.length > 2000) {
      return sendError(
        reply,
        400,
        "NOTES_TOO_LONG",
        "Notes must not exceed 2,000 characters",
      );
    }
    if (!validateCampaignFields({ type, status, template_id }, reply)) return;
    if (
      recipient_count != null &&
      (recipient_count < 0 || recipient_count > 1000000)
    ) {
      return sendError(
        reply,
        400,
        "INVALID_COUNT",
        "Recipient count must be 0-1,000,000",
      );
    }
    if (sent_at && isNaN(new Date(sent_at).getTime())) {
      return sendError(
        reply,
        400,
        "INVALID_DATE",
        "sent_at must be a valid ISO date",
      );
    }

    const id = newUuid();
    const now = nowIso();
    await db
      .prepare(
        `
    INSERT INTO marketing_campaigns (id, name, type, status, template_id, sent_at, recipient_count, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      )
      .run(
        id,
        name.trim(),
        type || "email",
        status || "draft",
        template_id || null,
        sent_at || null,
        recipient_count || 0,
        notes || null,
        now,
        now,
      );

    await adminService._audit(
      admin.adminId,
      "marketing_campaign_create",
      "marketing_campaigns",
      id,
      { name: name.trim() },
    );

    const campaign = await db
      .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
      .get(id);
    reply.send({ campaign });
  });

  app.put(
    "/admin/dashboard/marketing/campaigns/:id",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const existing = await db
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(request.params.id);
      if (!existing) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const {
        name,
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      } = request.body || {};

      if (name !== undefined && name.trim().length > 200) {
        return sendError(
          reply,
          400,
          "NAME_TOO_LONG",
          "Campaign name must not exceed 200 characters",
        );
      }
      if (notes !== undefined && notes && notes.length > 2000) {
        return sendError(
          reply,
          400,
          "NOTES_TOO_LONG",
          "Notes must not exceed 2,000 characters",
        );
      }
      if (!validateCampaignFields({ type, status, template_id }, reply)) return;
      if (sent_at && isNaN(new Date(sent_at).getTime())) {
        return sendError(
          reply,
          400,
          "INVALID_DATE",
          "sent_at must be a valid ISO date",
        );
      }

      // Validate numeric stats
      const stats = {
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
      };
      for (const [key, val] of Object.entries(stats)) {
        if (
          val != null &&
          (val < 0 || val > 1000000 || !Number.isInteger(val))
        ) {
          return sendError(
            reply,
            400,
            "INVALID_STAT",
            `${key} must be a non-negative integer up to 1,000,000`,
          );
        }
      }

      // Build update set from provided fields (allowlisted columns only)
      const ALLOWED_COLUMNS = [
        "name",
        "type",
        "status",
        "template_id",
        "sent_at",
        "recipient_count",
        "opens",
        "clicks",
        "replies",
        "bounces",
        "unsubscribes",
        "notes",
      ];
      const candidates = {
        name: name?.trim(),
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      };
      const updates = {};
      for (const [k, v] of Object.entries(candidates)) {
        if (v !== undefined) {
          if (!ALLOWED_COLUMNS.includes(k)) continue;
          updates[k] = v;
        }
      }

      if (Object.keys(updates).length === 0) {
        return sendError(reply, 400, "NO_CHANGES", "No fields to update");
      }

      updates.updated_at = nowIso();
      const setClauses = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = [...Object.values(updates), request.params.id];
      await db
        .prepare(`UPDATE marketing_campaigns SET ${setClauses} WHERE id = ?`)
        .run(...values);

      await adminService._audit(
        admin.adminId,
        "marketing_campaign_update",
        "marketing_campaigns",
        request.params.id,
        {
          fields_changed: Object.keys(updates).filter(
            (k) => k !== "updated_at",
          ),
        },
      );

      const campaign = await db
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(request.params.id);
      reply.send({ campaign });
    },
  );

  app.post(
    "/admin/dashboard/marketing/campaigns/:id/send-push",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, [
        "admin",
        "superadmin",
      ]);
      if (!admin) return;

      const campaign = await db
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(request.params.id);
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (campaign.type !== "push") {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_TYPE",
          "Only push campaigns can be sent through OneSignal",
        );
      }
      if (!oneSignalService.isConfigured()) {
        return sendError(
          reply,
          503,
          "ONESIGNAL_NOT_CONFIGURED",
          "OneSignal credentials are not configured",
        );
      }

      const title = normalizePushText(request.body?.title);
      const body = normalizePushText(request.body?.body);
      const imageUrl =
        normalizePushText(request.body?.image_url || request.body?.imageUrl) ||
        null;
      const dryRun =
        request.body?.dry_run === true || request.body?.dryRun === true;
      const segments = normalizeOneSignalSegments(request.body || {});
      const userIds = normalizeUserIds(
        request.body?.user_ids || request.body?.userIds,
      );

      if (!title) {
        return sendError(reply, 400, "MISSING_TITLE", "Push title is required");
      }
      if (!body) {
        return sendError(reply, 400, "MISSING_BODY", "Push body is required");
      }
      if (title.length > MAX_PUSH_TITLE_LENGTH) {
        return sendError(
          reply,
          400,
          "TITLE_TOO_LONG",
          `Push title must not exceed ${MAX_PUSH_TITLE_LENGTH} characters`,
        );
      }
      if (body.length > MAX_PUSH_BODY_LENGTH) {
        return sendError(
          reply,
          400,
          "BODY_TOO_LONG",
          `Push body must not exceed ${MAX_PUSH_BODY_LENGTH} characters`,
        );
      }
      if (userIds.length === 0 && segments.length === 0) {
        return sendError(
          reply,
          400,
          "MISSING_TARGET",
          "At least one segment or user ID is required",
        );
      }
      if (
        request.body?.data &&
        (typeof request.body.data !== "object" ||
          Array.isArray(request.body.data))
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DATA",
          "Push data must be an object",
        );
      }

      const pushData = {
        ...(request.body?.data || {}),
        campaign_id: campaign.id,
        campaign_name: campaign.name,
      };
      const target =
        userIds.length > 0
          ? { type: "users", user_ids: userIds }
          : { type: "segments", segments };

      if (dryRun) {
        return reply.send({
          success: true,
          dry_run: true,
          configured: true,
          target,
          title,
          body,
        });
      }

      if (request.body?.confirm !== "SEND_PUSH") {
        return sendError(
          reply,
          400,
          "CONFIRMATION_REQUIRED",
          "Set confirm to SEND_PUSH before sending a live push",
        );
      }

      let response;
      try {
        response =
          userIds.length > 0
            ? await oneSignalService.sendToUsers({
                userIds,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              })
            : await oneSignalService.sendToSegment({
                segments,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              });
      } catch (err) {
        request.log?.error(
          { err, campaignId: campaign.id },
          "OneSignal push send failed",
        );
        return sendError(
          reply,
          err.status || 502,
          "ONESIGNAL_SEND_FAILED",
          "OneSignal rejected the push send request",
        );
      }

      const sentAt = nowIso();
      const recipients = oneSignalRecipientCount(response);
      const targetLabel =
        userIds.length > 0 ? `users:${userIds.length}` : segments.join(",");

      await db
        .prepare(
          `
    INSERT INTO push_campaigns (
      id, name, segment, title, body, data_json, image_url,
      onesignal_notification_id, sent_at, recipients_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
        )
        .run(
          newUuid(),
          campaign.name,
          targetLabel,
          title,
          body,
          JSON.stringify(pushData),
          imageUrl,
          response.id || null,
          sentAt,
          recipients,
          sentAt,
        );

      await db
        .prepare(
          `
    UPDATE marketing_campaigns
    SET status = 'sent', sent_at = ?, recipient_count = ?, updated_at = ?
    WHERE id = ?
  `,
        )
        .run(sentAt, recipients, sentAt, campaign.id);

      await adminService._audit(
        admin.adminId,
        "marketing_push_send",
        "marketing_campaigns",
        campaign.id,
        {
          onesignal_notification_id: response.id || null,
          recipients,
          target,
        },
      );

      const updated = await db
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(campaign.id);
      reply.send({
        success: true,
        campaign: updated,
        onesignal: {
          id: response.id || null,
          recipients,
        },
      });
    },
  );

  // --- Import GMass Results ---
  app.post(
    "/admin/dashboard/marketing/campaigns/:id/import-results",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const campaign = await db
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(request.params.id);
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (!["sent", "completed"].includes(campaign.status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Can only import results for sent or completed campaigns",
        );
      }

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 5,
        maxRows: 50000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const GMASS_HEADERS = new Set([
        "emailaddress",
        "email",
        "email_address",
        "opened",
        "clicked",
        "replied",
        "bounced",
        "unsubscribed",
      ]);

      const rawHeaders = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      // Validate that CSV has an email column
      const hasEmailColumn = rawHeaders.some(
        (h) => h === "emailaddress" || h === "email" || h === "email_address",
      );
      if (!hasEmailColumn) {
        return sendError(
          reply,
          400,
          "MISSING_EMAIL",
          "CSV must have an EmailAddress or Email column",
        );
      }

      function isEngaged(val) {
        const v = val?.trim().toLowerCase();
        return v === "x" || v === "1" || v === "true";
      }

      let matched = 0;
      let skippedUnknown = 0;
      let bouncedCount = 0;
      let unsubscribedCount = 0;
      const now = nowIso();
      const campaignId = request.params.id;

      await db.prepare("BEGIN").run();
      try {
        for (const row of rows) {
          const cols = parseCsvRow(row);
          const record = Object.create(null);
          rawHeaders.forEach((h, i) => {
            if (GMASS_HEADERS.has(h)) record[h] = cols[i] || null;
          });

          const email = normalizeEmail(record);
          if (!email) {
            skippedUnknown++;
            continue;
          }

          // Match to existing contact
          const contact = await db
            .prepare(
              "SELECT id, status FROM marketing_contacts WHERE email = ?",
            )
            .get(email);
          if (!contact) {
            skippedUnknown++;
            continue;
          }

          const opened = isEngaged(record.opened) ? 1 : 0;
          const clicked = isEngaged(record.clicked) ? 1 : 0;
          const replied = isEngaged(record.replied) ? 1 : 0;
          const bounced = isEngaged(record.bounced) ? 1 : 0;
          const unsub = isEngaged(record.unsubscribed) ? 1 : 0;

          // Upsert engagement — additive-only (OR-merge: once true, always true)
          await db
            .prepare(
              `
        INSERT INTO marketing_engagements (id, contact_id, campaign_id, opened, clicked, replied, bounced, unsubscribed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (contact_id, campaign_id) DO UPDATE SET
          opened = MAX(marketing_engagements.opened, excluded.opened),
          clicked = MAX(marketing_engagements.clicked, excluded.clicked),
          replied = MAX(marketing_engagements.replied, excluded.replied),
          bounced = MAX(marketing_engagements.bounced, excluded.bounced),
          unsubscribed = MAX(marketing_engagements.unsubscribed, excluded.unsubscribed),
          updated_at = excluded.updated_at
      `,
            )
            .run(
              newUuid(),
              contact.id,
              campaignId,
              opened,
              clicked,
              replied,
              bounced,
              unsub,
              now,
              now,
            );

          // One-directional contact status: bounced/unsubscribed never revert to active
          if (bounced && contact.status === "active") {
            await db
              .prepare(
                "UPDATE marketing_contacts SET status = 'bounced', updated_at = ? WHERE id = ?",
              )
              .run(now, contact.id);
            bouncedCount++;
          }
          if (unsub && contact.status !== "unsubscribed") {
            await db
              .prepare(
                "UPDATE marketing_contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?",
              )
              .run(now, contact.id);
            unsubscribedCount++;
          }

          matched++;
        }

        // Recalculate campaign aggregate stats from engagements
        const stats = await db
          .prepare(
            `
      SELECT
        COUNT(*) as recipient_count,
        SUM(opened) as opens,
        SUM(clicked) as clicks,
        SUM(replied) as replies,
        SUM(bounced) as bounces,
        SUM(unsubscribed) as unsubscribes
      FROM marketing_engagements WHERE campaign_id = ?
    `,
          )
          .get(campaignId);

        await db
          .prepare(
            `
      UPDATE marketing_campaigns SET
        recipient_count = ?, opens = ?, clicks = ?, replies = ?, bounces = ?, unsubscribes = ?,
        updated_at = ?
      WHERE id = ?
    `,
          )
          .run(
            stats.recipient_count || 0,
            stats.opens || 0,
            stats.clicks || 0,
            stats.replies || 0,
            stats.bounces || 0,
            stats.unsubscribes || 0,
            now,
            campaignId,
          );

        await db.prepare("COMMIT").run();
      } catch (err) {
        await db.prepare("ROLLBACK").run();
        throw err;
      }

      await adminService._audit(
        admin.adminId,
        "marketing_results_import",
        "marketing_campaigns",
        campaignId,
        {
          filename,
          matched,
          skipped: skippedUnknown,
          bounced: bouncedCount,
          unsubscribed: unsubscribedCount,
          total_rows: rows.length,
        },
      );

      reply.send({
        success: true,
        matched,
        skipped: skippedUnknown,
        bounced: bouncedCount,
        unsubscribed: unsubscribedCount,
        total: rows.length,
      });
    },
  );

  // --- Campaign Engagements ---
  app.get(
    "/admin/dashboard/marketing/campaigns/:id/engagements",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const campaign = await db
        .prepare("SELECT id FROM marketing_campaigns WHERE id = ?")
        .get(request.params.id);
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const { limit, offset } = parsePagination(request.query);
      const { opened, clicked, replied, bounced } = request.query;
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;
      const repliedFilter = parseBooleanFilter(replied, "replied", reply);
      if (repliedFilter === null) return;
      const bouncedFilter = parseBooleanFilter(bounced, "bounced", reply);
      if (bouncedFilter === null) return;

      let sql = `
    SELECT mc.id, mc.first_name, mc.last_name, mc.email, mc.status as contact_status,
           me.opened, me.clicked, me.replied, me.bounced, me.unsubscribed
    FROM marketing_engagements me
    JOIN marketing_contacts mc ON mc.id = me.contact_id
    WHERE me.campaign_id = ?
  `;
      const params = [request.params.id];

      let whereExtra = "";
      if (openedFilter !== undefined) {
        whereExtra += " AND me.opened = ?";
        params.push(openedFilter);
      }
      if (clickedFilter !== undefined) {
        whereExtra += " AND me.clicked = ?";
        params.push(clickedFilter);
      }
      if (repliedFilter !== undefined) {
        whereExtra += " AND me.replied = ?";
        params.push(repliedFilter);
      }
      if (bouncedFilter !== undefined) {
        whereExtra += " AND me.bounced = ?";
        params.push(bouncedFilter);
      }
      sql += whereExtra;

      // Count before pagination
      const countSql = `SELECT COUNT(*) as total FROM marketing_engagements me JOIN marketing_contacts mc ON mc.id = me.contact_id WHERE me.campaign_id = ?${whereExtra}`;
      const { total } = await db.prepare(countSql).get(...params);

      sql += " ORDER BY mc.email ASC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const engagements = await db.prepare(sql).all(...params);
      reply.send({ engagements, total, limit, offset });
    },
  );

  // --- Export Contacts CSV ---
  app.get(
    "/admin/dashboard/marketing/contacts/export",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const { status, campaign_id, opened, clicked } = request.query;
      if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
        );
      }
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;

      let sql;
      let params;

      if (campaign_id) {
        const campaign = await db
          .prepare("SELECT id FROM marketing_campaigns WHERE id = ?")
          .get(campaign_id);
        if (!campaign) {
          return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
        }

        // Export contacts filtered by engagement with a specific campaign
        sql = `
      SELECT mc.first_name, mc.last_name, mc.email
      FROM marketing_contacts mc
      JOIN marketing_engagements me ON me.contact_id = mc.id AND me.campaign_id = ?
      WHERE 1=1
    `;
        params = [campaign_id];

        if (status) {
          sql += " AND mc.status = ?";
          params.push(status);
        }

        if (openedFilter !== undefined) {
          sql += " AND me.opened = ?";
          params.push(openedFilter);
        }
        if (clickedFilter !== undefined) {
          sql += " AND me.clicked = ?";
          params.push(clickedFilter);
        }
      } else {
        // Export all contacts with status filter
        sql = "SELECT first_name, last_name, email FROM marketing_contacts";
        params = [];

        if (status) {
          sql += " WHERE status = ?";
          params.push(status);
        }
      }

      sql += " ORDER BY email ASC";
      const contacts = await db.prepare(sql).all(...params);

      // Build CSV
      const csvLines = ["First Name,Last Name,Email"];
      for (const c of contacts) {
        csvLines.push(
          `${sanitizeCsvCell(c.first_name)},${sanitizeCsvCell(c.last_name)},${sanitizeCsvCell(c.email)}`,
        );
      }

      await adminService._audit(
        admin.adminId,
        "marketing_contacts_export",
        "marketing_contacts",
        null,
        {
          filters: { status, campaign_id, opened, clicked },
          row_count: contacts.length,
        },
      );

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
        .header("Cache-Control", "no-store")
        .send(csvLines.join("\n"));
    },
  );

  // Phase 2: Step history API — per-job step execution timeline
  app.get("/admin/dashboard/jobs/:id/steps", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const steps = await adminService.getJobStepHistory(request.params.id);
    reply.send({ steps });
  });

  // Admin SPA catch-all - serves index.html for client-side routing
  // ============ TRACK TRANSFER ============

  app.post(
    "/admin/dashboard/tracks/:trackId/transfer",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;

      const { trackId } = request.params;
      const { target_user_id } = request.body || {};

      if (!target_user_id) {
        sendError(reply, 400, "MISSING_TARGET", "target_user_id is required.");
        return;
      }

      // Verify track exists and is not deleted
      const track = await db
        .prepare(
          "SELECT id, user_id, title FROM tracks WHERE id = ? AND deleted_at IS NULL",
        )
        .get(trackId);
      if (!track) {
        sendError(reply, 404, "TRACK_NOT_FOUND", "Track not found.");
        return;
      }

      // Verify target user exists
      const targetUser = await db
        .prepare("SELECT id, email, display_name FROM users WHERE id = ?")
        .get(target_user_id);
      if (!targetUser) {
        sendError(reply, 404, "USER_NOT_FOUND", "Target user not found.");
        return;
      }

      if (track.user_id === target_user_id) {
        sendError(
          reply,
          400,
          "ALREADY_OWNED",
          "Track already belongs to this user.",
        );
        return;
      }

      // Block transfer if track has active jobs
      const activeJob = await db
        .prepare(
          "SELECT id FROM jobs WHERE track_version_id IN (SELECT id FROM track_versions WHERE track_id = ?) AND status IN ('queued', 'processing')",
        )
        .get(trackId);
      if (activeJob) {
        sendError(
          reply,
          409,
          "ACTIVE_JOB",
          "Track has an active render job. Wait for it to complete before transferring.",
        );
        return;
      }

      const sourceUserId = track.user_id;
      const now = nowIso();
      const transferId = newUuid();

      try {
        await db.transaction(async (query) => {
          // 1. tracks.user_id — optimistic lock: WHERE user_id = sourceUserId prevents TOCTOU race
          const trackResult = await query(
            "UPDATE tracks SET user_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            [target_user_id, now, trackId, sourceUserId],
          );
          if (!(trackResult?.changes ?? trackResult?.rowCount ?? 0)) {
            throw new Error("CONCURRENT_TRANSFER");
          }

          // 2. track_library_entries — remove source user's entry, upsert for target user
          await query(
            "DELETE FROM track_library_entries WHERE track_id = ? AND user_id = ?",
            [trackId, sourceUserId],
          );
          await query(
            "INSERT INTO track_library_entries (user_id, track_id, origin, added_at, updated_at) VALUES (?, ?, 'created', ?, ?) ON CONFLICT (user_id, track_id) DO UPDATE SET origin = 'created', removed_at = NULL, updated_at = ?",
            [target_user_id, trackId, now, now, now],
          );

          // 3. share_tokens — update creator, reset binding so recipient can claim fresh
          await query(
            "UPDATE share_tokens SET creator_id = ?, status = 'unbound', bound_device_id = NULL, bound_user_id = NULL, bound_at = NULL, claim_attempts = 0 WHERE track_id = ?",
            [target_user_id, trackId],
          );

          // 4. audit_logs — do NOT rewrite historical entries (compliance requirement).
          //    Only log the transfer itself so provenance is traceable.
          await query(
            "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              transferId,
              target_user_id,
              "track_transferred",
              "track",
              trackId,
              JSON.stringify({
                from_user: sourceUserId,
                to_user: target_user_id,
                admin: admin.email,
              }),
              now,
            ],
          );
        });
      } catch (err) {
        if (err.message === "CONCURRENT_TRANSFER") {
          sendError(
            reply,
            409,
            "CONCURRENT_TRANSFER",
            "Track ownership changed during transfer. Please retry.",
          );
          return;
        }
        console.error("[Admin] Track transfer failed:", err.message);
        sendError(
          reply,
          500,
          "TRANSFER_FAILED",
          "Track transfer failed. No changes were made.",
        );
        return;
      }

      // Verify final state (outside transaction — read-only)
      const updatedTrack = await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(trackId);
      const libraryEntry = await db
        .prepare(
          "SELECT user_id, origin FROM track_library_entries WHERE track_id = ? AND user_id = ?",
        )
        .get(trackId, target_user_id);
      const shareToken = await db
        .prepare(
          "SELECT creator_id, status, bound_user_id FROM share_tokens WHERE track_id = ?",
        )
        .get(trackId);

      reply.send({
        transferred: true,
        track_id: trackId,
        title: track.title,
        from_user: sourceUserId,
        to_user: target_user_id,
        to_name: targetUser.display_name || null,
        verification: {
          track_owner: updatedTrack?.user_id,
          library_owner: libraryEntry?.user_id,
          library_origin: libraryEntry?.origin,
          share_creator: shareToken?.creator_id,
          share_status: shareToken?.status,
        },
      });
    },
  );

  // Must come AFTER all /admin/* API routes so they take precedence
  // Using fs.readFile instead of reply.sendFile because decorateReply: false on static registrations
  const adminIndexPath = path.join(process.cwd(), "public/admin/index.html");
  const adminStaticRoot = path.join(process.cwd(), "public/admin");

  app.get("/admin/assets/*", async (request, reply) => {
    const assetPath = request.params["*"];
    return sendAdminStaticFile(
      reply,
      path.join(adminStaticRoot, "assets"),
      assetPath,
    );
  });

  app.get("/admin", async (request, reply) => {
    const fs = require("fs").promises;
    const content = await fs.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  app.get("/admin/*", async (request, reply) => {
    // Handles client-side routes: /admin/login, /admin/users, /admin/jobs, etc.
    const fs = require("fs").promises;
    const content = await fs.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  return { requireAdminRole };
}

module.exports = { registerAdminRoutes };
