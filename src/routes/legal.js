const fs = require("fs");
const path = require("path");

const legalPages = {
  terms: loadLegalPage("terms"),
  privacy: loadLegalPage("privacy"),
};

function loadLegalPage(slug) {
  const filePath = path.join(process.cwd(), "public", "legal", `${slug}.html`);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Porizo Legal</title></head><body><main><h1>Porizo Legal</h1><p>Legal page unavailable.</p></main></body></html>`;
  }
}

function registerLegalRoutes(app) {
  app.get("/legal/terms", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(legalPages.terms);
  });

  app.get("/legal/privacy", async (_request, reply) => {
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(legalPages.privacy);
  });
}

module.exports = { registerLegalRoutes };
