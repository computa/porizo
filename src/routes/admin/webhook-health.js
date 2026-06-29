"use strict";

function registerAdminWebhookHealthRoutes(
  app,
  { webhookHealthService, requireAdminSession },
) {
  app.get("/admin/dashboard/webhooks/health", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const health = await webhookHealthService.getWebhookHealth();
    reply.send(health);
  });
}

module.exports = { registerAdminWebhookHealthRoutes };
