"use strict";

function registerEtsyOAuthRoutes(app, { authorization, sendError, adminUrl = "/admin/etsy" }) {
  app.get("/integrations/etsy/callback", { logLevel: "warn" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.query?.error) {
      return sendError(reply, 400, "ETSY_OAUTH_DENIED", "Etsy authorization was not completed.");
    }
    try {
      await authorization.complete({ state: request.query?.state, code: request.query?.code });
      return reply.redirect(`${adminUrl}?etsy=connected`);
    } catch (error) {
      return sendError(reply, 400, error.code || "ETSY_OAUTH_FAILED", "Etsy authorization could not be completed. Start the connection again.");
    }
  });
}

module.exports = { registerEtsyOAuthRoutes };
