const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const SAFE_STRING_MAX = 200;
const UNSAFE_PATTERN = /<script|javascript:/i;

const safeShortString = z
  .string()
  .min(1)
  .max(SAFE_STRING_MAX)
  .refine((value) => !UNSAFE_PATTERN.test(value), {
    message: "Input contains disallowed pattern (<script or javascript:)",
  });

const PUBLIC_PRICING_TIERS = [
  {
    id: "free",
    name: "Free",
    price_monthly_usd: 0,
    price_annual_usd: 0,
    description: "Start free. Limited previews and shareable songs.",
  },
  {
    id: "premium_monthly",
    name: "Premium (monthly)",
    price_monthly_usd: 9.99,
    price_annual_usd: null,
    description:
      "Full access to song and poem creation, more previews per day, voice enrollment.",
  },
  {
    id: "premium_annual",
    name: "Premium (annual)",
    price_monthly_usd: null,
    price_annual_usd: 99.0,
    description:
      "All Premium features billed annually for the lower effective monthly rate.",
  },
];

function buildCreateSongDeepLink({ occasion, recipient, message }) {
  const params = new URLSearchParams({
    occasion,
    recipient,
    message,
  });
  return `https://porizo.co/?${params.toString()}`;
}

function createMcpServer() {
  const server = new McpServer(
    {
      name: "porizo",
      version: "1.5.9",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  server.registerTool(
    "create-song",
    {
      description:
        "Create a personalized song from an occasion, a recipient name, and a personal message. Returns a deep link the user can open to start creating the song in the Porizo iOS app.",
      inputSchema: {
        occasion: safeShortString.describe(
          "The occasion (e.g. birthday, anniversary, graduation).",
        ),
        recipient: safeShortString.describe("The recipient's name."),
        message: safeShortString.describe(
          "A short personal message to weave into the song.",
        ),
      },
    },
    async ({ occasion, recipient, message }) => {
      const deepLink = buildCreateSongDeepLink({ occasion, recipient, message });
      return {
        content: [
          {
            type: "text",
            text: deepLink,
          },
        ],
        structuredContent: {
          deep_link: deepLink,
          note: "Opening this link on iOS launches the Porizo app via Universal Links and prefills the create-song flow.",
        },
      };
    },
  );

  server.registerTool(
    "get-pricing",
    {
      description:
        "Return the publicly available Porizo plan tiers (free and premium). Prices are in USD.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(PUBLIC_PRICING_TIERS, null, 2),
          },
        ],
        structuredContent: {
          currency: "USD",
          tiers: PUBLIC_PRICING_TIERS,
        },
      };
    },
  );

  return server;
}

function registerMcpRoutes(app) {
  // Stateless JSON-response mode: a fresh transport per request, no session map.
  // Two synchronous tools, no streaming notifications — JSON response is sufficient.
  async function handleMcpRequest(request, reply) {
    reply.hijack();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, "MCP request handling failed");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader("Content-Type", "application/json");
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          }),
        );
      }
    } finally {
      try {
        await server.close();
      } catch (_e) {
        /* noop */
      }
    }
  }

  app.post(
    "/mcp",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    handleMcpRequest,
  );

  // Spec requires 405 on GET when SSE streaming is not supported.
  app.get(
    "/mcp",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (_request, reply) => {
      reply.code(405).header("Allow", "POST").send({
        error: "method_not_allowed",
        error_description:
          "MCP server uses JSON-response mode; GET (SSE streaming) is not supported.",
      });
    },
  );
}

module.exports = { registerMcpRoutes };
