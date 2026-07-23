const fs = require("fs");
const path = require("path");
const fastify = require("fastify");
const {
  APPLE_APP_SITE_ASSOCIATION,
} = require("../utils/apple-app-site-association");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function createFastifyApp() {
  return fastify({
    logger: true,
    bodyLimit: 1048576, // 1MB max body size to prevent JSON DoS
    trustProxy: true, // Railway reverse proxy — read X-Forwarded-For for real client IP
  });
}

function registerFormUrlEncodedParser(app) {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        const params = new URLSearchParams(body);
        const parsed = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err);
      }
    },
  );
}

function registerWebFunnel(
  app,
  {
    webFunnelRoot = path.join(PROJECT_ROOT, "web-funnel", "dist"),
    requireWebFunnelBuild = false,
  } = {},
) {
  const shellPath = path.join(webFunnelRoot, "index.html");
  if (!fs.existsSync(shellPath)) {
    if (requireWebFunnelBuild) {
      throw new Error(
        `Web funnel build is missing at ${shellPath}. Run npm run web-funnel:build before starting the server.`,
      );
    }
    return;
  }

  const shell = fs.readFileSync(shellPath);
  const sendShell = async (_request, reply) =>
    reply
      .header("Cache-Control", "public, max-age=0, must-revalidate")
      .type("text/html; charset=utf-8")
      .send(shell);

  for (const route of [
    "/create",
    "/create/",
    "/create/success",
    "/create/success/",
    // The Etsy fulfilment landing shares the funnel SPA shell; the bundle
    // routes on pathname to render the landing instead of the /create funnel.
    "/etsy",
    "/etsy/",
  ]) {
    app.get(route, sendShell);
  }

  app.register(require("@fastify/static"), {
    root: webFunnelRoot,
    prefix: "/create/",
    decorateReply: false,
    index: false,
    wildcard: false,
    setHeaders(response, filePath) {
      const relativePath = path.relative(webFunnelRoot, filePath);
      const normalizedPath = relativePath.split(path.sep).join("/");
      const isFingerprintedAsset =
        normalizedPath.startsWith("assets/") &&
        /-[a-zA-Z0-9_-]{8,}\.[^.]+$/.test(normalizedPath);

      response.setHeader(
        "Cache-Control",
        isFingerprintedAsset
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300, must-revalidate",
      );
    },
  });
}

function registerStaticFileServing(
  app,
  { enableDebugRoutes, webFunnelRoot, requireWebFunnelBuild = false },
) {
  // Debug pages are an explicit allowlist. Mounting the whole public directory
  // here either creates a root wildcard or duplicates routes owned by the
  // landing/legal plugins (for example /apple-touch-icon.png).
  if (enableDebugRoutes) {
    const publicRoot = path.join(PROJECT_ROOT, "public");
    app.register(require("@fastify/static"), {
      root: publicRoot,
      serve: false,
    });
    for (const [route, fileName] of [
      ["/debug.html", "debug.html"],
      ["/debug.js", "debug.js"],
      ["/debug-og.html", "debug-og.html"],
      ["/debug-story.html", "debug-story.html"],
    ]) {
      app.get(route, async (_request, reply) => reply.sendFile(fileName));
    }
  }

  registerWebFunnel(app, { webFunnelRoot, requireWebFunnelBuild });

  // Register web-player static files
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "web-player"),
    prefix: "/web-player/",
    decorateReply: false, // Avoid decorator conflict with first registration
  });

  // Register poem-viewer static files
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "poem-viewer"),
    prefix: "/poem-viewer/",
    decorateReply: false,
  });

  // Register embed-player static files
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "embed-player"),
    prefix: "/embed-player/",
    decorateReply: false,
  });

  // Register public assets for landing page (CSS, images, favicon)
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "public/styles"),
    prefix: "/styles/",
    decorateReply: false,
  });
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "public/assets"),
    prefix: "/assets/",
    decorateReply: false,
  });
  app.register(require("@fastify/static"), {
    root: path.join(PROJECT_ROOT, "public/audio"),
    prefix: "/audio/",
    decorateReply: false,
    maxAge: "7d",
  });
}

function registerAppleAppSiteAssociation(app) {
  // Apple App Site Association for universal links (explicit route for correct MIME type)
  const aasaJson = JSON.stringify(APPLE_APP_SITE_ASSOCIATION);
  app.get("/.well-known/apple-app-site-association", async (request, reply) => {
    return reply.type("application/json").send(aasaJson);
  });
}

function registerCoreHttpPlugins(app) {
  // DB-07: CORS — allow same-origin + configured origins
  if (!process.env.CORS_ORIGIN && process.env.NODE_ENV === "production") {
    throw new Error(
      "[SecurityGuard:CORS] CORS_ORIGIN must be set in production. Server cannot start with unrestricted CORS. Set CORS_ORIGIN to a comma-separated list of allowed origins.",
    );
  }
  app.register(require("@fastify/cors"), {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : false,
    credentials: true,
  });

  // DB-08: Security headers via Helmet
  app.register(require("@fastify/helmet"), {
    contentSecurityPolicy: false, // CSP managed separately for HTML pages
    // Helmet's default `Cross-Origin-Resource-Policy: same-origin` triggers
    // Chrome's ORB (Opaque Response Blocking) for external stylesheets and
    // fonts loaded cross-origin (e.g., Google Fonts for the landing site),
    // so headings were silently falling back to Georgia / Times. Relax to
    // `cross-origin` — typical for marketing + API, still safe given no
    // embedded credentialed APIs.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // Register multipart for file uploads
  app.register(require("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  });

  // Rate limiting (used by /mcp; opt-in via route config.rateLimit).
  app.register(require("@fastify/rate-limit"), {
    global: false,
  });

  // Markdown content negotiation for marketing pages (Accept: text/markdown).
  app.register(require("./markdown-negotiation"));
}

function registerAudioBodyParser(app) {
  app.addContentTypeParser(
    ["audio/wav", "application/octet-stream"],
    { parseAs: "buffer" },
    (request, body, done) => {
      done(null, body);
    },
  );
}

function registerStaticAndSecurityBootstrap(
  app,
  { enableDebugRoutes, webFunnelRoot, requireWebFunnelBuild = false },
) {
  registerStaticFileServing(app, {
    enableDebugRoutes,
    webFunnelRoot,
    requireWebFunnelBuild,
  });
  registerAppleAppSiteAssociation(app);
  registerCoreHttpPlugins(app);
  registerAudioBodyParser(app);
}

module.exports = {
  createFastifyApp,
  registerAudioBodyParser,
  registerCoreHttpPlugins,
  registerFormUrlEncodedParser,
  registerStaticAndSecurityBootstrap,
  registerStaticFileServing,
  registerWebFunnel,
  registerAppleAppSiteAssociation,
};
