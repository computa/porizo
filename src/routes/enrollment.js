/**
 * Enrollment + Device Routes
 *
 * Voice enrollment, device registration, storage upload,
 * voice profile management, and memory questions.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { concatWavFiles, parseWavHeaderFromFile } = require("../utils/audio");
const { validateEnrollmentWithGrading } = require("../services/enrollment");
const { getTierMetadata } = require("../services/audio-quality");
const { generateMemoryQuestions } = require("../services/memory-questions");
const { extractEmbedding } = require("../providers/replicate");
const { downloadToFile } = require("../providers/http");
const { moderationCheck } = require("../providers/moderation");
const {
  enrollmentChunkKey,
  enrollmentCleanKey,
  enrollmentSunoPersonaKey,
} = require("../storage");
const { newUuid } = require("../utils/ids");
const { ensureDir, parseJson, toJson, nowIso } = require("../utils/common");
const {
  cancelVoiceProviderJobsForVoiceProfile,
  createPendingProviderProfile,
  createVoiceProviderJob,
  findLatestProviderProfileForVoiceProfile,
  softDeleteProviderProfilesForVoiceProfile,
} = require("../services/voice-provider-profile-service");
const { getFeatureFlags } = require("../services/feature-flags");
const {
  REQUIRED_CONSENT_SCOPE,
  enrollmentSessionHasPersonaConsent,
  hasPersonaConsentScope,
} = require("../services/suno-voice-persona-service");
const {
  revokeAllEnrollmentSessionTokensForUser,
} = require("../services/enrollment-session-service");

/**
 * SVC-10: Validate audio file magic bytes to reject non-audio uploads.
 * Supports WAV, MP3 (ID3 tag + sync word), and M4A/MP4 (ftyp box).
 * @param {Buffer} buffer - Raw upload buffer
 * @returns {boolean}
 */
function isValidAudioFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // WAV: RIFF header + WAVE format
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  )
    return true;
  // MP3: ID3 tag
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)
    return true;
  // MP3: sync word (0xFF followed by 0xE0+ in high bits)
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true;
  // M4A/MP4: ftyp box at bytes 4-7
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  )
    return true;
  return false;
}

/**
 * Register enrollment, device, and voice profile routes.
 *
 * @param {Object} app - Fastify instance
 * @param {Object} deps - Dependencies from server.js closure
 */
async function buildSunoPersonaCalibration({
  chunkEntries,
  outputPath,
  minDurationSec = 10,
  maxDurationSec = 30,
} = {}) {
  const sungEntries = Array.isArray(chunkEntries)
    ? chunkEntries.filter(
        (entry) =>
          entry?.prompt?.type === "sung" &&
          entry?.quality?.metrics?.is_singing === true,
      )
    : [];
  const selected = [];
  let totalDurationSec = 0;

  for (const entry of sungEntries) {
    if (!entry?.filePath || !fs.existsSync(entry.filePath)) {
      continue;
    }
    let durationSec = 0;
    try {
      // M23: read only the WAV header (~64 KiB) instead of the full file
      // (typically 1–5 MB per chunk). For duration probing the audio body
      // is irrelevant; this keeps the request hot path off the event loop.
      const info = await parseWavHeaderFromFile(entry.filePath);
      durationSec = Number(info?.durationSec || 0);
    } catch (_err) {
      continue;
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      continue;
    }
    if (
      selected.length > 0 &&
      totalDurationSec + durationSec > maxDurationSec
    ) {
      continue;
    }
    selected.push(entry.filePath);
    totalDurationSec += durationSec;
    if (totalDurationSec >= minDurationSec) {
      break;
    }
  }

  if (
    selected.length === 0 ||
    totalDurationSec < minDurationSec ||
    totalDurationSec > maxDurationSec
  ) {
    return null;
  }

  concatWavFiles(selected, outputPath);
  return {
    filePath: outputPath,
    durationSec: Number(totalDurationSec.toFixed(2)),
    vocalWindow: {
      vocal_start: 0,
      vocal_end: Number(Math.min(totalDurationSec, maxDurationSec).toFixed(2)),
    },
    chunkCount: selected.length,
  };
}

function chunkFileStem(filePath) {
  if (!filePath) {
    return "";
  }
  return path.basename(String(filePath), ".wav");
}

function attachChunkQualityResults(chunkEntries, qcResult) {
  if (
    !Array.isArray(chunkEntries) ||
    !Array.isArray(qcResult?.metrics?.chunk_results)
  ) {
    return;
  }

  const chunkIdByFileStem = new Map();
  for (const entry of chunkEntries) {
    if (!entry?.chunkId) {
      continue;
    }
    chunkIdByFileStem.set(String(entry.chunkId), entry.chunkId);
    const originalStem = chunkFileStem(entry.filePath);
    if (originalStem) {
      chunkIdByFileStem.set(originalStem, entry.chunkId);
    }
  }

  for (const result of qcResult.preprocessingResults?.results || []) {
    const originalChunkId = chunkIdByFileStem.get(chunkFileStem(result.path));
    const processedStem = chunkFileStem(result.outputPath);
    if (originalChunkId && processedStem) {
      chunkIdByFileStem.set(processedStem, originalChunkId);
    }
  }

  const qualityByChunkId = new Map();
  for (const result of qcResult.metrics.chunk_results) {
    const chunkId = chunkIdByFileStem.get(chunkFileStem(result.file));
    if (chunkId) {
      qualityByChunkId.set(chunkId, result);
    }
  }

  for (const entry of chunkEntries) {
    entry.quality = qualityByChunkId.get(entry.chunkId) || null;
  }
}

function buildPersonaJobStepData({
  providerProfileId,
  sessionId,
  userId,
  model,
  audioWeight,
  vocalWindow = null,
  sourceAudioKey = null,
  sourceAudioName = "clean.wav",
}) {
  const base = {
    voice_provider_profile_id: providerProfileId,
    enrollment_session_id: sessionId,
    source_audio_key:
      sourceAudioKey || enrollmentCleanKey({ userId, sessionId }),
    source_audio_name: sourceAudioName,
    model,
    audio_weight: audioWeight,
  };
  if (vocalWindow) {
    base.vocal_start = vocalWindow.vocal_start;
    base.vocal_end = vocalWindow.vocal_end;
  }
  return base;
}

function resolvePersonaConsentScopes(body = {}, consentAccepted = false) {
  const knownScopes = new Set([REQUIRED_CONSENT_SCOPE]);
  const requestedScopes = Array.isArray(body?.consent_scopes)
    ? body.consent_scopes
        .filter((scope) => typeof scope === "string")
        .filter((scope) => knownScopes.has(scope))
    : null;
  const explicitPersonaConsent = body?.voice_suno_persona_consent === true;
  const legacyPersonaConsent =
    consentAccepted === true && body?.consent_version === "1.0";

  if (
    consentAccepted !== true ||
    (!explicitPersonaConsent &&
      !legacyPersonaConsent &&
      !(requestedScopes && requestedScopes.includes(REQUIRED_CONSENT_SCOPE)))
  ) {
    return null;
  }

  return requestedScopes && requestedScopes.length
    ? requestedScopes.join(" ")
    : REQUIRED_CONSENT_SCOPE;
}

function dbFromQuery(query) {
  return {
    prepare(sql) {
      return {
        get: async (...params) => {
          const result = await query(sql, params);
          return result?.rows?.[0] || null;
        },
        all: async (...params) => {
          const result = await query(sql, params);
          return result?.rows || [];
        },
        run: async (...params) => {
          const result = await query(sql, params);
          return {
            changes: Number(result?.rowCount || result?.changes || 0),
          };
        },
      };
    },
  };
}

function parsePorizoBuild(userAgent) {
  const match = String(userAgent || "").match(/PorizoApp\/[^(]+\((\d+)/i);
  return match ? Number(match[1]) : null;
}

function registerEnrollmentRoutes(app, deps) {
  const {
    db,
    appConfig,
    storageProvider,
    requireUserId,
    sendError,
    consumeRateLimit,
    addAuditEntry,
    getBaseUrl,
    getUserRiskLevel,
    computeFileSha256,
    resolveEnrollmentChunkFiles,
    resolveStoragePath,
    sendMediaFile,
    schemas,
    issueDeviceToken,
    deviceTokenTtlDays,
    enableDebugRoutes,
  } = deps;

  // ---- Enrollment clean.wav endpoint ----

  async function sendEnrollmentAudio(request, reply, audioName) {
    const token = request.query.token;
    if (!token) {
      sendError(reply, 403, "FORBIDDEN", "Missing enrollment token.");
      return;
    }
    const session = await db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(request.params.sessionId);
    const expected = Buffer.from(String(session?.access_token || ""), "utf8");
    const actual = Buffer.from(String(token || ""), "utf8");
    const tokenMatches =
      expected.length > 0 &&
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);
    if (!session || !tokenMatches) {
      sendError(reply, 403, "FORBIDDEN", "Invalid enrollment token.");
      return;
    }
    if (
      session.status === "expired" ||
      (session.expires_at && new Date(session.expires_at) < new Date())
    ) {
      sendError(reply, 403, "SESSION_EXPIRED", "Enrollment session expired.");
      return;
    }
    const tokenIssuedAt = session.completed_at || session.started_at;
    if (
      tokenIssuedAt &&
      Date.now() - new Date(tokenIssuedAt).getTime() > 60 * 60 * 1000
    ) {
      sendError(reply, 403, "SESSION_EXPIRED", "Enrollment token expired.");
      return;
    }
    const key =
      audioName === "suno-persona.wav"
        ? enrollmentSunoPersonaKey({
            userId: session.user_id,
            sessionId: session.id,
          })
        : enrollmentCleanKey({
            userId: session.user_id,
            sessionId: session.id,
          });
    const filePath = path.join(
      appConfig.STORAGE_DIR,
      "enrollment",
      "clean",
      session.user_id,
      session.id,
      audioName,
    );
    if (storageProvider.type !== "local") {
      const download = storageProvider.createPresignedDownload({
        key,
        expiresInSec: 300,
      });
      reply.redirect(download.url);
      return;
    }
    sendMediaFile(request, reply, filePath, "audio/wav");
  }

  app.get("/enrollment/:sessionId/clean.wav", async (request, reply) => {
    await sendEnrollmentAudio(request, reply, "clean.wav");
  });

  app.get("/enrollment/:sessionId/suno-persona.wav", async (request, reply) => {
    await sendEnrollmentAudio(request, reply, "suno-persona.wav");
  });

  // ---- Device registration ----

  app.post(
    "/device/register",
    { schema: schemas.deviceRegister },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      const hasBearerAuth = typeof authHeader === "string" && authHeader.startsWith("Bearer ");
      const hasDevAnonUser = process.env.NODE_ENV !== "production" && typeof request.headers["x-user-id"] === "string";
      const userId = hasBearerAuth || hasDevAnonUser
        ? await requireUserId(request, reply)
        : null;
      if ((hasBearerAuth || hasDevAnonUser) && !userId) return;

      const { device_id, platform, app_version, push_token } =
        request.body || {};
      const now = nowIso();

      if (userId) {
        const existing = await db
          .prepare("SELECT id FROM devices WHERE user_id = ? AND device_id = ?")
          .get(userId, device_id);

        if (existing) {
          if (push_token) {
            await db
              .prepare(
                "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, push_token = ?, push_token_updated_at = ?, updated_at = ? WHERE id = ?",
              )
              .run(
                platform,
                app_version || null,
                now,
                push_token,
                now,
                now,
                existing.id,
              );
          } else {
            await db
              .prepare(
                "UPDATE devices SET platform = ?, app_version = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
              )
              .run(platform, app_version || null, now, now, existing.id);
          }
        } else {
          const deviceRecordId = newUuid();
          await db
            .prepare(
              "INSERT INTO devices (id, user_id, device_id, platform, app_version, last_seen_at, push_token, push_token_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              deviceRecordId,
              userId,
              device_id,
              platform,
              app_version || null,
              now,
              push_token || null,
              push_token ? now : null,
              now,
              now,
            );
        }
      }

      const deviceToken = issueDeviceToken({
        userId,
        deviceId: device_id,
        platform,
        appVersion: app_version,
      });

      reply.send({
        device_token: deviceToken,
        expires_at: new Date(
          Date.now() + deviceTokenTtlDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
    },
  );

  // ---- Storage upload (local dev only) ----

  app.put(
    "/storage/upload",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      if (storageProvider.type !== "local") {
        sendError(reply, 404, "NOT_FOUND", "Upload endpoint unavailable.");
        return;
      }
      const { key, expires, sig, content_type } = request.query || {};
      if (!key || !expires || !sig) {
        sendError(
          reply,
          400,
          "MISSING_SIGNATURE",
          "Upload signature is required.",
        );
        return;
      }
      const expiresAt = Number(expires);
      if (!Number.isFinite(expiresAt)) {
        sendError(reply, 400, "INVALID_SIGNATURE", "Invalid expiration.");
        return;
      }
      if (Date.now() > expiresAt) {
        sendError(reply, 410, "UPLOAD_EXPIRED", "Upload URL expired.");
        return;
      }
      if (!key.startsWith("enrollment/raw/")) {
        sendError(reply, 403, "FORBIDDEN", "Upload key not allowed.");
        return;
      }
      const contentType = content_type || "";
      const verified = storageProvider.verifyPresignedRequest({
        key,
        expiresAt,
        signature: sig,
        contentType,
        purpose: "upload",
      });
      if (!verified) {
        sendError(reply, 403, "INVALID_SIGNATURE", "Upload signature invalid.");
        return;
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        sendError(reply, 400, "EMPTY_BODY", "Upload body is required.");
        return;
      }
      // SVC-10: Validate audio magic bytes before writing to disk
      if (!isValidAudioFormat(request.body)) {
        sendError(
          reply,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Upload must be a valid audio file (WAV, MP3, or M4A).",
        );
        return;
      }
      if (
        contentType &&
        request.headers["content-type"] &&
        request.headers["content-type"] !== contentType
      ) {
        sendError(
          reply,
          400,
          "CONTENT_TYPE_MISMATCH",
          "Content-Type mismatch.",
        );
        return;
      }
      const filePath = resolveStoragePath(key);
      if (!filePath) {
        sendError(reply, 400, "INVALID_PATH", "Invalid storage path.");
        return;
      }
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, request.body);
      reply.send({ ok: true, key });
    },
  );

  // ---- Voice enrollment start ----

  app.post(
    "/voice/enrollment/start",
    { schema: schemas.enrollmentStart },
    async (request, reply) => {
      const userId = await requireUserId(request, reply);
      if (!userId) {
        return;
      }
      const riskLevel = await getUserRiskLevel(userId);
      if (riskLevel === "blocked" || riskLevel === "high") {
        sendError(
          reply,
          403,
          "ACCOUNT_BLOCKED",
          "Voice features are not available for this account",
        );
        return;
      }
      // Consent gate runs BEFORE the rate-limit consumes (gap 2 fix). Hostile
      // clients sending no-consent payloads previously burned the user's
      // 10/24h + 1/min budgets without producing a session — a low-cost DoS
      // on a victim's enrollment quota. Validating the cheap, request-scoped
      // input first means only well-formed attempts count against the limit.
      const { consent_accepted, consent_version } = request.body || {};
      if (!consent_accepted) {
        sendError(reply, 400, "CONSENT_REQUIRED", "Consent must be accepted.");
        return;
      }
      const limit = await consumeRateLimit(
        userId,
        "enrollment_start",
        10,
        24 * 60 * 60,
      );
      if (!limit.allowed) {
        sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Enrollment rate limit reached.",
          {
            retry_at: limit.reset_at,
          },
        );
        return;
      }
      const burstLimit = await consumeRateLimit(
        userId,
        "voice_enrollment_start_burst",
        1,
        60,
      );
      if (!burstLimit.allowed) {
        sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Please wait before starting another voice enrollment.",
          {
            retry_at: burstLimit.reset_at,
          },
        );
        return;
      }
      const sessionId = newUuid();
      const promptSetId = `ps_${newUuid()}`;
      const prompts = [
        {
          id: "p1",
          type: "spoken",
          text: "The quick brown fox jumps over the lazy dog.",
          duration_hint_sec: 5,
        },
        {
          id: "p2",
          type: "spoken",
          text: "Pack my box with five dozen liquor jugs.",
          duration_hint_sec: 5,
        },
        {
          id: "p3",
          type: "spoken",
          text: "How vexingly quick daft zebras jump!",
          duration_hint_sec: 5,
        },
        {
          id: "p4",
          type: "spoken",
          text: "The five boxing wizards jump quickly.",
          duration_hint_sec: 5,
        },
        {
          id: "p5",
          type: "sung",
          text: "La la la, la la la la la, la la la la la la la",
          pitch_hint: "Start comfortable, go up",
          duration_hint_sec: 8,
        },
        {
          id: "p6",
          type: "sung",
          text: "Ooh ooh ooh, ah ah ah, ooh ooh ooh ah",
          pitch_hint: "Smooth and flowing",
          duration_hint_sec: 8,
        },
      ];
      const baseUrl = getBaseUrl(request);
      const uploadUrls = prompts.map((prompt) => {
        const chunkId = prompt.id;
        const key = enrollmentChunkKey({ userId, sessionId, chunkId });
        const presigned = storageProvider.createPresignedUpload({
          key,
          contentType: "audio/wav",
          expiresInSec: appConfig.UPLOAD_URL_TTL_SEC,
          baseUrl,
        });
        return {
          chunk_id: chunkId,
          url: presigned.url,
          method: presigned.method,
          headers: presigned.headers,
          expires_at: presigned.expiresAt,
        };
      });
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const consentScopes = resolvePersonaConsentScopes(
        { ...request.body, consent_version: consent_version || "1.0" },
        consent_accepted === true,
      );
      await db
        .prepare(
          "INSERT INTO enrollment_sessions (id, user_id, status, prompt_set_id, prompts_json, chunk_count, quality_metrics, failure_reason, started_at, completed_at, expires_at, consent_version, consent_scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          sessionId,
          userId,
          "recording",
          promptSetId,
          toJson(prompts),
          0,
          toJson({}),
          null,
          nowIso(),
          null,
          expiresAt,
          consent_version || "1.0",
          consentScopes,
        );

      await addAuditEntry({
        userId,
        action: "enrollment_started",
        resourceType: "enrollment_session",
        resourceId: sessionId,
        metadata: { consent_version },
      });

      reply.send({
        session_id: sessionId,
        prompt_set_id: promptSetId,
        prompts,
        upload_urls: uploadUrls,
        recording_settings: {
          sample_rate: 44100,
          channels: 1,
          format: "wav",
          max_chunk_duration_sec: 20,
        },
        session_expires_at: expiresAt,
      });
    },
  );

  // ---- Chunk upload notification ----

  app.post("/voice/enrollment/chunk_uploaded", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const { session_id, chunk_id, duration_sec, client_checksum } =
      request.body || {};

    if (!chunk_id) {
      sendError(reply, 400, "MISSING_CHUNK_ID", "chunk_id is required.");
      return;
    }
    const session = await db
      .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
      .get(session_id);
    if (!session || session.user_id !== userId) {
      sendError(
        reply,
        404,
        "SESSION_NOT_FOUND",
        "Enrollment session not found.",
      );
      return;
    }
    if (new Date(session.expires_at) < new Date()) {
      await db
        .prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?")
        .run("expired", session_id);
      sendError(reply, 410, "SESSION_EXPIRED", "Enrollment session expired.");
      return;
    }
    if (session.status !== "recording" && session.status !== "processing") {
      sendError(
        reply,
        409,
        "SESSION_ALREADY_FINALIZED",
        "Enrollment session has already been finalized.",
      );
      return;
    }

    const storageKey = enrollmentChunkKey({
      userId,
      sessionId: session_id,
      chunkId: chunk_id,
    });
    const exists = await storageProvider.objectExists({ key: storageKey });
    if (!exists) {
      sendError(
        reply,
        404,
        "CHUNK_NOT_FOUND",
        "Uploaded chunk not found. Please retry.",
      );
      return;
    }

    let resolvedDuration = duration_sec;
    let checksumMatches = true;
    const localPath = storageProvider.resolveLocalPath
      ? storageProvider.resolveLocalPath(storageKey)
      : null;

    if (localPath && fs.existsSync(localPath)) {
      if (!resolvedDuration) {
        try {
          // M23: header-only read (see parseWavHeaderFromFile docstring).
          const wavInfo = await parseWavHeaderFromFile(localPath);
          resolvedDuration = wavInfo.durationSec;
        } catch (err) {
          resolvedDuration = null;
        }
      }
      if (client_checksum) {
        const serverHash = await computeFileSha256(localPath);
        checksumMatches = serverHash === client_checksum;
      }
    }
    const metrics = parseJson(session.quality_metrics, {});
    const durationOk =
      typeof resolvedDuration === "number" &&
      resolvedDuration >= 2 &&
      resolvedDuration <= 25;
    if (!durationOk) {
      metrics[chunk_id] = {
        accepted: false,
        reason: "DURATION_OUT_OF_RANGE",
        duration_sec: resolvedDuration,
      };
      await db
        .prepare(
          "UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?",
        )
        .run(toJson(metrics), session_id);
      sendError(reply, 400, "QC_FAILED", "Audio chunk failed QC.", {
        reason: "DURATION_OUT_OF_RANGE",
        re_record: true,
      });
      return;
    }
    if (!checksumMatches) {
      metrics[chunk_id] = {
        accepted: false,
        reason: "CHECKSUM_MISMATCH",
        duration_sec: resolvedDuration,
      };
      await db
        .prepare(
          "UPDATE enrollment_sessions SET quality_metrics = ? WHERE id = ?",
        )
        .run(toJson(metrics), session_id);
      sendError(reply, 400, "QC_FAILED", "Audio chunk checksum mismatch.", {
        reason: "CHECKSUM_MISMATCH",
        re_record: true,
      });
      return;
    }
    metrics[chunk_id] = {
      accepted: true,
      duration_sec: resolvedDuration,
      client_checksum,
      storage_key: storageKey,
    };
    await db
      .prepare(
        "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, status = ?, quality_metrics = ? WHERE id = ?",
      )
      .run("processing", toJson(metrics), session_id);

    reply.send({
      status: "accepted",
      qc_job_id: newUuid(),
      next_upload_url: null,
      chunk_id,
      duration_sec: resolvedDuration,
    });
  });

  // ---- Debug OG image preview (dev-only) ----

  if (enableDebugRoutes) {
    const songVariants = require("../services/song-og-variants");
    const poemVariants = require("../services/poem-og-variants");

    const songGenerators = {
      a: songVariants.generateSongOgSpotlight,
      b: songVariants.generateSongOgEnvelope,
      c: songVariants.generateSongOgGreetingCard,
    };
    const poemGenerators = {
      a: poemVariants.generatePoemOgOpenBook,
      b: poemVariants.generatePoemOgVerseWindow,
      c: poemVariants.generatePoemOgWhisper,
    };

    app.get("/debug/og-preview", async (_request, reply) => {
      return reply.sendFile("debug-og.html");
    });

    app.get("/debug/og-preview/song/:variant", async (request, reply) => {
      const gen = songGenerators[request.params.variant];
      if (!gen) return reply.code(404).send("Unknown variant");
      const { title, name, occasion } = request.query;
      const buf = await gen({
        title: title || "A Song For You",
        recipientName: name || "You",
        occasion: occasion || "birthday",
        coverPath: null,
        brandName: "Porizo",
      });
      if (!buf) return reply.code(500).send("sharp not available");
      return reply.type("image/jpeg").send(buf);
    });

    app.get("/debug/og-preview/poem/:variant", async (request, reply) => {
      const gen = poemGenerators[request.params.variant];
      if (!gen) return reply.code(404).send("Unknown variant");
      const { title, name, occasion, verses: versesParam } = request.query;
      const verses = versesParam
        ? String(versesParam).split("|")
        : ["A poem written just for you."];
      const buf = await gen({
        title: title || "A Poem For You",
        recipientName: name || "You",
        occasion: occasion || "birthday",
        verses,
      });
      if (!buf) return reply.code(500).send("sharp not available");
      return reply.type("image/png").send(buf);
    });
  }

  // ---- Debug chunk upload (dev only) ----

  if (enableDebugRoutes) {
    app.post("/debug/upload-chunk", async (request, reply) => {
      const userId = await requireUserId(request, reply);
      if (!userId) {
        return;
      }

      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(userId)) {
        sendError(reply, 400, "INVALID_USER_ID", "Invalid user ID format");
        return;
      }

      let data;
      try {
        data = await request.file();
      } catch (err) {
        sendError(
          reply,
          400,
          "NO_FILE",
          "No file uploaded or invalid multipart request.",
        );
        return;
      }

      if (!data) {
        sendError(reply, 400, "NO_FILE", "No file uploaded.");
        return;
      }

      const sessionIdField = data.fields.session_id;
      const chunkIdField = data.fields.chunk_id;

      const sessionId = Array.isArray(sessionIdField)
        ? sessionIdField[0]?.value
        : sessionIdField?.value;
      const chunkId = Array.isArray(chunkIdField)
        ? chunkIdField[0]?.value
        : chunkIdField?.value;

      if (!sessionId || !chunkId) {
        sendError(
          reply,
          400,
          "MISSING_FIELDS",
          "session_id and chunk_id are required.",
        );
        return;
      }

      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(chunkId)) {
        sendError(
          reply,
          400,
          "INVALID_CHUNK_ID",
          "chunk_id contains invalid characters.",
        );
        return;
      }

      const session = await db
        .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
        .get(sessionId);

      if (!session || session.user_id !== userId) {
        sendError(
          reply,
          404,
          "SESSION_NOT_FOUND",
          "Enrollment session not found.",
        );
        return;
      }

      if (session.status !== "recording" && session.status !== "processing") {
        sendError(
          reply,
          409,
          "SESSION_ALREADY_FINALIZED",
          "Enrollment session has already been finalized.",
        );
        return;
      }

      const chunkDir = path.join(
        appConfig.STORAGE_DIR,
        "enrollment",
        "raw",
        userId,
        sessionId,
      );
      ensureDir(chunkDir);
      const chunkPath = path.join(chunkDir, `${chunkId}.wav`);

      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(chunkPath, buffer);

      let durationSec = 0;
      if (buffer.length > 44 && buffer.toString("ascii", 0, 4) === "RIFF") {
        let sampleRate = 0;
        let bitsPerSample = 16;
        let numChannels = 1;
        let dataSize = 0;

        let offset = 12;
        while (offset < buffer.length - 8) {
          const chunkId = buffer.toString("ascii", offset, offset + 4);
          const chunkSize = buffer.readUInt32LE(offset + 4);

          if (chunkId === "fmt ") {
            numChannels = buffer.readUInt16LE(offset + 10);
            sampleRate = buffer.readUInt32LE(offset + 12);
            bitsPerSample = buffer.readUInt16LE(offset + 22);
          } else if (chunkId === "data") {
            dataSize = chunkSize;
            break;
          }

          offset += 8 + chunkSize;
          if (chunkSize % 2 === 1) offset++;
        }

        if (sampleRate > 0 && dataSize > 0) {
          const bytesPerSample = (bitsPerSample / 8) * numChannels;
          durationSec = dataSize / bytesPerSample / sampleRate;
        }
      }

      const metrics = parseJson(session.quality_metrics, {});
      metrics[chunkId] = { accepted: true, duration_sec: durationSec };
      await db
        .prepare(
          "UPDATE enrollment_sessions SET chunk_count = chunk_count + 1, quality_metrics = ? WHERE id = ?",
        )
        .run(toJson(metrics), sessionId);

      reply.send({
        status: "accepted",
        chunk_id: chunkId,
        duration_sec: durationSec,
      });
    });
  } // end enableDebugRoutes (chunk upload)

  // ---- Enrollment complete ----

  app.post(
    "/voice/enrollment/complete",
    { schema: schemas.enrollmentComplete },
    async (request, reply) => {
      const userId = await requireUserId(request, reply);
      if (!userId) {
        return;
      }
      const { session_id } = request.body || {};

      let session = await db
        .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
        .get(session_id);
      if (!session || session.user_id !== userId) {
        sendError(
          reply,
          404,
          "SESSION_NOT_FOUND",
          "Enrollment session not found.",
        );
        return;
      }

      console.log("[Enrollment:complete] START", {
        sessionId: session_id,
        status: session.status,
        chunks: session.chunk_count,
      });

      if (new Date(session.expires_at) < new Date()) {
        await db
          .prepare("UPDATE enrollment_sessions SET status = ? WHERE id = ?")
          .run("expired", session_id);
        sendError(reply, 410, "SESSION_EXPIRED", "Enrollment session expired.");
        return;
      }
      if (session.status !== "recording" && session.status !== "processing") {
        sendError(
          reply,
          409,
          "SESSION_ALREADY_FINALIZED",
          "Enrollment session has already been finalized.",
        );
        return;
      }

      // Late-grant: a client that didn't include the persona scope at /start
      // can grant it here, but only after the session is known valid.
      if (!session.consent_scopes) {
        const lateScope = resolvePersonaConsentScopes(
          {
            ...request.body,
            consent_version:
              request.body?.consent_version || session.consent_version,
          },
          true,
        );
        if (lateScope) {
          await db
            .prepare(
              "UPDATE enrollment_sessions SET consent_scopes = ? WHERE id = ? AND consent_scopes IS NULL",
            )
            .run(lateScope, session_id);
          session = await db
            .prepare("SELECT * FROM enrollment_sessions WHERE id = ?")
            .get(session_id);
        }
      }

      const metrics = parseJson(session.quality_metrics, {});
      const {
        files: chunkFiles,
        chunkEntries,
        tempDir,
        missingChunks,
      } = await resolveEnrollmentChunkFiles({
        session,
        metrics,
        userId,
      });

      if (chunkFiles.length === 0) {
        request.log.error(
          { sessionId: session_id, missingChunks },
          "[Enrollment:complete] No files found",
        );
        sendError(
          reply,
          500,
          "STORAGE_ERROR",
          "Failed to retrieve uploaded audio files. Please try again.",
        );
        return;
      }
      let qcResult;
      try {
        qcResult = await validateEnrollmentWithGrading({
          userId,
          sessionId: session_id,
          storageDir: appConfig.STORAGE_DIR,
          chunkFiles,
          applyPreprocessing: true,
        });

        const criticalErrors = qcResult.errors.filter(
          (e) => e.includes("E103_NO_AUDIO_DETECTED") || e.includes("E104"),
        );

        if (criticalErrors.length > 0) {
          request.log.error(
            { errors: criticalErrors, grade: qcResult.grade },
            "[Enrollment:complete] QC failed",
          );
          await db
            .prepare(
              "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
            )
            .run("failed_quality", nowIso(), session_id);

          const errorCode = criticalErrors[0].split(":")[0];
          sendError(reply, 422, errorCode, "Audio quality check failed.", {
            errors: criticalErrors,
            metrics: qcResult.metrics,
          });
          return;
        }

        if (qcResult.metrics.chunk_results) {
          await db
            .prepare(
              "UPDATE enrollment_sessions SET chunk_quality_json = ? WHERE id = ?",
            )
            .run(JSON.stringify(qcResult.metrics.chunk_results), session_id);
          attachChunkQualityResults(chunkEntries, qcResult);
        }

        const profileId = newUuid();
        const qualityScore = Math.round(qcResult.metrics.average_score || 50);

        // Spec: voice profile only goes active when quality score >= 70.
        // Without this gate, silent/noisy recordings that miss the E103/E104
        // critical-error filter still create active profiles with garbage
        // embeddings — leading to bad voice conversion downstream.
        if (
          qcResult.passed === false ||
          qualityScore < 70 ||
          qcResult.grade === "F"
        ) {
          request.log.warn(
            {
              score: qualityScore,
              grade: qcResult.grade,
              errors: qcResult.errors,
            },
            "[Enrollment:complete] QC below threshold — rejecting",
          );
          await db
            .prepare(
              "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
            )
            .run("failed_quality", nowIso(), session_id);
          sendError(
            reply,
            422,
            "E101_AUDIO_TOO_NOISY",
            "Audio quality below the minimum threshold. Please record again in a quieter environment.",
            {
              score: qualityScore,
              grade: qcResult.grade,
              errors: qcResult.errors,
              metrics: qcResult.metrics,
            },
          );
          return;
        }

        const qualityTier =
          qcResult.grade === "F"
            ? "minimal"
            : qcResult.grade === "C"
              ? "fair"
              : qcResult.grade === "B"
                ? "good"
                : "excellent";
        const embeddingRef = `voice_profiles/${userId}/${profileId}/embedding.bin`;
        const shouldEmbed =
          appConfig.LIVE_PROVIDERS &&
          Boolean(appConfig.REPLICATE_API_TOKEN) &&
          Boolean(appConfig.REPLICATE_EMBEDDING_MODEL_VERSION);
        const sunoPersonaFlags = await getFeatureFlags(db, [
          "suno_voice_persona_enabled",
          "suno_voice_persona_model",
          "suno_voice_persona_audio_weight",
        ]);
        const shouldQueueSunoPersona =
          sunoPersonaFlags.suno_voice_persona_enabled !== false;
        // U2: Read consent_scopes (added by migration 098), NOT consent_version
        // (semver). The previous fallback to consent_version was the silent-deny bug.
        const hasProviderConsent = enrollmentSessionHasPersonaConsent(session);
        let providerProfileResult =
          shouldQueueSunoPersona && !hasProviderConsent
            ? { provider: "suno", status: "consent_required", job_id: null }
            : null;

        const cleanDir = path.join(
          appConfig.STORAGE_DIR,
          "enrollment",
          "clean",
          userId,
          session_id,
        );
        const cleanPath = path.join(cleanDir, "clean.wav");
        const sunoPersonaPath = path.join(cleanDir, "suno-persona.wav");
        let cleanAudioReady = false;
        let sunoPersonaAudio = null;
        try {
          concatWavFiles(chunkFiles, cleanPath);
          await storageProvider.putFile({
            key: enrollmentCleanKey({ userId, sessionId: session_id }),
            filePath: cleanPath,
            contentType: "audio/wav",
          });
          cleanAudioReady = true;
          sunoPersonaAudio = await buildSunoPersonaCalibration({
            chunkEntries,
            outputPath: sunoPersonaPath,
          });
          if (sunoPersonaAudio) {
            await storageProvider.putFile({
              key: enrollmentSunoPersonaKey({ userId, sessionId: session_id }),
              filePath: sunoPersonaPath,
              contentType: "audio/wav",
            });
          } else if (shouldQueueSunoPersona && hasProviderConsent) {
            console.warn(
              "[Enrollment:complete] Sung Suno persona calibration unavailable; skipping Suno persona job",
            );
          }
        } catch (err) {
          console.warn(
            "[Enrollment:complete] Clean audio concat failed:",
            err.message,
          );
        }

        let cleanAudioAccessToken = session.access_token || null;
        if (shouldEmbed || (shouldQueueSunoPersona && hasProviderConsent)) {
          cleanAudioAccessToken = crypto.randomBytes(16).toString("hex");
          await db
            .prepare(
              "UPDATE enrollment_sessions SET access_token = ? WHERE id = ?",
            )
            .run(cleanAudioAccessToken, session_id);
        }

        if (shouldEmbed) {
          try {
            const audioUrl = `${getBaseUrl(request)}/enrollment/${session_id}/clean.wav?token=${cleanAudioAccessToken}`;
            const embedding = await extractEmbedding({
              baseUrl: appConfig.REPLICATE_BASE_URL,
              token: appConfig.REPLICATE_API_TOKEN,
              modelVersion: appConfig.REPLICATE_EMBEDDING_MODEL_VERSION,
              audioUrl,
              timeoutMs: appConfig.PROVIDER_TIMEOUT_MS,
            });
            const embeddingPath = storageProvider.resolveLocalPath
              ? storageProvider.resolveLocalPath(embeddingRef)
              : path.join(
                  appConfig.STORAGE_DIR,
                  "tmp-embedding",
                  `${profileId}.bin`,
                );
            await downloadToFile(
              embedding.embedding_url,
              embeddingPath,
              appConfig.PROVIDER_TIMEOUT_MS,
            );
            await storageProvider.putFile({
              key: embeddingRef,
              filePath: embeddingPath,
              contentType: "application/octet-stream",
            });
            if (!storageProvider.resolveLocalPath) {
              fs.rmSync(embeddingPath, { force: true });
            }
          } catch (err) {
            request.log.error(
              { err },
              "[Enrollment:complete] Embedding failed",
            );
            await db
              .prepare(
                "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
              )
              .run("failed_verification", nowIso(), session_id);
            sendError(
              reply,
              502,
              "E106_EMBEDDING_FAILED",
              "Voice embedding failed. Please try again.",
            );
            return;
          }
        }

        let elevenlabsVoiceId = null;
        const shouldCreateElevenLabsClone =
          appConfig.LIVE_PROVIDERS && Boolean(appConfig.ELEVENLABS_API_KEY);
        if (shouldCreateElevenLabsClone) {
          const elCleanDir = path.join(
            appConfig.STORAGE_DIR,
            "enrollment",
            "clean",
            userId,
            session_id,
          );
          const elCleanPath = path.join(elCleanDir, "clean.wav");

          if (fs.existsSync(elCleanPath)) {
            try {
              const {
                createVoiceClone,
                deleteVoiceClone,
              } = require("../providers/elevenlabs-voice");

              const existingWithClone = await db
                .prepare(
                  "SELECT elevenlabs_voice_id FROM voice_profiles WHERE user_id = ? AND status = 'active' AND elevenlabs_voice_id IS NOT NULL",
                )
                .get(userId);
              if (existingWithClone?.elevenlabs_voice_id) {
                console.log(
                  `[Enrollment:complete] Deleting existing ElevenLabs clone: ${existingWithClone.elevenlabs_voice_id}`,
                );
                await deleteVoiceClone({
                  apiKey: appConfig.ELEVENLABS_API_KEY,
                  voiceId: existingWithClone.elevenlabs_voice_id,
                }).catch((err) =>
                  console.warn(
                    "[Enrollment:complete] Failed to delete old clone:",
                    err.message,
                  ),
                );
              }

              const voiceClone = await createVoiceClone({
                apiKey: appConfig.ELEVENLABS_API_KEY,
                audioPath: elCleanPath,
                name: `porizo_user_${userId.slice(0, 8)}_${profileId.slice(0, 8)}`,
                description: `Porizo voice profile ${profileId}`,
              });
              elevenlabsVoiceId = voiceClone.voice_id;
              console.log(
                `[Enrollment:complete] ElevenLabs voice clone created: ${elevenlabsVoiceId}`,
              );
            } catch (err) {
              request.log.error(
                { err },
                "[Enrollment:complete] ElevenLabs clone creation failed (non-fatal)",
              );
            }
          } else {
            console.warn(
              "[Enrollment:complete] Clean audio not found for ElevenLabs clone",
            );
          }
        }

        const existingProfile = await db
          .prepare(
            "SELECT id, quality_score FROM voice_profiles WHERE user_id = ? AND status = 'active' LIMIT 1",
          )
          .get(userId);

        let outcome = "new";
        const existingScore = existingProfile?.quality_score || 0;

        if (existingProfile) {
          outcome = qualityScore > existingScore ? "upgraded" : "replaced";
        }

        // Compute vocal window outside the DB transaction so audio parsing does
        // not hold a transaction open.
        const shouldEnqueuePersona =
          shouldQueueSunoPersona &&
          hasProviderConsent &&
          cleanAudioReady &&
          Boolean(sunoPersonaAudio);
        const personaVocalWindow = shouldEnqueuePersona
          ? sunoPersonaAudio.vocalWindow
          : null;

        await db.transaction(async (query) => {
          const txDb = dbFromQuery(query);
          await txDb
            .prepare(
              "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
            )
            .run("completed", nowIso(), session_id);

          if (existingProfile) {
            await cancelVoiceProviderJobsForVoiceProfile(txDb, {
              voiceProfileId: existingProfile.id,
              userId,
              reason: "voice_profile_replaced",
            });
            await softDeleteProviderProfilesForVoiceProfile(txDb, {
              voiceProfileId: existingProfile.id,
              userId,
              reason: "voice_profile_replaced",
            });
            await txDb
              .prepare(
                "UPDATE voice_profiles SET status = ?, deleted_at = ? WHERE id = ?",
              )
              .run("deleted", nowIso(), existingProfile.id);
          }

          await txDb
            .prepare(
              "INSERT INTO voice_profiles (id, user_id, status, embedding_ref, quality_score, quality_tier, quality_metrics_json, model_version, consent_version, consent_at, last_verified_at, created_at, elevenlabs_voice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              profileId,
              userId,
              "active",
              embeddingRef,
              qualityScore,
              qualityTier,
              JSON.stringify(qcResult.metrics),
              shouldEmbed
                ? appConfig.REPLICATE_EMBEDDING_MODEL_VERSION
                : "embed_stub",
              session.consent_version,
              session.started_at,
              nowIso(),
              nowIso(),
              elevenlabsVoiceId,
            );

          if (
            shouldQueueSunoPersona &&
            hasProviderConsent &&
            (!cleanAudioReady || !sunoPersonaAudio)
          ) {
            const providerProfile = await createPendingProviderProfile(txDb, {
              voiceProfileId: profileId,
              userId,
              provider: "suno",
              consentScope: REQUIRED_CONSENT_SCOPE,
              metadata: {
                source: "enrollment",
                enrollment_session_id: session_id,
                failure: !cleanAudioReady
                  ? "source_audio_unavailable"
                  : "sung_calibration_unavailable",
              },
            });
            await txDb
              .prepare(
                "UPDATE voice_provider_profiles SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
              )
              .run(
                "failed",
                !cleanAudioReady
                  ? "source_audio_unavailable"
                  : "sung_calibration_unavailable",
                nowIso(),
                providerProfile.id,
              );
            providerProfileResult = {
              provider: "suno",
              status: !cleanAudioReady
                ? "source_audio_unavailable"
                : "sung_calibration_unavailable",
              id: providerProfile.id,
              job_id: null,
            };
          }

          if (shouldEnqueuePersona) {
            const providerProfile = await createPendingProviderProfile(txDb, {
              voiceProfileId: profileId,
              userId,
              provider: "suno",
              consentScope: REQUIRED_CONSENT_SCOPE,
              metadata: {
                source: "enrollment",
                enrollment_session_id: session_id,
                consent_version: session.consent_version,
              },
            });
            const providerJob = await createVoiceProviderJob(txDb, {
              voiceProfileId: profileId,
              userId,
              provider: "suno",
              voiceProviderProfileId: providerProfile.id,
              maxAttempts: 8,
              step: "prepare_persona",
              stepData: buildPersonaJobStepData({
                providerProfileId: providerProfile.id,
                sessionId: session_id,
                userId,
                model: sunoPersonaFlags.suno_voice_persona_model || "V5_5",
                audioWeight:
                  sunoPersonaFlags.suno_voice_persona_audio_weight ?? 0.85,
                vocalWindow: personaVocalWindow,
                sourceAudioKey: enrollmentSunoPersonaKey({
                  userId,
                  sessionId: session_id,
                }),
                sourceAudioName: "suno-persona.wav",
              }),
            });
            providerProfileResult = {
              provider: "suno",
              status: providerProfile.status,
              id: providerProfile.id,
              job_id: providerJob.id,
              source_audio: "sung_calibration",
              source_duration_sec: sunoPersonaAudio.durationSec,
            };
          }

          await txDb
            .prepare(
              "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              newUuid(),
              userId,
              "enrollment_completed",
              "voice_profile",
              profileId,
              toJson({
                quality_score: qualityScore,
                existing_score: existingProfile ? existingScore : null,
                outcome: outcome,
                qc_metrics: qcResult.metrics,
                voice_provider_profile: providerProfileResult
                  ? {
                      provider: providerProfileResult.provider,
                      status: providerProfileResult.status,
                      id: providerProfileResult.id || null,
                      job_id: providerProfileResult.job_id || null,
                    }
                  : null,
              }),
              nowIso(),
            );
        });

        const tierMeta = getTierMetadata(qualityTier);
        const chunkResults = qcResult.metrics.chunk_results || [];
        const improvementTips = chunkResults
          .filter((c) => c.issues && c.issues.length > 0)
          .map((c, i) => `Prompt ${i + 1}: ${c.issues[0]}`)
          .slice(0, 3);

        reply.code(202).send({
          status: "processing",
          job_id: newUuid(),
          voice_profile_id: profileId,
          outcome: outcome,
          quality: {
            tier: qualityTier,
            score: qualityScore,
            new_score: qualityScore,
            existing_score: existingProfile ? existingScore : null,
            stars: tierMeta.stars,
            label: tierMeta.label,
            disclosure: tierMeta.disclosure,
            can_improve: qualityTier !== "excellent",
            improvement_tips: improvementTips,
          },
          chunks: chunkResults.map((c, i) => ({
            index: i,
            type: c.metrics?.is_singing ? "sung" : "spoken",
            quality:
              c.grade === "A"
                ? "excellent"
                : c.grade === "B"
                  ? "good"
                  : c.grade === "C"
                    ? "fair"
                    : "poor",
            suggestion: c.issues?.[0] || null,
          })),
          voice_provider_profile: providerProfileResult,
          // Suno persona generation (uploadFileUrl + cover-poll up to ~6min
          // + generate-persona) typically takes 2–4 minutes wall clock. The
          // prior 30s hint caused iOS to time out the polling sheet on the
          // happy path even though the server-side flow completed normally.
          // 180s reflects the median observed runtime; iOS clamps to a
          // generous floor (see EnrollmentFlowView pollForVoiceProfile).
          estimated_completion_sec: 180,
        });
      } catch (err) {
        request.log.error({ err }, "[Enrollment:complete] Unexpected error");
        await db
          .prepare(
            "UPDATE enrollment_sessions SET status = ?, completed_at = ? WHERE id = ?",
          )
          .run("failed_internal", nowIso(), session_id);
        sendError(
          reply,
          500,
          "S501_INTERNAL_ERROR",
          "Enrollment processing failed unexpectedly. Please try again.",
        );
      } finally {
        if (tempDir) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    },
  );

  // ---- Voice profile ----

  app.get("/voice/profile", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const limit = await consumeRateLimit(userId, "voice_profile_read", 120, 60);
    if (!limit.allowed) {
      sendError(
        reply,
        429,
        "RATE_LIMITED",
        "Please wait before checking your voice profile again.",
        {
          retry_at: limit.reset_at,
        },
      );
      return;
    }
    const profile = await db
      .prepare(
        "SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }
    const providerProfile = await findLatestProviderProfileForVoiceProfile(db, {
      voiceProfileId: profile.id,
      provider: "suno",
    });
    const providerProfileReady = Boolean(
      providerProfile &&
      providerProfile.status === "active" &&
      providerProfile.provider_profile_id &&
      hasPersonaConsentScope(providerProfile.consent_scope),
    );
    const appBuild = parsePorizoBuild(request.headers["user-agent"]);
    const legacyClientNeedsPersonaGate =
      Number.isFinite(appBuild) && appBuild < 110;
    const responseStatus =
      legacyClientNeedsPersonaGate &&
      profile.status === "active" &&
      !providerProfileReady
        ? "preparing"
        : profile.status;
    reply.send({
      profile_id: profile.id,
      status: responseStatus,
      quality_score: profile.quality_score,
      created_at: profile.created_at,
      last_verified_at: profile.last_verified_at,
      model_version: profile.model_version,
      requires_reverification: false,
      local_voice_ready: profile.status === "active",
      my_voice_ready: providerProfileReady,
      voice_provider_profile: providerProfile
        ? {
            id: providerProfile.id,
            provider: providerProfile.provider,
            status: providerProfile.status,
            ready: providerProfileReady,
            has_provider_profile_id: Boolean(
              providerProfile.provider_profile_id,
            ),
            consent_scope: providerProfile.consent_scope || null,
            updated_at: providerProfile.updated_at || null,
            last_error: providerProfile.last_error || null,
          }
        : null,
    });
  });

  app.post("/voice/reverify", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    const profile = await db
      .prepare(
        "SELECT id FROM voice_profiles WHERE user_id = ? AND status = 'active'",
      )
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }
    const challengeId = newUuid();
    reply.send({
      challenge_id: challengeId,
      challenge_type: "random_phrase",
      prompt: {
        text: "Seven blue elephants walk quietly.",
        duration_hint_sec: 5,
      },
      upload_url: `https://s3.example.com/upload/reverify/${challengeId}`,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  });

  app.delete("/voice/profile", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }
    // Rate-limit voice-profile deletion to defang an abuse pattern flagged by
    // the adversarial review (adv-7 / H10): a script that rapidly enrolls then
    // deletes can leave orphan upload-cover tasks pending at Suno, each of
    // which we pay for. 1 deletion per minute is well above any legitimate
    // user flow (re-enrollment after a failure typically takes several
    // minutes of recording) and stops the cost-amplification window.
    const deleteLimit = await consumeRateLimit(
      userId,
      "voice_profile_delete",
      1,
      60,
    );
    if (!deleteLimit.allowed) {
      sendError(
        reply,
        429,
        "RATE_LIMITED",
        "Voice profile deletion rate limit reached.",
        { retry_at: deleteLimit.reset_at },
      );
      return;
    }
    const profile = await db
      .prepare(
        "SELECT * FROM voice_profiles WHERE user_id = ? AND status != 'deleted'",
      )
      .get(userId);
    if (!profile) {
      sendError(reply, 404, "NO_VOICE_PROFILE", "Voice profile not found.");
      return;
    }

    if (profile.elevenlabs_voice_id && appConfig.ELEVENLABS_API_KEY) {
      try {
        const { deleteVoiceClone } = require("../providers/elevenlabs-voice");
        await deleteVoiceClone({
          apiKey: appConfig.ELEVENLABS_API_KEY,
          voiceId: profile.elevenlabs_voice_id,
        });
        console.log(
          `[Voice:delete] Deleted ElevenLabs clone: ${profile.elevenlabs_voice_id}`,
        );
      } catch (err) {
        console.warn(
          "[Voice:delete] Failed to delete ElevenLabs clone:",
          err.message,
        );
      }
    }

    const providerProfiles = await db
      .prepare(
        `SELECT id, voice_profile_id, provider, status
         FROM voice_provider_profiles
        WHERE voice_profile_id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
      .all(profile.id, userId);
    await softDeleteProviderProfilesForVoiceProfile(db, {
      voiceProfileId: profile.id,
      userId,
      reason: "voice_profile_deleted",
    });
    await cancelVoiceProviderJobsForVoiceProfile(db, {
      voiceProfileId: profile.id,
      userId,
      reason: "voice_profile_deleted",
    });
    // U3: token revocation goes through enrollment-domain service.
    await revokeAllEnrollmentSessionTokensForUser(db, userId);

    await db
      .prepare(
        "UPDATE voice_profiles SET status = ?, embedding_ref = ?, elevenlabs_voice_id = ?, deleted_at = ? WHERE id = ?",
      )
      .run("deleted", null, null, nowIso(), profile.id);
    await addAuditEntry({
      userId,
      action: "voice_profile_deleted",
      resourceType: "voice_profile",
      resourceId: profile.id,
      metadata: {
        provider_profiles_deleted: providerProfiles.map((row) => ({
          id: row.id,
          voice_profile_id: row.voice_profile_id,
          provider: row.provider,
          status: row.status,
        })),
      },
    });
    reply.send({ deleted: true, deletion_job_id: newUuid() });
  });

  // ---- Memory Questions ----

  app.post(
    "/memory/questions",
    { schema: schemas.memoryQuestions },
    async (request, reply) => {
      const userId = await requireUserId(request, reply);
      if (!userId) {
        return;
      }

      const limit = await consumeRateLimit(userId, "memory_questions", 30, 60);
      if (!limit.allowed) {
        sendError(
          reply,
          429,
          "RATE_LIMITED",
          "Question generation rate limit reached.",
          {
            retry_at: limit.reset_at,
          },
        );
        return;
      }

      const body = request.body || {};
      const { memory, occasion, recipient_name } = body;

      const moderation = moderationCheck({ message: memory });
      if (!moderation.allowed) {
        sendError(
          reply,
          422,
          "MODERATION_BLOCKED",
          "Memory blocked by moderation.",
          {
            reason: moderation.reason,
          },
        );
        return;
      }

      try {
        const result = await generateMemoryQuestions({
          memory,
          occasion: occasion || "celebration",
          recipientName: recipient_name || "them",
        });

        reply.send({
          questions: result.questions,
        });
      } catch (err) {
        console.error("[POST /memory/questions] Error:", err.message);
        sendError(
          reply,
          500,
          "QUESTION_GENERATION_FAILED",
          "Failed to generate questions. Please try again.",
        );
      }
    },
  );
}

module.exports = {
  registerEnrollmentRoutes,
  __test: {
    attachChunkQualityResults,
    buildSunoPersonaCalibration,
  },
};
