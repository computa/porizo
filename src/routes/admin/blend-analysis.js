"use strict";

const fs = require("fs");
const path = require("path");
const {
  analyzeBlend,
  formatAnalysisReport,
} = require("../../utils/blend-analyzer");

function registerAdminBlendAnalysisRoutes(
  app,
  {
    adminMusicDiagnosticsRepo,
    appConfig,
    requireAdminRole,
    requireAdminSession,
    sendError,
  },
) {
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
      const trackVersion =
        await adminMusicDiagnosticsRepo.findTrackVersionBlendContext(
          trackVersionId,
        );

      if (!trackVersion) {
        return sendError(reply, 404, "NOT_FOUND", "Track version not found");
      }

      const userId = trackVersion.user_id;
      const trackId = trackVersion.track_id;
      const version = trackVersion.version_num;
      const basePath = path.join(
        process.cwd(),
        "storage/tracks",
        userId,
        trackId,
        `v${version}`,
      );

      const filePaths = {
        userEnrollmentPath: null,
        originalVocalPath: path.join(basePath, "stems/vocals.wav"),
        convertedVocalPath: path.join(basePath, "user_vocal.wav"),
        blendedOutputPath: path.join(basePath, "blended_vocal.wav"),
      };

      const voiceProfile =
        await adminMusicDiagnosticsRepo.findLatestActiveVoiceProfileForUser(
          userId,
        );

      if (voiceProfile) {
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
              const sungChunk =
                chunks.find((c) => c.includes("sung")) || chunks[0];
              filePaths.userEnrollmentPath = path.join(sessionPath, sungChunk);
            }
          }
        }
      }

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

      const analysis = await analyzeBlend(existingFiles);
      analysis.trackContext = {
        trackVersionId,
        trackId,
        userId,
        version,
        filesAnalyzed: Object.keys(existingFiles),
        filesMissing: Object.keys(filePaths).filter((k) => !existingFiles[k]),
      };

      if (includeReport) {
        analysis.report = formatAnalysisReport(analysis);
      }

      reply.send(analysis);
    } catch (err) {
      console.error("[Admin] BLEND_ANALYSIS_ERROR:", err);
      sendError(reply, 500, "ANALYSIS_ERROR", "Failed to analyze blend");
    }
  });

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
}

module.exports = { registerAdminBlendAnalysisRoutes };
