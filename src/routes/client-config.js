"use strict";

function registerClientConfigRoutes(app, { clientConfigService }) {
  app.get("/app/config", async (request, reply) => {
    const clientConfig = await clientConfigService.getClientConfig();
    reply.send(clientConfig);
  });
}

module.exports = { registerClientConfigRoutes };
