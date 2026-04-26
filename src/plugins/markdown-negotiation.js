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
    // Cheapest checks first — this hook fires on every response.
    if (request.method !== "GET") return payload;
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
      // Force `private` so a CDN can't cache the markdown variant under a key
      // a permissive Vary normalization would later serve to an HTML-asking
      // client. The handler's original Cache-Control (public, max-age=300)
      // applies fine to the HTML branch; this overrides it on the rewritten
      // markdown response.
      reply.header("Cache-Control", "private, max-age=0, must-revalidate");
      return markdown;
    } catch (err) {
      // Translation should not fail on the marketing pages we control, so a
      // failure is unusual enough to log at error. We refuse the response
      // (RFC 7231 §6.5.6 — 406 Not Acceptable) rather than serving HTML to a
      // client that explicitly asked for markdown — silently downgrading the
      // representation would mislead an agent into parsing HTML it didn't
      // request.
      request.log.error({ err, url: request.raw.url }, "markdown translation failed");
      reply.code(406);
      reply.header("Content-Type", "application/json");
      return JSON.stringify({
        error: "markdown_translation_failed",
        error_description:
          "Server failed to convert HTML response to markdown. Retry with Accept: text/html.",
      });
    }
  });
}

module.exports = fp(markdownNegotiation, {
  name: "markdown-negotiation",
  fastify: "4.x",
});
