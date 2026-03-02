const fs = require("fs");
const path = require("path");
const config = require("../config");

// Load public pages at startup for performance
function loadPublicPage(relativePath) {
  const filePath = path.join(process.cwd(), "public", relativePath);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return null;
  }
}

const publicPages = {
  index: loadPublicPage("index.html"),
  support: loadPublicPage("support.html"),
  about: loadPublicPage("about.html"),
  pricing: loadPublicPage("pricing.html"),
  blog: loadPublicPage("blog/index.html"),
  terms: loadPublicPage("legal/terms.html"),
  privacy: loadPublicPage("legal/privacy.html"),
};

const fallbackPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Porizo</title></head><body><main><h1>Porizo</h1><p>Page unavailable.</p></main></body></html>`;

// Load binary files (favicon, apple-touch-icon)
function loadBinaryFile(relativePath) {
  const filePath = path.join(process.cwd(), "public", relativePath);
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    return null;
  }
}

const favicon = loadBinaryFile("favicon.ico");
const appleTouchIcon = loadBinaryFile("apple-touch-icon.png");

// Load SEO files
const robotsTxt = loadPublicPage("robots.txt");
const sitemapXml = loadPublicPage("sitemap.xml");
const llmsTxt = loadPublicPage("llms.txt");

const appStoreUrl =
  config.APP_STORE_URL || "https://apps.apple.com/app/porizo/id6758205028";
const playStoreUrl =
  config.PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.porizo.app";
const iosTestFlightUrl = config.IOS_TESTFLIGHT_URL || "";

function isIosUserAgent(request) {
  const userAgent = String(request.headers["user-agent"] || "").toLowerCase();
  return (
    userAgent.includes("iphone") ||
    userAgent.includes("ipad") ||
    userAgent.includes("ipod") ||
    (userAgent.includes("macintosh") && userAgent.includes("mobile"))
  );
}

function shouldUseTestFlight(request) {
  if (!iosTestFlightUrl) {
    return false;
  }
  const channel = String(request.query?.channel || "").toLowerCase();
  const explicitFlag = String(request.query?.testflight || "").toLowerCase();
  return (
    channel === "testflight" ||
    channel === "beta" ||
    explicitFlag === "1" ||
    explicitFlag === "true"
  );
}

function resolveDownloadUrl(request) {
  const requestedPlatform = String(request.query?.platform || "").toLowerCase();
  if (requestedPlatform === "android") {
    return playStoreUrl;
  }
  if (requestedPlatform === "ios") {
    if (shouldUseTestFlight(request)) {
      return iosTestFlightUrl;
    }
    return appStoreUrl;
  }

  const userAgent = String(request.headers["user-agent"] || "").toLowerCase();
  if (userAgent.includes("android")) {
    return playStoreUrl;
  }
  if (isIosUserAgent(request) && shouldUseTestFlight(request)) {
    return iosTestFlightUrl;
  }
  return appStoreUrl;
}

function decodeMaybe(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function resolveDeepLink(request) {
  const rawDeepLink = request.query?.deep_link;
  if (typeof rawDeepLink !== "string" || rawDeepLink.trim() === "") {
    return null;
  }
  const deepLink = decodeMaybe(rawDeepLink.trim());
  try {
    const parsed = new URL(deepLink);
    if (parsed.protocol !== "porizo:") {
      return null;
    }
  } catch (error) {
    return null;
  }
  return deepLink;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildDownloadBridgePage({ deepLink, fallbackUrl }) {
  const deepLinkJson = JSON.stringify(deepLink);
  const fallbackUrlJson = JSON.stringify(fallbackUrl);

  // Extract content type and shareId from deep link for context-aware copy + web fallback
  let contentKind = "song";
  let webFallbackUrl = null;
  try {
    const parsed = new URL(deepLink);
    const dlPath = parsed.pathname; // e.g. /play/<id> or /poem/<id>
    if (dlPath.startsWith("/poem/")) {
      contentKind = "poem";
      const shareId = dlPath.slice("/poem/".length);
      if (shareId) webFallbackUrl = `/poem/${encodeURIComponent(shareId)}?web=1`;
    } else if (dlPath.startsWith("/play/")) {
      contentKind = "song";
      const shareId = dlPath.slice("/play/".length);
      if (shareId) webFallbackUrl = `/play/${encodeURIComponent(shareId)}?web=1`;
    }
  } catch (_) { /* use defaults */ }

  const contentLabel = contentKind === "poem" ? "poem" : "song";
  const statusText = `If Porizo is installed, this ${contentLabel} opens automatically. Otherwise we will take you to install.`;
  const webFallbackHtml = webFallbackUrl
    ? `\n      <a href="${escapeHtml(webFallbackUrl)}" style="color: #8A8A8A; font-size: 13px; margin-top: 16px; display: inline-block;">Listen in browser instead</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Open Porizo</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0a;
      color: #f3f3f3;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: #111111;
      border: 1px solid #272727;
      border-radius: 16px;
      padding: 20px;
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 16px;
      color: #b9b9b9;
      line-height: 1.45;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    a {
      text-decoration: none;
      border-radius: 12px;
      padding: 12px 14px;
      font-weight: 600;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      border: 1px solid transparent;
    }
    .primary {
      background: #d8aa6f;
      color: #111111;
    }
    .secondary {
      border-color: #343434;
      color: #f3f3f3;
      background: transparent;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Opening in Porizo</h1>
    <p id="status">${escapeHtml(statusText)}</p>
    <div class="actions">
      <a id="open-app" class="primary" href="${escapeHtml(deepLink)}">Open App</a>
      <a id="fallback" class="secondary" href="${escapeHtml(fallbackUrl)}">Install App</a>
    </div>${webFallbackHtml}
  </main>
  <script>
    (function () {
      var deepLink = ${deepLinkJson};
      var fallbackUrl = ${fallbackUrlJson};
      var fallbackTimer = null;

      function cancelFallback() {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      }

      function startOpenFlow() {
        fallbackTimer = setTimeout(function () {
          window.location.replace(fallbackUrl);
        }, 1400);
        window.location.href = deepLink;
      }

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          cancelFallback();
        }
      });

      window.addEventListener("pagehide", cancelFallback);

      startOpenFlow();
    })();
  </script>
</body>
</html>`;
}

function registerLegalRoutes(app) {
  // SEO files
  app.get("/robots.txt", async (_request, reply) => {
    if (robotsTxt) {
      reply
        .type("text/plain")
        .header("Cache-Control", "public, max-age=86400")
        .send(robotsTxt);
    } else {
      reply.code(404).send();
    }
  });

  app.get("/sitemap.xml", async (_request, reply) => {
    if (sitemapXml) {
      reply
        .type("application/xml")
        .header("Cache-Control", "public, max-age=86400")
        .send(sitemapXml);
    } else {
      reply.code(404).send();
    }
  });

  app.get("/llms.txt", async (_request, reply) => {
    if (llmsTxt) {
      reply
        .type("text/plain")
        .header("Cache-Control", "public, max-age=86400")
        .send(llmsTxt);
    } else {
      reply.code(404).send();
    }
  });
  // Favicon
  app.get("/favicon.ico", async (_request, reply) => {
    if (favicon) {
      reply
        .type("image/x-icon")
        .header("Cache-Control", "public, max-age=86400")
        .send(favicon);
    } else {
      reply.code(404).send();
    }
  });

  // Apple touch icon
  app.get("/apple-touch-icon.png", async (_request, reply) => {
    if (appleTouchIcon) {
      reply
        .type("image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(appleTouchIcon);
    } else {
      reply.code(404).send();
    }
  });

  // Landing page
  app.get("/", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.index || fallbackPage);
  });

  // Support page
  app.get("/support", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.support || fallbackPage);
  });

  // About page
  app.get("/about", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.about || fallbackPage);
  });

  // Pricing page
  app.get("/pricing", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.pricing || fallbackPage);
  });

  // Blog page
  app.get("/blog", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.blog || fallbackPage);
  });

  // App download redirect helper for share flows
  app.get("/download", async (request, reply) => {
    const deepLink = resolveDeepLink(request);
    const fallbackUrl = resolveDownloadUrl(request);

    if (!deepLink) {
      return reply.redirect(fallbackUrl, 302);
    }

    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(buildDownloadBridgePage({ deepLink, fallbackUrl }));
  });

  // Legal pages
  app.get("/terms", async (_request, reply) => {
    reply.redirect(301, "/legal/terms");
  });

  app.get("/privacy", async (_request, reply) => {
    reply.redirect(301, "/legal/privacy");
  });

  app.get("/legal/terms", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.terms || fallbackPage);
  });

  app.get("/legal/privacy", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.privacy || fallbackPage);
  });
}

module.exports = { registerLegalRoutes };
