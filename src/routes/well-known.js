const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadPublicFile(relativePath) {
  const filePath = path.join(process.cwd(), "public", relativePath);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_error) {
    return null;
  }
}

const apiCatalog = loadPublicFile(".well-known/api-catalog");
const oauthAuthServer = loadPublicFile(".well-known/oauth-authorization-server");
const oauthProtectedResource = loadPublicFile(".well-known/oauth-protected-resource");
const mcpServerCard = loadPublicFile(".well-known/mcp/server-card.json");
const openapiDoc = loadPublicFile("openapi.json");
const createSongSkillMd = loadPublicFile("skills/create-song.md");

const createSongSkillSha256 = createSongSkillMd
  ? crypto.createHash("sha256").update(createSongSkillMd).digest("hex")
  : null;

const agentSkillsIndex = createSongSkillSha256
  ? JSON.stringify({
      $schema: "https://agentskills.io/schemas/v0.2.0/index.json",
      skills: [
        {
          name: "create-song",
          type: "http",
          description:
            "Create a personalized song from an occasion + recipient + message",
          url: "https://porizo.co/skills/create-song",
          sha256: createSongSkillSha256,
        },
      ],
    })
  : null;

function registerWellKnownRoutes(app) {
  function serveJson(reply, body, contentType = "application/json") {
    if (!body) {
      reply.code(404).send();
      return;
    }
    reply
      .type(contentType)
      .header("Cache-Control", "public, max-age=3600")
      .send(body);
  }

  app.get("/.well-known/api-catalog", async (_request, reply) => {
    serveJson(reply, apiCatalog, "application/linkset+json");
  });

  app.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
    serveJson(reply, oauthAuthServer);
  });

  app.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
    serveJson(reply, oauthProtectedResource);
  });

  app.get("/.well-known/mcp/server-card.json", async (_request, reply) => {
    serveJson(reply, mcpServerCard);
  });

  app.get("/.well-known/agent-skills/index.json", async (_request, reply) => {
    serveJson(reply, agentSkillsIndex);
  });

  app.get("/.well-known/jwks.json", async (_request, reply) => {
    reply
      .type("application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send({ keys: [] });
  });

  app.get("/openapi.json", async (_request, reply) => {
    serveJson(reply, openapiDoc, "application/openapi+json");
  });

  app.get("/skills/create-song", async (_request, reply) => {
    if (!createSongSkillMd) {
      reply.code(404).send();
      return;
    }
    reply
      .type("text/markdown; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send(createSongSkillMd);
  });

  const oauthNotImplemented = {
    error: "oauth_not_implemented",
    error_description:
      "Web OAuth is not implemented. Use the Porizo iOS app for authentication.",
  };

  app.get("/auth/authorize", async (_request, reply) => {
    reply.code(501).type("application/json").send(oauthNotImplemented);
  });

  app.post("/auth/token", async (_request, reply) => {
    reply.code(501).type("application/json").send(oauthNotImplemented);
  });
}

module.exports = { registerWellKnownRoutes };
