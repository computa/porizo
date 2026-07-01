"use strict";

const fs = require("fs");
const path = require("path");

const ADMIN_STATIC_MIME_TYPES = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

function getAdminStaticContentType(filePath) {
  return (
    ADMIN_STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ||
    "application/octet-stream"
  );
}

async function sendAdminStaticFile(reply, rootDir, relativePath) {
  const resolvedPath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, resolvedPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return reply.code(403).type("text/plain").send("Forbidden");
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return reply.code(404).type("text/plain").send("Not Found");
  }
  const content = await fs.promises.readFile(resolvedPath);
  return reply
    .type(getAdminStaticContentType(resolvedPath))
    .header("Cache-Control", "public, max-age=14400")
    .send(content);
}

function registerAdminStaticUiRoutes(app, { requireAdminUiAccess }) {
  const adminIndexPath = path.join(process.cwd(), "public/admin/index.html");
  const adminStaticRoot = path.join(process.cwd(), "public/admin");

  app.get("/admin/assets/*", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    const assetPath = request.params["*"];
    return sendAdminStaticFile(
      reply,
      path.join(adminStaticRoot, "assets"),
      assetPath,
    );
  });

  app.get("/admin", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    const content = await fs.promises.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });

  app.get("/admin/*", async (request, reply) => {
    if (!(await requireAdminUiAccess(request, reply))) return;
    const relativePath = request.params["*"];
    if (relativePath) {
      const resolvedPath = path.resolve(adminStaticRoot, relativePath);
      const relativeToRoot = path.relative(adminStaticRoot, resolvedPath);
      if (
        !relativeToRoot.startsWith("..") &&
        !path.isAbsolute(relativeToRoot) &&
        fs.existsSync(resolvedPath) &&
        fs.statSync(resolvedPath).isFile()
      ) {
        return sendAdminStaticFile(reply, adminStaticRoot, relativePath);
      }
    }
    const content = await fs.promises.readFile(adminIndexPath, "utf8");
    return reply.type("text/html").send(content);
  });
}

module.exports = { registerAdminStaticUiRoutes };
