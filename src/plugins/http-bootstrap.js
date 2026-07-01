const path = require("path");
const fastify = require("fastify");

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

function registerStaticFileServing(app, { enableDebugRoutes }) {
  // Register static file serving for debug page (guarded)
  if (enableDebugRoutes) {
    app.register(require("@fastify/static"), {
      root: path.join(PROJECT_ROOT, "public"),
      prefix: "/",
    });
  }

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
  const aasaJson = JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appID: "5VCH6937XM.com.porizo.PorizoApp",
          paths: ["/play/*", "/s/*", "/poem/*"],
        },
      ],
    },
  });
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

function registerStaticAndSecurityBootstrap(app, { enableDebugRoutes }) {
  registerStaticFileServing(app, { enableDebugRoutes });
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
  registerAppleAppSiteAssociation,
};
