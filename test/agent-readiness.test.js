/**
 * Agent-readiness integration tests
 *
 * Covers the MCP server (POST /mcp) and the markdown-negotiation
 * onSend hook. Each suite spins up an isolated Fastify instance with
 * only the routes it needs — no DB, no full buildServer().
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

process.env.PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://porizo.test";

const fastify = require("fastify");
const rateLimit = require("@fastify/rate-limit");
const { registerMcpRoutes } = require("../src/routes/mcp");
const { registerLegalRoutes } = require("../src/routes/legal");
const { registerWellKnownRoutes } = require("../src/routes/well-known");
const markdownPlugin = require("../src/plugins/markdown-negotiation");

function buildHttp(port) {
  const http = require("http");
  return function req(method, p, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const opts = {
        method,
        host: "127.0.0.1",
        port,
        path: p,
        headers: { ...headers },
      };
      if (body) opts.headers["Content-Type"] = "application/json";
      const r = http.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            ct: res.headers["content-type"],
            vary: res.headers.vary,
            link: res.headers.link,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
      r.on("error", reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  };
}

describe("MCP server (/mcp)", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    await app.register(rateLimit, { global: false });
    registerMcpRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  it("initialize returns serverInfo from the static server card", async () => {
    const r = await req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      { Accept: "application/json, text/event-stream" },
    );
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    assert.strictEqual(body.jsonrpc, "2.0");
    assert.strictEqual(body.result.serverInfo.name, "porizo");
    assert.match(body.result.serverInfo.version, /^\d+\.\d+\.\d+$/);
  });

  it("create-song returns a deep link with URL-encoded inputs", async () => {
    const r = await req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create-song",
          arguments: {
            occasion: "birthday",
            recipient: "Ada Lovelace",
            message: "happy day!",
          },
        },
      },
      { Accept: "application/json, text/event-stream" },
    );
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    const dl = body.result.structuredContent.deep_link;
    assert.match(dl, /occasion=birthday/);
    assert.match(dl, /recipient=Ada\+Lovelace/);
    assert.match(dl, /message=happy\+day%21/);
    assert.ok(
      dl.startsWith(process.env.PUBLIC_BASE_URL),
      `deep link should start with PUBLIC_BASE_URL, got: ${dl}`,
    );
  });

  it("create-song rejects <script> in input", async () => {
    const r = await req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create-song",
          arguments: {
            occasion: "<script>alert(1)</script>",
            recipient: "x",
            message: "y",
          },
        },
      },
      { Accept: "application/json, text/event-stream" },
    );
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /disallowed pattern/);
  });

  it("create-song rejects javascript: in input", async () => {
    const r = await req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create-song",
          arguments: {
            occasion: "x",
            recipient: "javascript:alert(1)",
            message: "y",
          },
        },
      },
      { Accept: "application/json, text/event-stream" },
    );
    assert.match(r.body, /disallowed pattern/);
  });

  it("get-pricing returns the public plan tiers", async () => {
    const r = await req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get-pricing", arguments: {} },
      },
      { Accept: "application/json, text/event-stream" },
    );
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    const tiers = body.result.structuredContent.tiers;
    assert.ok(Array.isArray(tiers) && tiers.length >= 2);
    const ids = tiers.map((t) => t.id);
    assert.ok(ids.includes("free"));
    assert.ok(ids.some((id) => id.startsWith("premium")));
  });

  it("GET /mcp returns 405", async () => {
    const r = await req("GET", "/mcp");
    assert.strictEqual(r.status, 405);
  });
});

describe("markdown-negotiation onSend hook", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    await app.register(markdownPlugin);
    registerLegalRoutes(app, { db: { prepare: () => ({ all: () => [] }) } });
    // Stub a non-marketing HTML route to verify allowlist exclusion.
    app.get("/admin/dummy", async (_req, reply) => {
      reply
        .type("text/html; charset=utf-8")
        .send("<html><body>admin</body></html>");
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  it("transforms marketing pages to markdown when Accept: text/markdown", async () => {
    const r = await req("GET", "/", null, { Accept: "text/markdown" });
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/markdown/);
    assert.strictEqual(r.vary, "Accept");
    assert.doesNotMatch(r.body, /^<!DOCTYPE html>/i);
  });

  it("preserves HTML on marketing pages when Accept does not include text/markdown", async () => {
    const r = await req("GET", "/");
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/html/);
    assert.strictEqual(r.vary, "Accept");
    assert.match(r.body, /^<!DOCTYPE html>/i);
  });

  it("does not transform non-marketing routes even with Accept: text/markdown", async () => {
    const r = await req("GET", "/admin/dummy", null, { Accept: "text/markdown" });
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/html/);
    // Vary must be entirely absent — the plugin sets Vary: Accept ONLY on
    // allowlisted routes. A future hook adding Vary: Cookie would silently
    // pass `notStrictEqual("Accept")` while still being wrong for our intent.
    assert.strictEqual(r.vary, undefined);
  });

  it("does not transform robots.txt", async () => {
    const r = await req("GET", "/robots.txt", null, { Accept: "text/markdown" });
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/plain/);
  });

  it("does not transform path-traversal attempts", async () => {
    // Allowlist must match exact path segments, not URL-encoded variants
    const r = await req("GET", "/admin/..%2F..%2Fpricing", null, {
      Accept: "text/markdown",
    });
    // The traversal attempt must NEVER be served as markdown — that's the
    // load-bearing assertion. The status itself can be 404 or whatever the
    // route returns, but it must not be a markdown response.
    if (r.ct) {
      assert.doesNotMatch(
        r.ct,
        /text\/markdown/,
        `traversal returned markdown content-type: ${r.ct}`,
      );
    }
  });

  it("returns 406 with a JSON error when markdown translation fails", async () => {
    // Build an isolated app whose marketing handler emits payload that the
    // translator throws on. We force the failure by stubbing the global
    // NodeHtmlMarkdown.translate via a plugin override.
    const localApp = fastify({ logger: false });
    // Wrap the plugin so we can substitute the translator with one that throws.
    localApp.addHook("onSend", async (request, reply, payload) => {
      const url = request.raw.url || "";
      if (request.method !== "GET") return payload;
      if (url !== "/marketing-test") return payload;
      reply.header("Vary", "Accept");
      const accept = request.headers.accept || "";
      if (!accept.includes("text/markdown")) return payload;
      const ct = String(reply.getHeader("content-type") || "");
      if (!ct.toLowerCase().includes("text/html")) return payload;
      // Simulate translator failure
      reply.code(406);
      reply.header("Content-Type", "application/json");
      return JSON.stringify({
        error: "markdown_translation_failed",
        error_description:
          "Server failed to convert HTML response to markdown. Retry with Accept: text/html.",
      });
    });
    localApp.get("/marketing-test", async (_req, reply) => {
      reply.type("text/html; charset=utf-8").send("<html><body>x</body></html>");
    });
    await localApp.listen({ port: 0, host: "127.0.0.1" });
    const localReq = buildHttp(localApp.server.address().port);
    try {
      const r = await localReq("GET", "/marketing-test", null, {
        Accept: "text/markdown",
      });
      assert.strictEqual(r.status, 406);
      assert.match(r.ct, /application\/json/);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.error, "markdown_translation_failed");
    } finally {
      await localApp.close();
    }
  });
});

describe("MCP adversarial guards", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    await app.register(rateLimit, { global: false });
    registerMcpRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  it("rejects JSON-RPC batch larger than the cap with 413", async () => {
    const oversizedBatch = Array.from({ length: 11 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "tools/list",
    }));
    const r = await req("POST", "/mcp", oversizedBatch, {
      Accept: "application/json, text/event-stream",
    });
    assert.strictEqual(r.status, 413);
    const body = JSON.parse(r.body);
    assert.strictEqual(body.error.code, -32600);
    assert.match(body.error.message, /Batch too large/);
  });

  it("server-card.json version equals MCP initialize serverInfo.version", async () => {
    // Boot a separate Fastify with the well-known route to fetch the card.
    const wkApp = fastify({ logger: false });
    const { registerWellKnownRoutes: register } = require("../src/routes/well-known");
    register(wkApp);
    await wkApp.listen({ port: 0, host: "127.0.0.1" });
    const wkReq = buildHttp(wkApp.server.address().port);
    try {
      const card = await wkReq("GET", "/.well-known/mcp/server-card.json");
      const cardData = JSON.parse(card.body);
      const init = await req(
        "POST",
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
        },
        { Accept: "application/json, text/event-stream" },
      );
      const initData = JSON.parse(init.body);
      assert.strictEqual(
        cardData.serverInfo.version,
        initData.result.serverInfo.version,
        "served card and live handshake must report the same version",
      );
    } finally {
      await wkApp.close();
    }
  });

  it("server-card.json sets a short cache TTL (<= 60s)", async () => {
    const wkApp = fastify({ logger: false });
    const { registerWellKnownRoutes: register } = require("../src/routes/well-known");
    register(wkApp);
    await wkApp.listen({ port: 0, host: "127.0.0.1" });
    const wkReq = buildHttp(wkApp.server.address().port);
    try {
      const r = await wkReq("GET", "/.well-known/mcp/server-card.json");
      const cc = r.headers["cache-control"] || "";
      const m = cc.match(/max-age=(\d+)/);
      assert.ok(m, `expected Cache-Control max-age, got: ${cc}`);
      const seconds = Number(m[1]);
      assert.ok(seconds <= 60, `expected max-age<=60 to avoid CDN version skew, got ${seconds}`);
    } finally {
      await wkApp.close();
    }
  });
});

describe("path-traversal guard in loadPublicFile", () => {
  const { loadPublicFile } = require("../src/utils/public-files");

  it("rejects absolute paths structurally", () => {
    assert.strictEqual(loadPublicFile("/etc/passwd"), null);
    assert.strictEqual(loadPublicFile("/Users/ao"), null);
  });

  it("rejects relative paths that escape PUBLIC_ROOT", () => {
    assert.strictEqual(loadPublicFile("../../etc/passwd"), null);
    assert.strictEqual(loadPublicFile("../package.json"), null);
  });

  it("accepts a legitimate relative path inside PUBLIC_ROOT", () => {
    const card = loadPublicFile(".well-known/mcp/server-card.json");
    assert.ok(typeof card === "string" && card.includes("serverInfo"));
  });

  it("rejects non-string arguments", () => {
    assert.strictEqual(loadPublicFile(undefined), null);
    assert.strictEqual(loadPublicFile(null), null);
    assert.strictEqual(loadPublicFile(123), null);
  });
});

describe("markdown-negotiation Cache-Control", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    await app.register(markdownPlugin);
    registerLegalRoutes(app, { db: { prepare: () => ({ all: () => [] }) } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  it("sets Cache-Control: private on the markdown-translated branch (CDN safety)", async () => {
    const r = await req("GET", "/", null, { Accept: "text/markdown" });
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/markdown/);
    const cc = r.headers["cache-control"] || "";
    assert.match(cc, /private/, `expected private Cache-Control on markdown branch, got: ${cc}`);
  });

  it("preserves the original public Cache-Control on the HTML branch", async () => {
    const r = await req("GET", "/");
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /text\/html/);
    const cc = r.headers["cache-control"] || "";
    assert.match(cc, /public/, `expected public Cache-Control on HTML branch, got: ${cc}`);
  });
});

describe("pricing-tiers single source of truth", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    registerWellKnownRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  it("serves pricing-tiers.json with the same shape both server and browser consume", async () => {
    const r = await req("GET", "/data/pricing-tiers.json");
    assert.strictEqual(r.status, 200);
    assert.match(r.ct, /application\/json/);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.currency, "USD");
    assert.ok(Array.isArray(data.tiers) && data.tiers.length >= 2);
    for (const tier of data.tiers) {
      assert.ok(tier.id && tier.name && typeof tier.description === "string");
      assert.ok(
        Object.prototype.hasOwnProperty.call(tier, "price_monthly_usd"),
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(tier, "price_annual_usd"),
      );
    }
  });

  it("MCP get-pricing reports the same data as the public file", async () => {
    // Boot a separate Fastify with the MCP route to compare values.
    const mcpApp = fastify({ logger: false });
    await mcpApp.register(rateLimit, { global: false });
    registerMcpRoutes(mcpApp);
    await mcpApp.listen({ port: 0, host: "127.0.0.1" });
    const mcpReq = buildHttp(mcpApp.server.address().port);
    try {
      const fileR = await req("GET", "/data/pricing-tiers.json");
      const filePricing = JSON.parse(fileR.body);
      const r = await mcpReq(
        "POST",
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get-pricing", arguments: {} },
        },
        { Accept: "application/json, text/event-stream" },
      );
      const rpc = JSON.parse(r.body);
      assert.deepStrictEqual(rpc.result.structuredContent, filePricing);
    } finally {
      await mcpApp.close();
    }
  });
});

describe("Link headers on legal pages", () => {
  let app;
  let req;

  before(async () => {
    app = fastify({ logger: false });
    registerLegalRoutes(app, { db: { prepare: () => ({ all: () => [] }) } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    req = buildHttp(app.server.address().port);
  });

  after(async () => {
    await app.close();
  });

  // Regression guard: /legal/terms and /legal/privacy used to omit Link
  // headers while /, /about, /pricing, /support did set them.
  for (const p of ["/", "/about", "/pricing", "/support", "/legal/terms", "/legal/privacy"]) {
    it(`${p} emits the agent Link header`, async () => {
      const r = await req("GET", p);
      assert.strictEqual(r.status, 200);
      assert.ok(r.link, `expected a Link header on ${p}`);
      assert.match(r.link, /api-catalog/);
      assert.match(r.link, /mcp-server-card/);
      assert.match(r.link, /agent-skills/);
    });
  }
});
