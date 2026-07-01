"use strict";

function registerAdminStorySessionRoutes(
  app,
  { storySessionService, parsePagination, requireAdminSession, sendError },
) {
  app.get("/admin/dashboard/story/sessions", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const { status, engineVersion } = request.query;
    const sessions = await storySessionService.listStorySessions({
      status,
      engineVersion,
      ...parsePagination(request.query),
    });
    reply.send({ sessions });
  });

  app.get("/admin/dashboard/story/sessions/:id", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const detail = await storySessionService.getStorySessionDetail(request.params.id);
    if (!detail) {
      sendError(reply, 404, "NOT_FOUND", "Story session not found");
      return;
    }
    reply.send(detail);
  });
}

module.exports = { registerAdminStorySessionRoutes };
