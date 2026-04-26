const fp = require("fastify-plugin");
const { NodeHtmlMarkdown } = require("node-html-markdown");

// Routes that may emit text/markdown when an agent asks for it. Anything
// outside this list passes through untouched — admin, web-player,
// poem-viewer, embed-player, /download, /api/* must not be transformed.
const MARKDOWN_ALLOWLIST = [
  /^\/$/,
  /^\/about\/?$/,
  /^\/pricing\/?$/,
  /^\/support\/?$/,
  /^\/legal(\/|$)/,
  /^\/blog(\/|$)/,
];

function isAllowlisted(url) {
  if (!url) return false;
  const path = url.split("?")[0];
  return MARKDOWN_ALLOWLIST.some((re) => re.test(path));
}

function clientWantsMarkdown(accept) {
  if (!accept) return false;
  return accept.toLowerCase().includes("text/markdown");
}

const translator = new NodeHtmlMarkdown({
  ignore: ["script", "style", "noscript"],
});

async function markdownNegotiation(app) {
  app.addHook("onSend", async (request, reply, payload) => {
    if (!isAllowlisted(request.raw.url)) return payload;

    // Always advertise that the response varies by Accept so CDN/edge caches
    // do not serve the wrong representation.
    reply.header("Vary", "Accept");

    if (!clientWantsMarkdown(request.headers.accept)) return payload;

    const contentType = String(reply.getHeader("content-type") || "");
    if (!contentType.toLowerCase().includes("text/html")) return payload;

    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) {
      // Streams pass through unchanged — never call .toString() on a stream.
      return payload;
    }

    try {
      const html = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
      const markdown = translator.translate(html);
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      return markdown;
    } catch (err) {
      request.log.warn({ err, url: request.raw.url }, "markdown translation failed");
      return payload;
    }
  });
}

module.exports = fp(markdownNegotiation, {
  name: "markdown-negotiation",
  fastify: "4.x",
});
