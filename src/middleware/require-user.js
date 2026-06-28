"use strict";

const INVALID_TOKEN_MESSAGE = "Invalid or expired access token.";

function isDevAuthFallbackAllowed() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function sendInvalidToken(reply, sendError, errorCode = "INVALID_TOKEN") {
  sendError(reply, 401, errorCode, INVALID_TOKEN_MESSAGE);
  return null;
}

function createRequireUser({
  authService,
  ensureUser,
  sendError,
  allowAnonUserId = false,
  fallbackMissingMessage = "Missing x-user-id header.",
  missingTokenMessage = "Missing authorization token.",
  missingTokenCode = "AUTH_REQUIRED",
  attachUserId = true,
}) {
  if (!authService) {
    throw new Error("createRequireUser requires authService");
  }
  if (typeof sendError !== "function") {
    throw new Error("createRequireUser requires sendError");
  }

  return async function requireUser(request, reply) {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = authService.verifyAccessToken(token);
        const userId = payload?.sub;
        if (!userId) {
          sendError(reply, 401, "INVALID_TOKEN", "Invalid access token.");
          return null;
        }

        const activeUser = await authService.verifyActiveUser({ userId });
        if (!activeUser) {
          return sendInvalidToken(reply, sendError);
        }

        const sessionId = payload?.sid;
        if (!sessionId) {
          return sendInvalidToken(reply, sendError);
        }

        const activeSession = await authService.verifyActiveSessionForUser({
          userId,
          sessionId,
        });
        if (!activeSession) {
          return sendInvalidToken(reply, sendError);
        }

        request.sessionId = sessionId;
        if (attachUserId) {
          request.userId = userId;
        }
        if (typeof ensureUser === "function") {
          await ensureUser(userId);
        }
        return userId;
      } catch (err) {
        request.log?.warn?.(
          {
            authError: {
              name: err?.name,
              message: err?.message,
              code: err?.code,
            },
          },
          "Access token verification failed",
        );
        return sendInvalidToken(reply, sendError);
      }
    }

    if (allowAnonUserId && isDevAuthFallbackAllowed()) {
      const userId = request.headers["x-user-id"];
      if (!userId || typeof userId !== "string") {
        sendError(reply, 401, missingTokenCode, fallbackMissingMessage);
        return null;
      }
      if (attachUserId) {
        request.userId = userId;
      }
      if (typeof ensureUser === "function") {
        await ensureUser(userId);
      }
      return userId;
    }

    sendError(reply, 401, missingTokenCode, missingTokenMessage);
    return null;
  };
}

module.exports = {
  createRequireUser,
};
