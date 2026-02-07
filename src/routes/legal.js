const fs = require("fs");
const path = require("path");

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

  // Blog page
  app.get("/blog", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(publicPages.blog || fallbackPage);
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
