const crypto = require("crypto");
const config = require("../config");
const { loadPublicFile } = require("../utils/public-files");
const { cardJson: mcpServerCard } = require("../utils/mcp-card");

const apiCatalog = loadPublicFile(".well-known/api-catalog", { warnOnMissing: true });
const oauthAuthServer = loadPublicFile(".well-known/oauth-authorization-server", { warnOnMissing: true });
const oauthProtectedResource = loadPublicFile(".well-known/oauth-protected-resource", { warnOnMissing: true });
const openapiDoc = loadPublicFile("openapi.json", { warnOnMissing: true });
const createSongSkillMd = loadPublicFile("skills/create-song.md", { warnOnMissing: true });

// Parse-and-restringify the pricing JSON at boot so we serve normalized bytes
// (no BOM, consistent whitespace) and surface a malformed file as a boot warn
// instead of an opaque parse error in a downstream consumer.
function normalizePricingTiers() {
  const raw = loadPublicFile("data/pricing-tiers.json", { warnOnMissing: true });
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch (err) {
    console.warn(`[well-known] pricing-tiers.json is malformed (${err.message})`);
    return null;
  }
}
const pricingTiersJson = normalizePricingTiers();

const createSongSkillSha256 = createSongSkillMd
  ? crypto.createHash("sha256").update(createSongSkillMd).digest("hex")
  : null;

const PUBLIC_BASE = config.PUBLIC_BASE_URL.replace(/\/$/, "");

const agentSkillsIndex = createSongSkillSha256
  ? JSON.stringify({
      $schema: "https://agentskills.io/schemas/v0.2.0/index.json",
      skills: [
        {
          name: "create-song",
          type: "http",
          description:
            "Create a personalized song from an occasion + recipient + message",
          url: `${PUBLIC_BASE}/skills/create-song`,
          sha256: createSongSkillSha256,
        },
      ],
    })
  : null;

function registerWellKnownRoutes(app) {
  function serveJson(reply, body, contentType = "application/json", { maxAge = 3600 } = {}) {
    // Explicit null-check matches the documented contract of loadPublicFile,
    // which returns null when the file is missing. A 0-byte file would be a
    // separate (and more troubling) bug worth letting through.
    if (body == null) {
      reply
        .code(404)
        .type("application/json")
        .send({ error: "discovery_document_unavailable" });
      return;
    }
    reply
      .type(contentType)
      .header("Cache-Control", `public, max-age=${maxAge}`)
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
    // Short TTL: the server-card carries the version, which can change with
    // each rolling deploy. A 1h CDN cache would let the discovery card lag
    // behind what the live `initialize` handshake reports for almost an hour.
    serveJson(reply, mcpServerCard, "application/json", { maxAge: 60 });
  });

  app.get("/.well-known/agent-skills/index.json", async (_request, reply) => {
    serveJson(reply, agentSkillsIndex);
  });

  // RFC 7517 — empty key set is the spec answer when no signing keys exist;
  // the OAuth discovery doc still has to point at *something* to be valid.
  app.get("/.well-known/jwks.json", async (_request, reply) => {
    reply
      .type("application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send({ keys: [] });
  });

  app.get("/openapi.json", async (_request, reply) => {
    serveJson(reply, openapiDoc, "application/openapi+json");
  });

  // Single source of truth for the public plan tiers — read by the MCP
  // server's get-pricing tool AND fetched by the browser-side WebMCP script,
  // so both surfaces stay in sync without requiring a build step.
  app.get("/data/pricing-tiers.json", async (_request, reply) => {
    serveJson(reply, pricingTiersJson);
  });

  app.get("/skills/create-song", async (_request, reply) => {
    if (createSongSkillMd == null) {
      reply
        .code(404)
        .type("application/json")
        .send({ error: "skill_not_available" });
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
