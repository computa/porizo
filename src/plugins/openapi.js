const { fastifySwagger } = require("@fastify/swagger");

const PUBLIC_API_EXCLUDED_PREFIXES = Object.freeze([
  "/admin",
  "/debug",
  "/internal",
  "/gifts/webhooks",
]);

const PUBLIC_API_INCLUDED_PREFIXES = Object.freeze([
  "/.well-known",
  "/auth",
  "/billing",
  "/data",
  "/device",
  "/download",
  "/embed",
  "/enrollment",
  "/g/",
  "/gift-link",
  "/gifts",
  "/health",
  "/jobs",
  "/legal",
  "/mcp",
  "/openapi.json",
  "/play",
  "/poem-share",
  "/poem/",
  "/poems",
  "/s/",
  "/share",
  "/skills",
  "/storage",
  "/story",
  "/tracks",
  "/unsubscribe",
  "/v2/story",
  "/voice",
]);

const PUBLIC_API_EXCLUDED_EXACT_PATHS = Object.freeze([
  "/gifts/",
  "/gifts/:slug",
  "/gifts/{slug}",
  "/health/providers",
]);

function isPublicOpenApiPath(url) {
  if (PUBLIC_API_EXCLUDED_EXACT_PATHS.includes(url)) {
    return false;
  }
  if (PUBLIC_API_EXCLUDED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return false;
  }
  return PUBLIC_API_INCLUDED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function withDefaultTags(schema, url) {
  if (schema?.tags?.length > 0) {
    return schema;
  }
  let tag = "public";
  if (url.startsWith("/auth")) tag = "auth";
  else if (url.startsWith("/tracks")) tag = "tracks";
  else if (url.startsWith("/poems")) tag = "poems";
  else if (url.startsWith("/share")) tag = "sharing";
  else if (url.startsWith("/voice") || url.startsWith("/enrollment")) {
    tag = "voice-enrollment";
  } else if (url.startsWith("/billing")) tag = "billing";
  else if (url.startsWith("/story")) tag = "story";
  else if (url.startsWith("/mcp")) tag = "mcp";
  else if (url.startsWith("/health")) tag = "health";
  return {
    ...schema,
    tags: [tag],
  };
}

function registerOpenApi(app, { publicBaseUrl } = {}) {
  fastifySwagger(app, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Porizo API",
        version: "1.5.9",
        description:
          "Runtime-generated OpenAPI contract for public, mobile, and discovery endpoints. The error envelope is documented in docs/api/error-envelope.md.",
      },
      servers: [
        {
          url: publicBaseUrl || "https://porizo.co",
          description: publicBaseUrl ? "Configured public base URL" : "Production",
        },
      ],
      tags: [
        { name: "auth", description: "Authentication and account endpoints" },
        { name: "billing", description: "Subscription and receipt endpoints" },
        { name: "health", description: "Service health endpoints" },
        { name: "mcp", description: "MCP discovery and JSON-RPC endpoints" },
        { name: "poems", description: "Poem creation and library endpoints" },
        { name: "sharing", description: "Share, claim, and receiver endpoints" },
        { name: "story", description: "Story collection and create-flow endpoints" },
        { name: "tracks", description: "Song and render endpoints" },
        { name: "voice-enrollment", description: "Voice enrollment endpoints" },
        { name: "public", description: "Public landing and utility endpoints" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          deviceToken: {
            type: "apiKey",
            in: "header",
            name: "x-device-token",
          },
          devUserId: {
            type: "apiKey",
            in: "header",
            name: "x-user-id",
            description: "Development/test fallback only; disabled in production.",
          },
        },
        schemas: {
          ErrorEnvelope: {
            type: "object",
            required: ["error", "message"],
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
            additionalProperties: true,
          },
        },
      },
    },
    transform: ({ schema, url }) => {
      if (!isPublicOpenApiPath(url)) {
        return { schema: { ...schema, hide: true }, url };
      }
      return {
        schema: withDefaultTags(schema || {}, url),
        url,
      };
    },
  }, (err) => {
    if (err) {
      throw err;
    }
  });
}

function getOpenApiDocument(app) {
  if (typeof app.swagger !== "function") {
    return null;
  }
  return app.swagger();
}

module.exports = {
  getOpenApiDocument,
  registerOpenApi,
  __test: {
    isPublicOpenApiPath,
    withDefaultTags,
  },
};
