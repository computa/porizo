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

function registerLegalRoutes(app) {
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
