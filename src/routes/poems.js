"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { newUuid } = require("../utils/ids");
const { nowIso, toJson, parseJson } = require("../utils/common");
const { moderationCheck } = require("../providers/moderation");
const { generatePoem, OCCASIONS, POEM_TONES } = require("../services/poem-generator");
const { ensurePoemShareToken, healAndCheckShare } = require("../services/share-service");

function registerPoemRoutes(app, {
  db,
  appConfig,
  config,
  requireUserId,
  sendError,
  consumeRateLimit,
  addAuditEntry,
  eventsService,
  sendMediaFile,
  ensureDir,
  upsertPoemLibraryEntry,
  withPoemLibraryFlags,
  getPoemForLibrary,
  buildPoemShareUrl,
  buildShareAppDownloadUrl,
  normalizeVariantName,
  generatePoemOgPreview,
  POEM_VARIANT_NAMES,
  POEM_VARIANT_LABELS,
  allowAnonUserId,
  ensureUser,
  getDeviceTokenPayload,
  poemAudioGenerationLocks,
  subscriptionManager,
}) {
  function resolveGiftReadyAt(shareRow) {
    if (!shareRow || shareRow.delivery_source !== "gift") {
      return null;
    }
    const dispatchedAt = Date.parse(shareRow.dispatched_at || "");
    if (Number.isFinite(dispatchedAt)) {
      return null;
    }
    const sendAt = Date.parse(shareRow.gift_send_at || shareRow.dispatch_at || "");
    return Number.isFinite(sendAt) ? sendAt : null;
  }

  async function resolveValidPoemShare(shareId, reply) {
    const share = await db.prepare(
      `SELECT pst.*, go.send_at AS gift_send_at
         FROM poem_share_tokens pst
         LEFT JOIN gift_orders go ON go.id = pst.gift_order_id
        WHERE pst.id = ?`
    ).get(shareId);
    if (!share || share.status === "revoked") {
      sendError(reply, 404, "SHARE_NOT_FOUND", "Poem share not found.");
      return null;
    }
    if (!await healAndCheckShare(db, share, "poem_share_tokens", "active")) {
      sendError(reply, 410, "SHARE_EXPIRED", "Poem share expired.");
      return null;
    }
    const readyAt = resolveGiftReadyAt(share);
    if (Number.isFinite(readyAt) && readyAt > Date.now()) {
      sendError(reply, 403, "GIFT_NOT_READY", "This gift is not ready yet.");
      return null;
    }
    return share;
  }

  async function enforcePoemClaimRateLimit(request, reply, shareId) {
    if (typeof consumeRateLimit !== "function") return true;
    const ip = request.ip || "unknown";
    const coarse = await consumeRateLimit(`poem-claim:${ip}:all`, "poem_claim", 30, 60);
    if (coarse && !coarse.allowed) {
      if (coarse.reset_at) {
        const resetMs = Date.parse(coarse.reset_at);
        reply.header("Retry-After", String(Number.isFinite(resetMs) ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)) : 60));
      }
      sendError(reply, 429, "RATE_LIMITED", "Too many claim attempts. Please try again shortly.");
      return false;
    }
    const limit = await consumeRateLimit(`poem-claim:${ip}:${shareId}`, "poem_claim", 10, 60);
    if (limit && !limit.allowed) {
      if (limit.reset_at) {
        const resetMs = Date.parse(limit.reset_at);
        reply.header("Retry-After", String(Number.isFinite(resetMs) ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)) : 60));
      }
      sendError(reply, 429, "RATE_LIMITED", "Too many claim attempts. Please try again shortly.");
      return false;
    }
    return true;
  }


  // ============ Poems ============

  async function resolveGiftPoemContent(share) {
    const livePoem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(share.poem_id);
    if (!share?.gift_order_id) {
      return {
        poem: livePoem,
        verses: parseJson(livePoem?.verses, [], `poem ${livePoem?.id || "unknown"} verses`),
      };
    }

    const giftOrder = await db
      .prepare("SELECT content_snapshot_json FROM gift_orders WHERE id = ?")
      .get(share.gift_order_id);
    const snapshot = parseJson(giftOrder?.content_snapshot_json, null, `gift ${share.gift_order_id} snapshot`);
    if (!snapshot || typeof snapshot !== "object") {
      return {
        poem: livePoem,
        verses: parseJson(livePoem?.verses, [], `poem ${livePoem?.id || "unknown"} verses`),
      };
    }

    return {
      poem: {
        id: share.poem_id,
        user_id: share.creator_id,
        title: snapshot.title || livePoem?.title || null,
        recipient_name: snapshot.recipient_name || livePoem?.recipient_name || null,
        occasion: snapshot.occasion || livePoem?.occasion || null,
        tone: snapshot.tone || livePoem?.tone || null,
        message: snapshot.message ?? livePoem?.message ?? null,
        status: livePoem?.status || "generated",
        created_at: livePoem?.created_at || share.created_at,
        updated_at: livePoem?.updated_at || share.created_at,
      },
      verses: Array.isArray(snapshot.verses) ? snapshot.verses : [],
    };
  }

  /**
   * POST /poems - Create a new personalized poem
   */
  app.post("/poems", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const body = request.body || {};
    const { title, recipient_name, occasion, tone, message } = body;

    // Validate required fields
    if (!title || !recipient_name || !occasion) {
      sendError(reply, 400, "MISSING_REQUIRED_FIELDS", "title, recipient_name, and occasion are required.");
      return;
    }

    // Validate occasion and tone against known values
    if (!OCCASIONS[occasion]) {
      sendError(reply, 400, "INVALID_OCCASION", `Invalid occasion. Valid values: ${Object.keys(OCCASIONS).join(", ")}`);
      return;
    }
    if (tone && !POEM_TONES[tone]) {
      sendError(reply, 400, "INVALID_TONE", `Invalid tone. Valid values: ${Object.keys(POEM_TONES).join(", ")}`);
      return;
    }

    // Moderation check
    const moderation = moderationCheck({ title, message: message || "", recipient_name });
    if (!moderation.allowed) {
      sendError(reply, 403, "MODERATION_BLOCKED", "Content blocked by moderation.", {
        reason: moderation.reason,
      });
      return;
    }

    const poemId = newUuid();
    const now = nowIso();

    await db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poemId,
      userId,
      title,
      recipient_name,
      occasion,
      tone || "heartfelt",
      "[]", // Empty verses for draft
      message || null,
      "draft",
      now,
      now
    );
    await upsertPoemLibraryEntry({
      userId,
      poemId,
      origin: "created",
      shareTokenId: null,
      addedAt: now,
    });

    await addAuditEntry({
      userId,
      action: "poem_created",
      resourceType: "poem",
      resourceId: poemId,
    });

    reply.code(201).send({
      id: poemId,
      title,
      recipient_name,
      occasion,
      tone: tone || "heartfelt",
      verses: [],
      message: message || null,
      status: "draft",
      created_at: now,
      updated_at: now,
    });
  });

  /**
   * GET /poems - List user's poems
   */
  app.get("/poems", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poems = await db
      .prepare(
        `SELECT p.*,
                ple.origin AS library_origin,
                ple.added_at AS library_added_at,
                ple.share_token_id AS library_share_token_id,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_edit,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS can_share,
                1 AS can_delete
         FROM poems p
         JOIN poem_library_entries ple
           ON ple.poem_id = p.id
          AND ple.user_id = ?
          AND ple.removed_at IS NULL
         WHERE p.deleted_at IS NULL
           AND NOT (COALESCE(p.funding_source, 'standard') = 'gift_token' AND ple.origin = 'created')
         ORDER BY ple.added_at DESC`
      )
      .all(userId, userId, userId);

    // Parse verses JSON for each poem
    const parsedPoems = poems.map(row => ({
      ...withPoemLibraryFlags(row),
      verses: parseJson(row.verses, [], `poem ${row.id} verses`),
    }));

    reply.send({ poems: parsedPoems });
  });

  /**
   * GET /poems/:id - Get specific poem
   */
  app.get("/poems/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    let poemRow = await getPoemForLibrary(userId, request.params.id);
    if (!poemRow) {
      const ownedGiftPoem = await db.prepare(
        `SELECT p.*,
                NULL AS library_origin,
                NULL AS library_added_at,
                NULL AS library_share_token_id,
                1 AS can_edit,
                1 AS can_share,
                1 AS can_delete
           FROM poems p
          WHERE p.id = ?
            AND p.user_id = ?
            AND p.deleted_at IS NULL
            AND COALESCE(p.funding_source, 'standard') = 'gift_token'`
      ).get(request.params.id, userId);
      poemRow = ownedGiftPoem || null;
    }

    const poem = withPoemLibraryFlags(poemRow);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    reply.send({
      poem: {
        ...poem,
        verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
      },
    });
  });

  /**
   * PUT /poems/:id - Update poem
   */
  app.put("/poems/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ?").get(request.params.id);
    if (!poem || poem.user_id !== userId || poem.deleted_at) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const body = request.body || {};
    const { title, recipient_name, occasion, tone, message, verses, status } = body;

    // Moderation check if content is being updated
    if (title || message || recipient_name) {
      const moderation = moderationCheck({
        title: title || poem.title,
        message: message || poem.message || "",
        recipient_name: recipient_name || poem.recipient_name,
      });
      if (!moderation.allowed) {
        sendError(reply, 403, "MODERATION_BLOCKED", "Content blocked by moderation.", {
          reason: moderation.reason,
        });
        return;
      }
    }

    const now = nowIso();
    const updatedTitle = title !== undefined ? title : poem.title;
    const updatedRecipientName = recipient_name !== undefined ? recipient_name : poem.recipient_name;
    const updatedOccasion = occasion !== undefined ? occasion : poem.occasion;
    const updatedTone = tone !== undefined ? tone : poem.tone;
    const updatedMessage = message !== undefined ? message : poem.message;
    const updatedVerses = verses !== undefined ? toJson(verses) : poem.verses;
    // API-16: Whitelist valid poem statuses to prevent arbitrary DB writes
    const VALID_POEM_STATUSES = new Set(["draft", "generating", "generated", "generation_failed", "published", "archived"]);
    if (status !== undefined && !VALID_POEM_STATUSES.has(status)) {
      sendError(reply, 400, "INVALID_STATUS", `Invalid status. Must be one of: ${[...VALID_POEM_STATUSES].join(", ")}`);
      return;
    }
    const updatedStatus = status !== undefined ? status : poem.status;

    await db.prepare(
      `UPDATE poems SET title = ?, recipient_name = ?, occasion = ?, tone = ?, message = ?, verses = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(
      updatedTitle,
      updatedRecipientName,
      updatedOccasion,
      updatedTone,
      updatedMessage,
      updatedVerses,
      updatedStatus,
      now,
      poem.id
    );

    await addAuditEntry({
      userId,
      action: "poem_updated",
      resourceType: "poem",
      resourceId: poem.id,
    });

    reply.send({
      poem: {
        id: poem.id,
        user_id: userId,
        title: updatedTitle,
        recipient_name: updatedRecipientName,
        occasion: updatedOccasion,
        tone: updatedTone,
        message: updatedMessage,
        verses: parseJson(updatedVerses, [], `poem ${poem.id} verses`),
        status: updatedStatus,
        created_at: poem.created_at,
        updated_at: now,
      },
    });
  });

  /**
   * DELETE /poems/:id - Soft delete poem
   */
  app.delete("/poems/:id", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const now = nowIso();
    await db.prepare(
      "UPDATE poem_library_entries SET removed_at = ?, updated_at = ? WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL"
    ).run(now, now, userId, poem.id);

    await addAuditEntry({
      userId,
      action: "poem_library_removed",
      resourceType: "poem",
      resourceId: poem.id,
    });

    reply.send({ deleted: true });
  });

  /**
   * POST /poems/:id/generate - Generate verses for a poem
   */
  app.post("/poems/:id/generate", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    // Rate limit: 20 poem generations per hour (uses LLM resources)
    const limit = await consumeRateLimit(userId, "poem_generate", 20, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Poem generation rate limit reached.", {
        retry_at: limit.reset_at,
      });
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    // Pre-check: gate access before expensive LLM call
    const entitlements = await db.prepare("SELECT poems_remaining FROM entitlements WHERE user_id = ?").get(userId);
    if (!entitlements || entitlements.poems_remaining <= 0) {
      console.warn("[SecurityGuard:CreditCheck] Poem credit check blocked for user", userId);
      sendError(reply, 402, "INSUFFICIENT_POEM_CREDITS", "No poem credits remaining");
      return;
    }

    try {
      const result = await generatePoem({
        recipient_name: poem.recipient_name,
        occasion: poem.occasion,
        tone: poem.tone || "heartfelt",
        message: poem.message || "",
      });

      const now = nowIso();
      const versesJson = toJson(result.verses);

      await db.prepare(
        `UPDATE poems SET verses = ?, status = ?, updated_at = ? WHERE id = ?`
      ).run(versesJson, "generated", now, poem.id);

      // Entitlement check: spend credit after successful generation
      try {
        await subscriptionManager.spendPoem(userId, poem.id);
      } catch (spendErr) {
        // Generation succeeded but credit spend failed — don't give away free content
        await db.prepare("UPDATE poems SET status = 'generation_failed' WHERE id = ?").run(poem.id);
        return sendError(reply, 503, "CREDIT_ERROR", "Unable to process credit. Please try again.");
      }

      await addAuditEntry({
        userId,
        action: "poem_generated",
        resourceType: "poem",
        resourceId: poem.id,
        metadata: { provider: "llm" },
      });

      reply.send({
        poem: {
          ...poem,
          verses: result.verses,
          status: "generated",
          updated_at: now,
        },
      });
    } catch (error) {
      console.error("[poems/generate] Generation failed:", error.message);
      // Handle specific error codes from poem generator
      if (error.code === "AI_UNAVAILABLE") {
        sendError(reply, 503, "AI_UNAVAILABLE", "AI service is temporarily unavailable. Please try again later.");
      } else if (error.code === "POEM_GENERATION_FAILED") {
        sendError(reply, 500, "GENERATION_FAILED", "Failed to generate poem. Please try again.");
      } else {
        sendError(reply, 500, "GENERATION_FAILED", "Failed to generate poem verses.");
      }
    }
  });

  // ============ Poem Sharing ============

  /**
   * POST /poems/:id/share - Create share token for a poem
   */
  app.post("/poems/:id/share", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    // Check if poem has content
    const verses = parseJson(poem.verses, [], `poem ${poem.id} verses`);
    if (!verses || verses.length === 0) {
      sendError(reply, 409, "POEM_NOT_READY", "Poem has no verses to share.");
      return;
    }

    // Apply og_variant selection before idempotency check so re-shares can update variant
    const body = request.body || {};
    if (body.og_variant !== undefined) {
      const rawVariant = body.og_variant;
      const providedVariant = rawVariant === null ? "" : String(rawVariant).trim();
      const normalizedVariant = normalizeVariantName(rawVariant, POEM_VARIANT_NAMES);
      if (providedVariant && !normalizedVariant) {
        sendError(reply, 400, "INVALID_VARIANT", `Invalid variant. Must be one of: ${POEM_VARIANT_NAMES.join(", ")}`);
        return;
      }
      await db.prepare("UPDATE poems SET og_variant = ?, updated_at = ? WHERE id = ?")
        .run(normalizedVariant, nowIso(), poem.id);
    }

    const utmSource = request.query.utm_source || body.utm_source || null;
    const utmMedium = request.query.utm_medium || body.utm_medium || null;
    const utmCampaign = request.query.utm_campaign || body.utm_campaign || null;

    const result = await ensurePoemShareToken({
      db,
      poemId: poem.id,
      userId,
      allowSave: body.allow_save !== undefined ? Boolean(body.allow_save) : true,
      buildShareUrl: buildPoemShareUrl,
      attribution: {
        utmSource,
        utmMedium,
        utmCampaign,
        referrer: request.headers.referer || request.headers.referrer || null,
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
      },
    });

    if (!result.existing) {
      await addAuditEntry({
        userId,
        action: "poem_share_created",
        resourceType: "poem_share_token",
        resourceId: result.shareId,
      });
      eventsService.emit("poem_share_create", {
        userId,
        resourceType: "poem_share",
        resourceId: result.shareId,
        metadata: {
          poem_id: poem.id,
          occasion: poem.occasion,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
        },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
    }

    reply.send({
      share_id: result.shareId,
      share_url: result.shareUrl,
      expires_at: result.expiresAt,
      claim_pin: result.claimPin,
    });
  });

  // ============ Poem OG Preview Endpoints ============

  /**
   * GET /poems/:id/og-previews - Get all poem OG variant thumbnails
   */
  app.get("/poems/:id/og-previews", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const verses = parseJson(poem.verses, []);
    const params = { title: poem.title, recipientName: poem.recipient_name, occasion: poem.occasion, verses };

    const variants = [];
    for (const name of POEM_VARIANT_NAMES) {
      const buf = await generatePoemOgPreview(name, params);
      if (!buf) {
        sendError(reply, 503, "IMAGE_GENERATION_UNAVAILABLE", "Image generation is not available.");
        return;
      }
      variants.push({ name, label: POEM_VARIANT_LABELS[name], preview: `data:image/png;base64,${buf.toString("base64")}` });
    }

    reply
      .header("Cache-Control", "no-store")
      .send({ current_variant: normalizeVariantName(poem.og_variant, POEM_VARIANT_NAMES), variants });
  });

  /**
   * GET /poems/:id/og-preview/:variant - Get single poem OG variant thumbnail
   */
  app.get("/poems/:id/og-preview/:variant", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await db.prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL").get(request.params.id);
    if (!poem || poem.user_id !== userId) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    if (!POEM_VARIANT_NAMES.includes(request.params.variant)) {
      sendError(reply, 400, "INVALID_VARIANT", `Invalid variant. Must be one of: ${POEM_VARIANT_NAMES.join(", ")}`);
      return;
    }

    const verses = parseJson(poem.verses, []);
    const buf = await generatePoemOgPreview(request.params.variant, { title: poem.title, recipientName: poem.recipient_name, occasion: poem.occasion, verses });
    if (!buf) {
      sendError(reply, 503, "IMAGE_GENERATION_UNAVAILABLE", "Image generation is not available.");
      return;
    }

    reply.type("image/png").header("Cache-Control", "no-store").send(buf);
  });

  /**
   * GET /poem-share/:shareId - Get shared poem details (public)
   */
  app.get("/poem-share/:shareId", async (request, reply) => {
    const share = await resolveValidPoemShare(request.params.shareId, reply);
    if (!share) return;

    const { poem, verses } = await resolveGiftPoemContent(share);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const creator = await db.prepare("SELECT id FROM users WHERE id = ?").get(share.creator_id);

    // Update access tracking
    await db.prepare(
      "UPDATE poem_share_tokens SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?"
    ).run(nowIso(), share.id);

    // Log access
    await db.prepare(
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), share.id, "view", toJson({ ip: request.ip }), nowIso());

    const appRequired = share.claim_policy === "app_only";

    // Response shape matches iOS PoemShareInfoResponse model
    reply.send({
      status: share.status,
      can_access: true,
      poem: {
        title: poem.title,
        recipient_name: poem.recipient_name,
        occasion: poem.occasion,
        preview_lines: verses.slice(0, 2),
        verses,
        creator_name: creator ? "A friend" : "Someone special",
      },
      expires_at: share.expires_at,
      requires_pin: !!share.claim_pin && !share.bound_user_id,
      app_required: false,
      requires_pin_for_claim: !!share.claim_pin && !share.bound_user_id,
      app_required_for_claim: appRequired,
      app_download_url: buildShareAppDownloadUrl({ shareId: share.id, kind: "poem" }),
      claim_attempts: share.claim_attempts,
      max_attempts: 5,
    });
  });

  /**
   * POST /poem-share/:shareId/claim - Claim a shared poem
   */
  app.post("/poem-share/:shareId/claim", async (request, reply) => {
    // Auth is optional — web viewers use PIN as authentication
    let userId = null;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      userId = await requireUserId(request, reply);
      if (!userId) return;
    } else if (allowAnonUserId && request.headers["x-user-id"]) {
      const rawId = request.headers["x-user-id"];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
        sendError(reply, 400, "INVALID_USER_ID", "x-user-id must be a valid UUID");
        return;
      }
      userId = rawId;
      await ensureUser(userId);
    }

    const share = await resolveValidPoemShare(request.params.shareId, reply);
    if (!share) return;
    if (share.share_type === "demo") {
      sendError(reply, 403, "DEMO_SHARE", "Demo shares cannot be claimed.");
      return;
    }
    if (!await enforcePoemClaimRateLimit(request, reply, share.id)) {
      return;
    }

    const claimPolicy = share.claim_policy || "default";
    const appOnlyClaim = claimPolicy === "app_only";

    let claimDeviceToken = null;
    if (appOnlyClaim) {
      claimDeviceToken = getDeviceTokenPayload(request, reply, { required: true });
      if (!claimDeviceToken) {
        return;
      }
      if (claimDeviceToken.platform === "web") {
        sendError(reply, 400, "WEB_CLAIM_NOT_ALLOWED", "Web claims are not supported for this gift.");
        return;
      }
    }

    // If share has no PIN, require authenticated user
    if (!share.claim_pin && !userId) {
      sendError(reply, 401, "AUTH_REQUIRED", "Authentication required to claim this poem.");
      return;
    }

    // Check if already claimed by another user (only relevant when authenticated)
    if (userId && share.bound_user_id && share.bound_user_id !== userId) {
      sendError(reply, 409, "ALREADY_CLAIMED", "This poem has already been claimed.");
      return;
    }

    // Check if already claimed by this user — return 409 if already in library
    if (userId && share.bound_user_id === userId) {
      const existingEntry = await db.prepare(
        "SELECT 1 FROM poem_library_entries WHERE user_id = ? AND poem_id = ? AND removed_at IS NULL"
      ).get(userId, share.poem_id);
      if (existingEntry) {
        sendError(reply, 409, "ALREADY_IN_LIBRARY", "This poem is already in your library.");
        return;
      }
      const poem = await db.prepare("SELECT * FROM poems WHERE id = ?").get(share.poem_id);
      if (share.allow_save) {
        await upsertPoemLibraryEntry({
          userId,
          poemId: share.poem_id,
          origin: "received",
          shareTokenId: share.id,
          addedAt: share.bound_at || nowIso(),
        });
      }
      reply.send({
        status: "claimed",
        poem: poem ? {
          id: poem.id, user_id: poem.user_id, title: poem.title,
          recipient_name: poem.recipient_name, occasion: poem.occasion,
          tone: poem.tone, status: poem.status,
          verses: parseJson(poem.verses, [], `poem ${poem.id} verses`),
          created_at: poem.created_at, updated_at: poem.updated_at,
        } : null,
        allow_save: !!share.allow_save,
        expires_at: share.expires_at,
      });
      return;
    }

    const body = request.body || {};
    const { pin } = body;

    // PIN verification
    if (share.claim_pin) {
      // Reject empty/missing PINs without counting as an attempt (prevents
      // programmatic callers from burning the lockout counter).
      if (!pin) {
        sendError(reply, 401, "PIN_REQUIRED", "A PIN is required to claim this poem.");
        return;
      }

      if (share.claim_attempts >= 5) {
        await db.prepare(
          "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newUuid(), share.id, "claim_failed", toJson({ reason: "too_many_attempts" }), nowIso());
        sendError(reply, 429, "TOO_MANY_ATTEMPTS", "Too many failed PIN attempts.");
        return;
      }

      const pinStr = String(pin);
      const pinMatch = pinStr.length === share.claim_pin.length &&
        crypto.timingSafeEqual(Buffer.from(pinStr), Buffer.from(share.claim_pin));
      if (!pinMatch) {
        const attemptResult = await db.prepare(
          "UPDATE poem_share_tokens SET claim_attempts = claim_attempts + 1 WHERE id = ? AND claim_attempts < 5 AND status = 'active'"
        ).run(share.id);
        await db.prepare(
          "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newUuid(), share.id, "claim_failed", toJson({ reason: "invalid_pin" }), nowIso());
        if (!attemptResult || Number(attemptResult.changes || 0) === 0) {
          sendError(reply, 429, "TOO_MANY_ATTEMPTS", "Too many failed PIN attempts.");
          return;
        }
        sendError(reply, 401, "INVALID_PIN", "Invalid PIN.");
        return;
      }
    }

    // Claim the share — bind to user only if authenticated
    const now = nowIso();
    if (userId) {
      await db.prepare(
        "UPDATE poem_share_tokens SET status = ?, bound_user_id = ?, bound_at = ?, claim_attempts = 0 WHERE id = ?"
      ).run("claimed", userId, now, share.id);

      if (share.allow_save) {
        await upsertPoemLibraryEntry({
          userId,
          poemId: share.poem_id,
          origin: "received",
          shareTokenId: share.id,
          addedAt: now,
        });
      }

      await addAuditEntry({
        userId,
        action: "poem_share_claimed",
        resourceType: "poem_share_token",
        resourceId: share.id,
      });

      eventsService.emit("poem_share_claim", {
        userId,
        resourceType: "poem_share",
        resourceId: share.id,
        metadata: { poem_id: share.poem_id },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
    }
    // Anonymous unlocks: do NOT reset claim_attempts — prevents brute-force bypass

    await db.prepare(
      "INSERT INTO poem_share_access_log (id, poem_share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newUuid(), share.id, userId ? "claim_success" : "pin_unlock", toJson({ user_id: userId }), nowIso());

    const { poem, verses } = await resolveGiftPoemContent(share);

    // Response shape matches iOS PoemShareClaimResponse model
    // "unlocked" = anonymous web access via PIN; "claimed" = bound to authenticated user
    reply.send({
      status: userId ? "claimed" : "unlocked",
      poem: poem ? {
        id: poem.id, user_id: poem.user_id, title: poem.title,
        recipient_name: poem.recipient_name, occasion: poem.occasion,
        tone: poem.tone, status: poem.status,
        verses,
        created_at: poem.created_at, updated_at: poem.updated_at,
        library_origin: userId ? "received" : null,
        can_edit: false,
        can_share: false,
        can_delete: true,
      } : null,
      allow_save: !!share.allow_save,
      expires_at: share.expires_at,
    });
  });

  // ============ Poem Audio (TTS) ============

  /**
   * POST /poems/:id/audio - Generate TTS audio for a poem
   */
  app.post("/poems/:id/audio", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const verses = parseJson(poem.verses, [], `poem ${poem.id} verses`);
    if (!verses || verses.length === 0) {
      sendError(reply, 409, "POEM_NOT_READY", "Poem has no verses.");
      return;
    }

    // Idempotent: check if audio already exists
    const audioDir = path.join(appConfig.STORAGE_DIR, "poems", poem.user_id, poem.id);
    const audioPath = path.join(audioDir, "audio.mp3");
    const audioUrl = `/poems/${poem.id}/audio`;
    const sendReadyResponse = (generatedAt) => {
      reply.send({
        audio_url: audioUrl,
        generated_at: generatedAt || nowIso(),
      });
    };

    if (fs.existsSync(audioPath)) {
      sendReadyResponse(poem.audio_generated_at);
      return;
    }

    // If generation is already in progress for this poem, wait for it and reuse result.
    const lockKey = `${poem.user_id}:${poem.id}`;
    const inFlightGeneration = poemAudioGenerationLocks.get(lockKey);
    if (inFlightGeneration) {
      request.log.info({ poem_id: poem.id, user_id: userId }, "[PoemAudio] Waiting for in-flight generation");
      try {
        await inFlightGeneration;
      } catch (_err) {
        // If the in-flight generation failed, fall through and allow one fresh attempt.
      }
      if (fs.existsSync(audioPath)) {
        sendReadyResponse(poem.audio_generated_at);
        return;
      }
    }

    // Rate-limit only when a fresh provider generation is needed.
    const limit = await consumeRateLimit(userId, "poem_audio", 10, 60 * 60);
    if (!limit.allowed) {
      sendError(reply, 429, "RATE_LIMITED", "Poem audio generation rate limit reached.", { retry_at: limit.reset_at });
      return;
    }

    // Re-check to avoid races between limit check and generation start.
    if (fs.existsSync(audioPath)) {
      sendReadyResponse(poem.audio_generated_at);
      return;
    }

    // Compose text for TTS
    const textParts = [];
    if (poem.recipient_name) textParts.push(`For ${poem.recipient_name}.`);
    textParts.push(""); // pause
    for (const verse of verses) {
      textParts.push(verse);
    }
    const ttsText = textParts.join("\n");

    // Generate TTS via ElevenLabs
    const { generateSpeech } = require("../providers/elevenlabs");
    const generationPromise = (async () => {
      ensureDir(audioDir);
      await generateSpeech({
        baseUrl: config.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io",
        apiKey: config.ELEVENLABS_API_KEY,
        voiceId: config.ELEVENLABS_TTS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
        text: ttsText,
        outputPath: audioPath,
        timeoutMs: 30000,
      });

      const generatedAt = nowIso();
      try {
        await db.prepare("UPDATE poems SET audio_generated_at = ?, updated_at = ? WHERE id = ?").run(
          generatedAt,
          generatedAt,
          poem.id
        );
      } catch (err) {
        if (String(err?.message || "").includes("no such column: audio_generated_at")) {
          // SQLite migrations in some environments do not yet include this optional column.
          await db.prepare("UPDATE poems SET updated_at = ? WHERE id = ?").run(generatedAt, poem.id);
        } else {
          throw err;
        }
      }

      await addAuditEntry({
        userId,
        action: "poem_audio_generated",
        resourceType: "poem",
        resourceId: poem.id,
      });

      return generatedAt;
    })();

    poemAudioGenerationLocks.set(lockKey, generationPromise);
    try {
      const generatedAt = await generationPromise;
      sendReadyResponse(generatedAt);
    } catch (err) {
      console.error(`[PoemAudio] TTS generation failed for poem ${poem.id}:`, err.message);
      sendError(reply, 502, "TTS_FAILED", "Failed to generate poem audio.");
      return;
    } finally {
      if (poemAudioGenerationLocks.get(lockKey) === generationPromise) {
        poemAudioGenerationLocks.delete(lockKey);
      }
    }
  });

  /**
   * GET /poems/:id/audio - Stream poem TTS audio
   */
  app.get("/poems/:id/audio", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    const poem = await getPoemForLibrary(userId, request.params.id);
    if (!poem) {
      sendError(reply, 404, "POEM_NOT_FOUND", "Poem not found.");
      return;
    }

    const audioPath = path.join(appConfig.STORAGE_DIR, "poems", poem.user_id, poem.id, "audio.mp3");
    if (!fs.existsSync(audioPath)) {
      sendError(reply, 404, "AUDIO_NOT_FOUND", "Poem audio not yet generated.");
      return;
    }

    // Use the same byte-range responder as tracks to keep AVPlayer behavior consistent.
    sendMediaFile(request, reply, audioPath, "audio/mpeg", {
      cacheControl: "private, max-age=3600",
    });
  });
}

module.exports = { registerPoemRoutes };
