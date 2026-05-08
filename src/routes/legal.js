const config = require("../config");
const geoip = require("geoip-lite");
const { generatePrefixedId } = require("../utils/ids");
const { loadPublicFile } = require("../utils/public-files");

const publicPages = {
  index: loadPublicFile("index.html", { warnOnMissing: true }),
  support: loadPublicFile("support.html", { warnOnMissing: true }),
  about: loadPublicFile("about.html", { warnOnMissing: true }),
  pricing: loadPublicFile("pricing.html", { warnOnMissing: true }),
  mothersDaySong: loadPublicFile("mothers-day-song.html", {
    warnOnMissing: true,
  }),
  birthdaySongMaker: loadPublicFile("birthday-song-maker.html", {
    warnOnMissing: true,
  }),
  anniversarySongGift: loadPublicFile("anniversary-song-gift.html", {
    warnOnMissing: true,
  }),
  customSongGift: loadPublicFile("custom-song-gift.html", {
    warnOnMissing: true,
  }),
  songfinchAlternative: loadPublicFile("songfinch-alternative.html", {
    warnOnMissing: true,
  }),
  songInYourVoice: loadPublicFile("song-in-your-voice.html", {
    warnOnMissing: true,
  }),
  birthdaySongForMom: loadPublicFile("birthday-song-for-mom.html", {
    warnOnMissing: true,
  }),
  birthdaySongForDad: loadPublicFile("birthday-song-for-dad.html", {
    warnOnMissing: true,
  }),
  fathersDaySong: loadPublicFile("fathers-day-song.html", {
    warnOnMissing: true,
  }),
  graduationSong: loadPublicFile("graduation-song.html", {
    warnOnMissing: true,
  }),
  weddingSongGift: loadPublicFile("wedding-song-gift.html", {
    warnOnMissing: true,
  }),
  terms: loadPublicFile("legal/terms.html", { warnOnMissing: true }),
  privacy: loadPublicFile("legal/privacy.html", { warnOnMissing: true }),
};

const fallbackPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Porizo</title></head><body><main><h1>Porizo</h1><p>Page unavailable.</p></main></body></html>`;

const favicon = loadPublicFile("favicon.ico", {
  encoding: null,
  warnOnMissing: true,
});
const appleTouchIcon = loadPublicFile("apple-touch-icon.png", {
  encoding: null,
  warnOnMissing: true,
});

// Load SEO files
const robotsTxt = loadPublicFile("robots.txt", { warnOnMissing: true });
const sitemapXml = loadPublicFile("sitemap.xml", { warnOnMissing: true });
const llmsTxt = loadPublicFile("llms.txt", { warnOnMissing: true });

// IndexNow key — same value lives in the filename and the body, per the
// IndexNow spec. Bing/Yandex/Naver fetch /<key>.txt to verify ownership
// before accepting URL submissions.
const INDEXNOW_KEY = "dc6dd831f7b4b07b46d4b1f15bff6e3b";
const indexNowKeyFile = loadPublicFile(`${INDEXNOW_KEY}.txt`, {
  warnOnMissing: true,
});

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

function decodeMaybe(value, log) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    if (log)
      log.debug(
        { err, raw: value },
        "decodeMaybe: malformed percent-encoding, using raw value",
      );
    return value;
  }
}

function resolveDeepLink(request) {
  const rawDeepLink = request.query?.deep_link;
  if (typeof rawDeepLink !== "string" || rawDeepLink.trim() === "") {
    return null;
  }
  const deepLink = decodeMaybe(rawDeepLink.trim(), request.log);
  try {
    const parsed = new URL(deepLink);
    if (parsed.protocol !== "porizo:") {
      request.log?.debug(
        { deepLink, protocol: parsed.protocol },
        "resolveDeepLink: rejected non-porizo: protocol",
      );
      return null;
    }
  } catch (err) {
    request.log?.debug(
      { err, rawDeepLink },
      "resolveDeepLink: URL parse failed",
    );
    return null;
  }
  return deepLink;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSitemapLastmod(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  if (isoDate) {
    return isoDate[1];
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

async function withDynamicBlogEntries(sitemap, db) {
  if (!db || !sitemap || !sitemap.includes("</urlset>")) {
    return sitemap;
  }

  try {
    const posts = await db
      .prepare(
        `
      SELECT slug, published_at, updated_at
      FROM blog_posts
      WHERE status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
    `,
      )
      .all();

    if (!Array.isArray(posts) || posts.length === 0) {
      return sitemap;
    }

    const entries = posts
      .map((post) => {
        const lastmod = post.updated_at || post.published_at;
        const lastmodDate = formatSitemapLastmod(lastmod);
        return [
          "  <url>",
          `    <loc>https://porizo.co/blog/${escapeHtml(post.slug)}</loc>`,
          lastmodDate
            ? `    <lastmod>${escapeHtml(lastmodDate)}</lastmod>`
            : null,
          "    <priority>0.6</priority>",
          "  </url>",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");

    return sitemap.replace("</urlset>", `${entries}\n</urlset>`);
  } catch (err) {
    // DB read failed — serve the static sitemap so SEO survives, but log so
    // the regression is visible (the silent fallback used to mask schema drift).
    console.warn(
      `[legal] withDynamicBlogEntries DB read failed: ${err.message}`,
    );
    return sitemap;
  }
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
      if (shareId)
        webFallbackUrl = `/poem/${encodeURIComponent(shareId)}?web=1`;
    } else if (dlPath.startsWith("/play/")) {
      contentKind = "song";
      const shareId = dlPath.slice("/play/".length);
      if (shareId)
        webFallbackUrl = `/play/${encodeURIComponent(shareId)}?web=1`;
    }
  } catch (_) {
    /* use defaults */
  }

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
        }, 2500);
        window.location.href = deepLink;
      }

      // Cancel fallback when app opens (page becomes hidden)
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          cancelFallback();
        }
      });

      window.addEventListener("pagehide", cancelFallback);

      // Cancel fallback when iOS shows the "Open in app?" confirmation dialog
      // The dialog steals focus from the page, firing blur before the user taps
      window.addEventListener("blur", cancelFallback);

      startOpenFlow();
    })();
  </script>
</body>
</html>`;
}

function logDownloadEvent(db, request) {
  const ip = request.ip || "unknown";
  const ua = request.headers["user-agent"] || null;
  const q = request.query || {};
  const geo = geoip.lookup(ip);
  const country = geo ? geo.country : null;
  const id = generatePrefixedId("dl");

  // better-sqlite3 .run() is synchronous and throws — the prior `.catch()`
  // was dead code. A logging-only insert must never crash the route.
  try {
    db.prepare(
      `INSERT INTO download_events (id, ip_address, user_agent, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ip,
      ua,
      q.utm_source || null,
      q.utm_medium || null,
      q.utm_campaign || null,
      q.utm_content || null,
      q.utm_term || null,
      country,
      q.ref || request.headers.referer || null,
      new Date().toISOString(),
    );
  } catch (err) {
    request.log
      ? request.log.warn({ err }, "download event log failed")
      : console.warn(`[legal] download event log failed: ${err.message}`);
  }
}

// RFC 8288 Link relations for AI agent discovery on marketing pages.
// Comma-joined per RFC 8288 §3 (multiple values in one Link header are
// equivalent to multiple Link headers).
const AGENT_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</.well-known/mcp/server-card.json>; rel="mcp-server-card"',
  '</.well-known/agent-skills/index.json>; rel="agent-skills"',
  '</llms.txt>; rel="llms"',
  '</sitemap.xml>; rel="sitemap"',
].join(", ");

function registerLegalRoutes(app, { db } = {}) {
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
      const dynamicSitemap = await withDynamicBlogEntries(sitemapXml, db);
      reply
        .type("application/xml")
        .header("Cache-Control", "public, max-age=86400")
        .send(dynamicSitemap);
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

  // IndexNow key verification endpoint. Bing, Yandex, Naver, and Seznam
  // GET /<key>.txt to verify the domain owns the key before accepting URL
  // submissions sent to https://api.indexnow.org/indexnow.
  app.get(`/${INDEXNOW_KEY}.txt`, async (_request, reply) => {
    if (indexNowKeyFile) {
      reply
        .type("text/plain")
        .header("Cache-Control", "public, max-age=86400")
        .send(indexNowKeyFile);
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

  // Helper: every marketing/legal page sends the same shape — HTML body,
  // 5-min cache, agent Link header for discovery. Centralizing it means a new
  // page can't accidentally ship without the Link header (which is exactly
  // the regression that hit /legal/terms + /legal/privacy initially).
  function respondMarketingHtml(reply, body) {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .header("Link", AGENT_LINK_HEADER)
      .send(body || fallbackPage);
  }

  // Landing page
  app.get("/", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.index),
  );

  // Support page
  app.get("/support", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.support),
  );

  // About page
  app.get("/about", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.about),
  );

  // Pricing page
  app.get("/pricing", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.pricing),
  );

  // High-intent occasion landing pages for App Store + web acquisition.
  app.get("/mothers-day-song", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.mothersDaySong),
  );
  app.get("/birthday-song-maker", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.birthdaySongMaker),
  );
  app.get("/anniversary-song-gift", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.anniversarySongGift),
  );
  app.get("/custom-song-gift", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.customSongGift),
  );

  // SEO long-tail and competitor brand-defense pages.
  app.get("/songfinch-alternative", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.songfinchAlternative),
  );
  app.get("/song-in-your-voice", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.songInYourVoice),
  );
  app.get("/birthday-song-for-mom", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.birthdaySongForMom),
  );
  app.get("/birthday-song-for-dad", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.birthdaySongForDad),
  );
  app.get("/fathers-day-song", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.fathersDaySong),
  );
  app.get("/graduation-song", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.graduationSong),
  );
  app.get("/wedding-song-gift", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.weddingSongGift),
  );

  // App download redirect helper for share flows
  app.get("/download", async (request, reply) => {
    // Log download event for attribution tracking (non-blocking)
    if (db) {
      logDownloadEvent(db, request);
    }

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

  app.get("/legal/terms", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.terms),
  );

  app.get("/legal/privacy", async (_request, reply) =>
    respondMarketingHtml(reply, publicPages.privacy),
  );
}

module.exports = { registerLegalRoutes, formatSitemapLastmod };
