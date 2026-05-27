"use strict";

const { BlogService } = require("../services/blog-service");
const {
  renderBlogIndexPage,
  renderBlogPostPage,
} = require("../services/blog-render-service");

function registerBlogRoutes(app, { db, config = {} }) {
  const blogService = new BlogService(db);
  // SEO canonical host = apex porizo.co (matches sitemap + static pages), NOT
  // PUBLIC_BASE_URL (api.porizo.co) — that's the API/app host for share/email links.
  const siteOrigin = (config.CANONICAL_BASE_URL || "https://porizo.co").replace(
    /\/+$/,
    "",
  );

  app.get("/blog", async (_request, reply) => {
    const posts = await blogService.listPublishedPosts({ limit: 100 });
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(renderBlogIndexPage(posts, { siteOrigin }));
  });

  app.get("/blog/:slug", async (request, reply) => {
    const post = await blogService.getPublishedPostBySlug(request.params.slug);
    if (!post) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send("<h1>Not found</h1>");
    }
    // Sibling posts power the "Related reads" internal-link block.
    const allPosts = await blogService.listPublishedPosts({ limit: 100 });
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(renderBlogPostPage(post, { siteOrigin, allPosts }));
  });
}

module.exports = { registerBlogRoutes };
