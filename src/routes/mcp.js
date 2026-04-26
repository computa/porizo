const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const config = require("../config");
const { loadPublicFile } = require("../utils/public-files");
const { serverInfo: SERVER_INFO } = require("../utils/mcp-card");

// Authoritative validation. The browser-side webmcp.js applies the same
// rules as a UX-layer pre-check (see SAFE_STRING_MAX / UNSAFE_PATTERN there)
// — drift is acceptable because the server is the security boundary.
const SAFE_STRING_MAX = 200;
const UNSAFE_PATTERN = /<script|javascript:/i;

// Hard cap so a slow or hostile client cannot keep a hijacked connection open
// indefinitely. reply.hijack() bypasses Fastify's own request timeout, so we
// race transport.handleRequest against this timeout ourselves.
const MCP_REQUEST_TIMEOUT_MS = 30_000;

// Cap how much amplification a single request can produce. JSON-RPC batches
// are spec but a hostile actor could submit thousands of tools/call entries
// to amplify behind the per-IP rate limit; cap to a number that fits a real
// agent workflow (a multi-tool plan rarely exceeds a handful of calls).
const MCP_MAX_BATCH = 10;
// Per-route body limit. The biggest legitimate payload is a tools/call with
// three 200-char strings (~1KB); 16KB leaves generous headroom while keeping
// the SDK's hot path bounded.
const MCP_BODY_LIMIT_BYTES = 16 * 1024;

// Same rate limit applies to POST and GET — hoist so both routes use the same
// instance and a future tweak only edits one place.
const MCP_ROUTE_CONFIG = {
  bodyLimit: MCP_BODY_LIMIT_BYTES,
  config: {
    rateLimit: { max: 60, timeWindow: "1 minute" },
  },
};

const safeShortString = z
  .string()
  .min(1)
  .max(SAFE_STRING_MAX)
  .refine((value) => !UNSAFE_PATTERN.test(value), {
    message: "Input contains disallowed pattern (<script or javascript:)",
  });

// Pricing tiers — single source of truth lives at public/data/pricing-tiers.json.
// Read at boot; both this MCP server and the browser-side WebMCP script consume
// the same file. We require at least 2 tiers so a partial/truncated deploy
// (which can produce valid-but-incomplete JSON) cannot silently advertise
// Porizo as free-only.
const MIN_PRICING_TIERS = 2;
function readPricingTiers() {
  const raw = loadPublicFile("data/pricing-tiers.json", { warnOnMissing: true });
  if (!raw) {
    throw new Error(
      "[mcp] pricing-tiers.json is missing — refusing to start so we never advertise empty pricing",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[mcp] pricing-tiers.json is malformed: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.tiers) || parsed.tiers.length < MIN_PRICING_TIERS) {
    throw new Error(
      `[mcp] pricing-tiers.json has fewer than ${MIN_PRICING_TIERS} tiers — likely a partial-write during deploy`,
    );
  }
  return {
    currency: parsed.currency || "USD",
    tiers: parsed.tiers,
  };
}
const PRICING = readPricingTiers();

function buildCreateSongDeepLink({ occasion, recipient, message }) {
  const params = new URLSearchParams({
    occasion,
    recipient,
    message,
  });
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/?${params.toString()}`;
}

function createMcpServer() {
  const server = new McpServer(
    SERVER_INFO,
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
            text: JSON.stringify(PRICING.tiers, null, 2),
          },
        ],
        structuredContent: PRICING,
      };
    },
  );

  return server;
}

async function safeClose(closer, label, log) {
  try {
    await closer();
  } catch (err) {
    log.warn({ err, target: label }, "MCP cleanup failed");
  }
}

function registerMcpRoutes(app) {
  // Stateless JSON-response mode: a fresh transport per request, no session map.
  // Two synchronous tools, no streaming notifications — JSON response is sufficient.
  async function handleMcpRequest(request, reply) {
    // Batch cap before the SDK touches the payload. A hostile client could
    // submit thousands of entries to amplify behind the per-IP rate limit.
    if (Array.isArray(request.body) && request.body.length > MCP_MAX_BATCH) {
      reply.code(413).send({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: `Batch too large (max ${MCP_MAX_BATCH} entries)`,
        },
        id: null,
      });
      return;
    }

    let transport = null;
    let server = null;
    let timer = null;
    let work = null;
    try {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      server = createMcpServer();
      reply.hijack();

      work = (async () => {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      })();

      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP request exceeded ${MCP_REQUEST_TIMEOUT_MS}ms`)),
          MCP_REQUEST_TIMEOUT_MS,
        );
      });

      await Promise.race([work, timeout]);
    } catch (error) {
      // Distinguish client-side validation errors from server-side faults so
      // callers get an actionable JSON-RPC error code (-32602 invalid params)
      // instead of a generic 500. The SDK already routes most ZodError cases
      // through the response content channel; this catch is the fallback for
      // errors that escape the SDK boundary.
      const isValidation = error && error.name === "ZodError";
      const status = isValidation ? 400 : 500;
      const rpcCode = isValidation ? -32602 : -32603;
      const rpcMessage = isValidation
        ? "Invalid params"
        : "Internal server error";
      request.log.error({ err: error }, "MCP request handling failed");
      if (reply.raw && !reply.raw.headersSent) {
        try {
          reply.raw.statusCode = status;
          reply.raw.setHeader("Content-Type", "application/json");
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: rpcCode, message: rpcMessage },
              id: null,
            }),
          );
        } catch (writeErr) {
          request.log.warn({ err: writeErr }, "MCP failed to write error response");
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      // If the timeout won the race, `work` is still in flight and may reject
      // when we close the transport underneath it. Attach a no-op .catch so
      // its eventual rejection doesn't surface as an UnhandledPromiseRejection
      // (which on Node 18+ defaults crashes the worker).
      if (work) work.catch(() => {});
      if (server) await safeClose(() => server.close(), "server", request.log);
      if (transport) await safeClose(() => transport.close(), "transport", request.log);
    }
  }

  app.post("/mcp", MCP_ROUTE_CONFIG, handleMcpRequest);

  // Spec requires 405 on GET when SSE streaming is not supported.
  app.get("/mcp", MCP_ROUTE_CONFIG, async (_request, reply) => {
    reply.code(405).header("Allow", "POST").send({
      error: "method_not_allowed",
      error_description:
        "MCP server uses JSON-response mode; GET (SSE streaming) is not supported.",
    });
  });
}

module.exports = { registerMcpRoutes };
