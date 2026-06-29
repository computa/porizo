"use strict";

const { safeBounds } = require("./pagination");

function createAdminStorySessionService({ adminStorySessionRepository }) {
  if (!adminStorySessionRepository) {
    throw new Error("adminStorySessionRepository is required");
  }

  async function listStorySessions({
    status,
    engineVersion,
    limit = 50,
    offset = 0,
  }) {
    const bounds = safeBounds(limit, offset);
    return adminStorySessionRepository.listSessions({
      status,
      engineVersion,
      limit: bounds.limit,
      offset: bounds.offset,
    });
  }

  async function getStorySessionDetail(sessionId) {
    return adminStorySessionRepository.getSessionDetail(sessionId);
  }

  return {
    listStorySessions,
    getStorySessionDetail,
  };
}

module.exports = {
  createAdminStorySessionService,
};
