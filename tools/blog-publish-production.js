#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { Client } = require("pg");

const DEFAULT_API_BASE_URL = process.env.API_BASE_URL || process.env.PORIZO_API_BASE_URL || "https://api.porizo.co";
const DEFAULT_SITE_BASE_URL = process.env.SITE_BASE_URL || "https://porizo.co";
const DEFAULT_SESSION_FILE = process.env.BLOG_ADMIN_SESSION_FILE || "/tmp/porizo-blog-admin-session.json";
const DEFAULT_RAILWAY_SERVICE = process.env.RAILWAY_SERVICE || "porizo";
const INTERNAL_LINK_PATTERN = /^(\/|https?:\/\/(?:www\.)?porizo\.co\b|https?:\/\/api\.porizo\.co\b)/i;

function usage() {
  return `
Usage:
  node tools/blog-publish-production.js login [--api-base-url URL] [--session-file PATH]
  node tools/blog-publish-production.js inspect [--slug SLUG] [--title TITLE] [--search TEXT] [--limit N]
  node tools/blog-publish-production.js publish [options]

Publish options:
  --article-file PATH          Read article body from file instead of stdin
  --intent MODE                Publish intent: safe-publish or full-auto-publish (default safe-publish)
  --title TEXT                 Manual title override
  --slug SLUG                  Manual slug override
  --excerpt TEXT               Manual excerpt override
  --answer-summary TEXT        Manual answer summary override
  --target-query TEXT          Manual target query override
  --target-intent TEXT         Manual target intent override
  --primary-keyword TEXT       Manual primary keyword override
  --hero-image-url URL         Manual hero image URL override
  --author TEXT                Manual author name override
  --tags "a,b,c"               Manual comma-separated tags
  --post-id ID                 Force update of an existing post
  --replace-link OLD=NEW       Replace a URL inside markdown before save (repeatable)
  --refresh-metadata           Overwrite metadata with autofill instead of filling blanks only
  --allow-suspicious-links     Do not block publish flow on suspicious imported links
  --max-repair-passes N        Max repair loops before aborting (default 2)
  --dry-run                    Stop after review/repair; do not publish
  --railway-remote             Use Railway remote production mode when CMS auth is unavailable
  --railway-service NAME       Railway service name (default ${DEFAULT_RAILWAY_SERVICE})
  --allow-remote-repair        Allow AI repair passes in Railway remote mode
  --skip-editorial-llm         Skip editorial LLM review and use deterministic-only editorial status
  --api-base-url URL           API origin (default ${DEFAULT_API_BASE_URL})
  --site-base-url URL          Public site origin (default ${DEFAULT_SITE_BASE_URL})
  --session-file PATH          Session file (default ${DEFAULT_SESSION_FILE})

Required environment for login/session bootstrap:
  ADMIN_EMAIL
  ADMIN_PASSWORD

Optional environment for inspect:
  DATABASE_URL
`.trim();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "publish";
  const options = {
    replaceLinks: [],
    apiBaseUrl: DEFAULT_API_BASE_URL,
    siteBaseUrl: DEFAULT_SITE_BASE_URL,
    sessionFile: DEFAULT_SESSION_FILE,
    railwayService: DEFAULT_RAILWAY_SERVICE,
    intent: "safe-publish",
    maxRepairPasses: 2,
    limit: 20,
    railwayRemote: false,
    allowRemoteRepair: false,
    skipEditorialLlm: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    const consumeValue = () => {
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      index += 1;
      return next;
    };

    switch (key) {
      case "help":
        options.help = true;
        break;
      case "article-file":
        options.articleFile = consumeValue();
        break;
      case "intent":
        options.intent = consumeValue();
        break;
      case "title":
        options.title = consumeValue();
        break;
      case "slug":
        options.slug = consumeValue();
        break;
      case "excerpt":
        options.excerpt = consumeValue();
        break;
      case "answer-summary":
        options.answerSummary = consumeValue();
        break;
      case "target-query":
        options.targetQuery = consumeValue();
        break;
      case "target-intent":
        options.targetIntent = consumeValue();
        break;
      case "primary-keyword":
        options.primaryKeyword = consumeValue();
        break;
      case "hero-image-url":
        options.heroImageUrl = consumeValue();
        break;
      case "author":
        options.author = consumeValue();
        break;
      case "tags":
        options.tags = consumeValue();
        break;
      case "post-id":
        options.postId = consumeValue();
        break;
      case "replace-link":
        options.replaceLinks.push(parseLinkReplacement(consumeValue()));
        break;
      case "refresh-metadata":
        options.refreshMetadata = true;
        break;
      case "allow-suspicious-links":
        options.allowSuspiciousLinks = true;
        break;
      case "max-repair-passes":
        options.maxRepairPasses = Number.parseInt(consumeValue(), 10);
        break;
      case "dry-run":
        options.dryRun = true;
        break;
      case "railway-remote":
        options.railwayRemote = true;
        break;
      case "railway-service":
        options.railwayService = consumeValue();
        break;
      case "allow-remote-repair":
        options.allowRemoteRepair = true;
        break;
      case "skip-editorial-llm":
        options.skipEditorialLlm = true;
        break;
      case "api-base-url":
        options.apiBaseUrl = consumeValue();
        break;
      case "site-base-url":
        options.siteBaseUrl = consumeValue();
        break;
      case "session-file":
        options.sessionFile = consumeValue();
        break;
      case "search":
        options.search = consumeValue();
        break;
      case "limit":
        options.limit = Number.parseInt(consumeValue(), 10);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return { command, options };
}

function normalizeIntentOptions(options) {
  const intent = String(options.intent || "safe-publish").trim();
  if (!["safe-publish", "full-auto-publish"].includes(intent)) {
    throw new Error(`Invalid --intent "${intent}". Use safe-publish or full-auto-publish.`);
  }

  const normalized = { ...options, intent };
  if (intent === "safe-publish") {
    normalized.allowRemoteRepair = Boolean(options.allowRemoteRepair);
    normalized.skipEditorialLlm = true;
    return normalized;
  }

  normalized.allowRemoteRepair = true;
  normalized.skipEditorialLlm = Boolean(options.skipEditorialLlm);
  return normalized;
}

function parseLinkReplacement(value) {
  const eqIndex = value.indexOf("=");
  if (eqIndex === -1) {
    throw new Error(`Invalid --replace-link value "${value}". Use OLD=NEW.`);
  }
  const from = value.slice(0, eqIndex).trim();
  const to = value.slice(eqIndex + 1).trim();
  if (!from || !to) {
    throw new Error(`Invalid --replace-link value "${value}". Use OLD=NEW.`);
  }
  return { from, to };
}

function logStep(message) {
  process.stdout.write(`${message}\n`);
}

function normalizeWhitespace(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function parseTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeMissingMetadata(current, inferred, { overwrite = false } = {}) {
  return {
    ...current,
    title: overwrite || !current.title ? inferred.title || current.title : current.title,
    slug: overwrite || !current.slug ? inferred.slug || current.slug : current.slug,
    excerpt: overwrite || !current.excerpt ? inferred.excerpt || current.excerpt : current.excerpt,
    answer_summary:
      overwrite || !current.answer_summary
        ? inferred.answer_summary || current.answer_summary
        : current.answer_summary,
    target_query:
      overwrite || !current.target_query ? inferred.target_query || current.target_query : current.target_query,
    target_intent:
      overwrite || !current.target_intent
        ? inferred.target_intent || current.target_intent
        : current.target_intent,
    primary_keyword:
      overwrite || !current.primary_keyword
        ? inferred.primary_keyword || current.primary_keyword
        : current.primary_keyword,
    tags:
      overwrite || !Array.isArray(current.tags) || current.tags.length === 0
        ? Array.isArray(inferred.tags) && inferred.tags.length > 0 ? inferred.tags : current.tags
        : current.tags,
  };
}

function isInternalLink(url) {
  return INTERNAL_LINK_PATTERN.test(String(url || ""));
}

function extractMarkdownLinks(markdown) {
  return Array.from(String(markdown || "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map((match) => {
    const label = String(match[1] || "").trim();
    const url = String(match[2] || "").trim();
    const isInternal = isInternalLink(url);
    const isExternal = /^https?:\/\//i.test(url) && !isInternal;
    const isSuspicious = /porizo/i.test(label) && !isInternal;
    return { label, url, isInternal, isExternal, isSuspicious };
  });
}

function applyLinkReplacements(markdown, replacements) {
  return replacements.reduce((current, replacement) => current.split(replacement.from).join(replacement.to), markdown);
}

async function readArticleBody(articleFile) {
  if (articleFile) {
    return fs.readFileSync(path.resolve(articleFile), "utf8");
  }
  if (process.stdin.isTTY) {
    return "";
  }
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseArticlePack(raw) {
  const source = String(raw || "");
  const requiredLabels = [
    "TITLE",
    "SLUG",
    "AUTHOR",
    "EXCERPT",
    "TARGET_QUERY",
    "PRIMARY_KEYWORD",
    "HERO_IMAGE",
    "ARTICLE CONTENT",
  ];
  if (!/^TITLE:\s*$/m.test(source) || !/^ARTICLE CONTENT:\s*$/m.test(source)) {
    return null;
  }

  const values = {};
  for (let index = 0; index < requiredLabels.length; index += 1) {
    const label = requiredLabels[index];
    const startPattern = new RegExp(`^${label}:\\s*$`, "m");
    const startMatch = source.match(startPattern);
    if (!startMatch) return null;
    const start = startMatch.index + startMatch[0].length;
    let end = source.length;
    for (let nextIndex = index + 1; nextIndex < requiredLabels.length; nextIndex += 1) {
      const nextPattern = new RegExp(`^${requiredLabels[nextIndex]}:\\s*$`, "m");
      const nextMatch = source.slice(start).match(nextPattern);
      if (nextMatch) {
        end = Math.min(end, start + nextMatch.index);
      }
    }
    values[label] = source.slice(start, end).trim();
  }

  return {
    title: values.TITLE || "",
    slug: values.SLUG || "",
    author_name: values.AUTHOR || "",
    excerpt: values.EXCERPT || "",
    answer_summary: values.EXCERPT || "",
    target_query: values.TARGET_QUERY || "",
    primary_keyword: values.PRIMARY_KEYWORD || "",
    hero_image_url: values.HERO_IMAGE || "",
    body_markdown: values["ARTICLE CONTENT"] || "",
  };
}

async function requestJson(baseUrl, pathname, { method = "GET", token, body } = {}) {
  const url = new URL(pathname, baseUrl).toString();
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const message =
      parsed?.message ||
      parsed?.error ||
      text ||
      `${method} ${pathname} failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }
  return parsed;
}

async function loginAndStoreSession({ apiBaseUrl, sessionFile }) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for admin login.");
  }
  const result = await requestJson(apiBaseUrl, "/admin/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const session = {
    api_base_url: apiBaseUrl,
    token: result.token,
    admin: result.admin,
    expires_at: result.expiresAt,
    saved_at: new Date().toISOString(),
  };
  fs.writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return session;
}

async function getSession({ apiBaseUrl, sessionFile }) {
  const resolved = path.resolve(sessionFile);
  if (fs.existsSync(resolved)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resolved, "utf8"));
      if (saved?.token) {
        await requestJson(apiBaseUrl, "/admin/auth/me", { token: saved.token });
        return saved;
      }
    } catch {
      // Fall through to fresh login.
    }
  }
  return loginAndStoreSession({ apiBaseUrl, sessionFile: resolved });
}

async function inspectBlogPosts({ slug, title, search, limit = 20 }) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for inspect mode.");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const filters = [];
    const values = [];
    let index = 1;

    if (slug) {
      filters.push(`slug = $${index}`);
      values.push(slug);
      index += 1;
    }
    if (title) {
      filters.push(`title ILIKE $${index}`);
      values.push(`%${title}%`);
      index += 1;
    }
    if (search) {
      filters.push(`(title ILIKE $${index} OR slug ILIKE $${index} OR body_markdown ILIKE $${index})`);
      values.push(`%${search}%`);
      index += 1;
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" OR ")}` : "";
    const sql = `
      SELECT id, title, slug, status, review_status, published_at, updated_at
      FROM blog_posts
      ${where}
      ORDER BY COALESCE(published_at, updated_at) DESC
      LIMIT ${Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 20}
    `;
    const result = await client.query(sql, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
}

function runRailwayShell(service, command, { input } = {}) {
  const result = spawnSync("railway", ["ssh", "-s", service, command], {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `railway ssh failed with status ${result.status}`).trim());
  }
  return result.stdout;
}

function runRailwayNodeScript(service, script, env = {}) {
  const exports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const shellScript = `${exports ? `${exports} ` : ""}node - <<'NODE'\n${script}\nNODE`;
  return runRailwayShell(service, shellScript);
}

function buildRemoteReviewErrorMessage(post, report, repairPasses) {
  const issues = formatReviewIssues(report);
  return [
    `Review did not approve post "${post.slug}" after ${repairPasses} remote repair pass(es).`,
    issues.blockers.length ? `Blockers: ${issues.blockers.join(" | ")}` : null,
    issues.recommendations.length ? `Recommendations: ${issues.recommendations.join(" | ")}` : null,
  ].filter(Boolean).join("\n");
}

function buildRemotePublishScript() {
  return `
const path = require("node:path");
const { Buffer } = require("node:buffer");
const { getDatabase } = require("./src/database");
const { BlogService } = require("./src/services/blog-service");
const { reviewBlogDraft } = require("./src/services/blog-review-service");
const { generateEditorialReview, buildUnavailableEditorialReview } = require("./src/services/blog-editorial-review-service");
const blogRepairService = require("./src/services/blog-repair-service");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function chooseCandidate(posts, payload) {
  const desiredSlug = slugify(payload.slug || payload.title || "");
  const desiredTitle = normalizeText(payload.title || "");
  const exactSlug = posts.filter((post) => slugify(post.slug) === desiredSlug);
  if (exactSlug.length === 1) return exactSlug[0];
  if (exactSlug.length > 1) {
    throw new Error(\`Multiple posts match slug "\${desiredSlug}". Use --post-id.\`);
  }
  const exactTitle = posts.filter((post) => normalizeText(post.title) === desiredTitle);
  if (exactTitle.length === 1) return exactTitle[0];
  if (exactTitle.length > 1) {
    throw new Error(\`Multiple posts match title "\${payload.title}". Use --post-id.\`);
  }
  return null;
}

function ensureBodyPersisted(post, expectedBody) {
  const savedBody = String(post?.body_markdown || "").trim();
  const sourceBody = String(expectedBody || "").trim();
  if (!savedBody) {
    throw new Error("Saved draft body is empty after remote update.");
  }
  const minimumLength = Math.min(sourceBody.length, Math.max(200, Math.floor(sourceBody.length * 0.8)));
  if (savedBody.length < minimumLength) {
    throw new Error(\`Saved draft body length \${savedBody.length} is shorter than expected \${minimumLength}.\`);
  }
}

(async () => {
  const options = JSON.parse(Buffer.from(process.env.PUBLISH_OPTIONS_B64, "base64").toString("utf8"));
  const payload = JSON.parse(Buffer.from(process.env.PUBLISH_PAYLOAD_B64, "base64").toString("utf8"));
  const bodyMarkdown = Buffer.from(process.env.PUBLISH_ARTICLE_B64, "base64").toString("utf8");
  payload.body_markdown = bodyMarkdown;

  const db = await getDatabase({ migrationsDir: path.join(process.cwd(), "migrations") });
  try {
    const blogService = new BlogService(db);
    let targetPost = null;
    if (options.postId) {
      targetPost = await blogService.getPostById(options.postId);
      if (!targetPost) {
        throw new Error(\`Post \${options.postId} was not found.\`);
      }
    } else {
      const drafts = await blogService.listPosts({
        status: "draft",
        search: payload.slug || payload.title || options.search || "",
        limit: 25,
        offset: 0,
      });
      targetPost = chooseCandidate(drafts, payload);
    }

    let post = targetPost
      ? await blogService.updatePost(targetPost.id, payload, null)
      : await blogService.createPost(payload, null);

    ensureBodyPersisted(post, bodyMarkdown);

    let report = reviewBlogDraft(post);
    report.editorial_review = options.skipEditorialLlm
      ? buildUnavailableEditorialReview()
      : await generateEditorialReview(post, report);
    post = await blogService.saveReviewResult(post.id, report, null);

    let repairPass = 0;
    while (report.decision !== "approved" && options.allowRemoteRepair && repairPass < options.maxRepairPasses) {
      repairPass += 1;
      const repairResult = await blogRepairService.generateBlogRepairDraft(post, report);
      if (repairResult.status !== "available" || !repairResult.draft) {
        throw new Error(repairResult.error || repairResult.summary || "Remote repair is unavailable right now.");
      }
      const candidateDraft = {
        ...repairResult.draft,
        author_name: repairResult.draft.author_name || post.author_name || payload.author_name,
      };
      post = await blogService.updatePost(post.id, candidateDraft, null);
      ensureBodyPersisted(post, candidateDraft.body_markdown || bodyMarkdown);
      report = reviewBlogDraft(post);
      report.editorial_review = options.skipEditorialLlm
        ? buildUnavailableEditorialReview()
        : await generateEditorialReview(post, report);
      post = await blogService.saveReviewResult(post.id, report, null);
    }

    if (report.decision !== "approved") {
      process.stdout.write(JSON.stringify({
        ok: false,
        post,
        report,
        repairPasses: repairPass,
      }));
      return;
    }

    if (options.dryRun) {
      process.stdout.write(JSON.stringify({
        ok: true,
        mode: "dry-run",
        post,
        report,
      }));
      return;
    }

    const published = await blogService.publishPost(post.id, null);
    process.stdout.write(JSON.stringify({
      ok: true,
      mode: "published",
      post: published,
      report,
    }));
  } finally {
    await db.close?.();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`.trim();
}

function buildRemoteInspectScript() {
  return `
const path = require("node:path");
const { Buffer } = require("node:buffer");
const { getDatabase } = require("./src/database");
const { BlogService } = require("./src/services/blog-service");

(async () => {
  const options = JSON.parse(Buffer.from(process.env.INSPECT_OPTIONS_B64, "base64").toString("utf8"));
  const db = await getDatabase({ migrationsDir: path.join(process.cwd(), "migrations") });
  try {
    const blogService = new BlogService(db);
    const posts = await blogService.listPosts({
      status: options.status,
      search: options.search || options.slug || options.title || "",
      limit: options.limit || 20,
      offset: 0,
    });
    const rows = posts
      .filter((post) => {
        if (options.slug && post.slug !== options.slug) return false;
        if (options.title && !String(post.title || "").toLowerCase().includes(String(options.title).toLowerCase())) return false;
        return true;
      })
      .map((post) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
        review_status: post.review_status,
        has_publication_history: post.has_publication_history,
        published_at: post.published_at,
        updated_at: post.updated_at,
      }));
    process.stdout.write(JSON.stringify({ rows }));
  } finally {
    await db.close?.();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`.trim();
}

function chooseCandidate(posts, desired) {
  if (!Array.isArray(posts) || posts.length === 0) return null;
  const desiredSlug = slugify(desired.slug || desired.title || "");
  const desiredTitle = normalizeWhitespace(desired.title || "");

  const exactSlug = posts.filter((post) => slugify(post.slug) === desiredSlug);
  if (exactSlug.length === 1) return exactSlug[0];
  if (exactSlug.length > 1) {
    throw new Error(`Multiple posts match slug "${desiredSlug}". Use --post-id or inspect mode.`);
  }

  const exactTitle = posts.filter((post) => normalizeWhitespace(post.title) === desiredTitle);
  if (exactTitle.length === 1) return exactTitle[0];
  if (exactTitle.length > 1) {
    throw new Error(`Multiple posts match title "${desired.title}". Use --post-id or inspect mode.`);
  }

  return null;
}

function buildInitialPayload(options, bodyMarkdown) {
  return {
    title: options.title || "",
    slug: options.slug || "",
    excerpt: options.excerpt || "",
    answer_summary: options.answerSummary || "",
    target_query: options.targetQuery || "",
    target_intent: options.targetIntent || "informational",
    primary_keyword: options.primaryKeyword || "",
    hero_image_url: options.heroImageUrl || "",
    body_markdown: bodyMarkdown,
    author_name: options.author || "",
    tags: parseTags(options.tags),
  };
}

function mergeArticlePackMetadata(options, pack) {
  return {
    ...options,
    title: options.title || pack.title || "",
    slug: options.slug || pack.slug || "",
    excerpt: options.excerpt || pack.excerpt || "",
    answerSummary: options.answerSummary || pack.answer_summary || "",
    targetQuery: options.targetQuery || pack.target_query || "",
    primaryKeyword: options.primaryKeyword || pack.primary_keyword || "",
    heroImageUrl: options.heroImageUrl || pack.hero_image_url || "",
    author: options.author || pack.author_name || "",
  };
}

function formatReviewIssues(report) {
  const blockers = Array.isArray(report?.blockers) ? report.blockers : [];
  const recommendations = Array.isArray(report?.recommendations) ? report.recommendations : [];
  return {
    blockers: blockers.map((item) => `${item.title} — ${item.detail}`),
    recommendations: recommendations.map((item) => `${item.title} — ${item.detail}`),
  };
}

async function publishFlow(options) {
  options = normalizeIntentOptions(options);
  const rawArticleInput = await readArticleBody(options.articleFile);
  if (!rawArticleInput.trim()) {
    throw new Error("Article body is required. Provide --article-file or pipe article markdown via stdin.");
  }

  const articlePack = parseArticlePack(rawArticleInput);
  if (articlePack) {
    options = mergeArticlePackMetadata(options, articlePack);
  }

  const bodyMarkdown = articlePack ? articlePack.body_markdown : rawArticleInput;
  let payload = buildInitialPayload(options, applyLinkReplacements(bodyMarkdown, options.replaceLinks));

  const suspiciousLinks = extractMarkdownLinks(payload.body_markdown).filter((link) => link.isSuspicious);
  if (suspiciousLinks.length > 0 && !options.allowSuspiciousLinks) {
    const details = suspiciousLinks.map((link) => `${link.label} -> ${link.url}`).join("; ");
    throw new Error(`Suspicious imported links detected: ${details}. Replace them with --replace-link or pass --allow-suspicious-links if intentional.`);
  }

  if (options.railwayRemote || !process.env.ADMIN_EMAIL) {
    return publishFlowRailwayRemote(options, payload);
  }

  return publishFlowCms(options, payload);
}

async function publishFlowRailwayRemote(options, payload) {
  const remoteOptions = {
    postId: options.postId || null,
    search: options.search || "",
    dryRun: Boolean(options.dryRun),
    maxRepairPasses: options.maxRepairPasses,
    allowRemoteRepair: Boolean(options.allowRemoteRepair),
    skipEditorialLlm: options.skipEditorialLlm !== false ? true : false,
  };

  const stdout = runRailwayNodeScript(
    options.railwayService,
    buildRemotePublishScript(),
    {
      PUBLISH_OPTIONS_B64: Buffer.from(JSON.stringify(remoteOptions), "utf8").toString("base64"),
      PUBLISH_PAYLOAD_B64: Buffer.from(JSON.stringify({ ...payload, body_markdown: "" }), "utf8").toString("base64"),
      PUBLISH_ARTICLE_B64: Buffer.from(payload.body_markdown, "utf8").toString("base64"),
    }
  );
  const result = JSON.parse(stdout);

  if (!result.ok) {
    throw new Error(buildRemoteReviewErrorMessage(result.post, result.report, result.repairPasses || 0));
  }

  const publicUrl = `${options.siteBaseUrl.replace(/\/$/, "")}/blog/${result.post.slug}`;
  const publicResponse = await fetch(publicUrl, {
    headers: { Accept: "text/html" },
  });
  if (!publicResponse.ok) {
    throw new Error(`Publish succeeded, but public verification failed for ${publicUrl} with status ${publicResponse.status}.`);
  }

  return {
    mode: result.mode,
    post: result.post,
    publicUrl,
    report: result.report,
    transport: "railway-remote",
  };
}

async function publishFlowCms(options, payload) {
  const session = await getSession(options);
  const token = session.token;

  const inferred = await requestJson(options.apiBaseUrl, "/admin/dashboard/blog/posts/autofill", {
    method: "POST",
    token,
    body: {
      title: payload.title,
      body_markdown: payload.body_markdown,
    },
  });
  payload = mergeMissingMetadata(payload, inferred.draft || {}, { overwrite: Boolean(options.refreshMetadata) });

  let targetPost = null;
  if (options.postId) {
    const current = await requestJson(options.apiBaseUrl, `/admin/dashboard/blog/posts/${options.postId}`, { token });
    targetPost = current.post;
  } else {
    const searchTerm = payload.slug || payload.title || options.search || "";
    const list = await requestJson(
      options.apiBaseUrl,
      `/admin/dashboard/blog/posts?status=draft&search=${encodeURIComponent(searchTerm)}&limit=25&offset=0`,
      { token }
    );
    targetPost = chooseCandidate(list.posts || [], payload);
  }

  logStep(targetPost ? `Updating draft ${targetPost.id} (${targetPost.slug})` : "Creating new draft");

  const saved = targetPost
    ? await requestJson(options.apiBaseUrl, `/admin/dashboard/blog/posts/${targetPost.id}`, {
        method: "PUT",
        token,
        body: payload,
      })
    : await requestJson(options.apiBaseUrl, "/admin/dashboard/blog/posts", {
        method: "POST",
        token,
        body: payload,
      });

  let post = saved.post;
  let reportResult = await requestJson(options.apiBaseUrl, `/admin/dashboard/blog/posts/${post.id}/review`, {
    method: "POST",
    token,
    body: {},
  });
  post = reportResult.post;

  let repairPass = 0;
  while (reportResult.report?.decision !== "approved" && repairPass < options.maxRepairPasses) {
    repairPass += 1;
    logStep(`Repair pass ${repairPass} for ${post.slug}`);
    const repaired = await requestJson(options.apiBaseUrl, `/admin/dashboard/blog/posts/${post.id}/repair`, {
      method: "POST",
      token,
      body: {},
    });
    post = repaired.post;
    reportResult = { post: repaired.post, report: repaired.repair.after };
  }

  if (reportResult.report?.decision !== "approved") {
    const issues = formatReviewIssues(reportResult.report);
    throw new Error(
      [
        `Review did not approve post "${post.slug}" after ${repairPass} repair pass(es).`,
        issues.blockers.length ? `Blockers: ${issues.blockers.join(" | ")}` : null,
        issues.recommendations.length ? `Recommendations: ${issues.recommendations.join(" | ")}` : null,
      ].filter(Boolean).join("\n")
    );
  }

  if (options.dryRun) {
    return {
      mode: "dry-run",
      post,
      publicUrl: `${options.siteBaseUrl.replace(/\/$/, "")}/blog/${post.slug}`,
      report: reportResult.report,
    };
  }

  const published = await requestJson(options.apiBaseUrl, `/admin/dashboard/blog/posts/${post.id}/publish`, {
    method: "POST",
    token,
    body: {},
  });

  const publicUrl = `${options.siteBaseUrl.replace(/\/$/, "")}/blog/${published.post.slug}`;
  const publicResponse = await fetch(publicUrl, {
    headers: { Accept: "text/html" },
  });
  if (!publicResponse.ok) {
    throw new Error(`Publish succeeded, but public verification failed for ${publicUrl} with status ${publicResponse.status}.`);
  }

  return {
    mode: "published",
    post: published.post,
    publicUrl,
    report: reportResult.report,
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  switch (command) {
    case "login": {
      const session = await loginAndStoreSession(options);
      process.stdout.write(`${JSON.stringify({ session_file: path.resolve(options.sessionFile), admin: session.admin, expires_at: session.expires_at }, null, 2)}\n`);
      return;
    }
    case "inspect": {
      const rows = (options.railwayRemote || !process.env.DATABASE_URL)
        ? JSON.parse(
            runRailwayNodeScript(options.railwayService, buildRemoteInspectScript(), {
              INSPECT_OPTIONS_B64: Buffer.from(JSON.stringify({
                slug: options.slug || "",
                title: options.title || "",
                search: options.search || "",
                limit: options.limit,
              }), "utf8").toString("base64"),
            })
          ).rows
        : await inspectBlogPosts(options);
      process.stdout.write(`${JSON.stringify({ rows }, null, 2)}\n`);
      return;
    }
    case "publish": {
      const result = await publishFlow(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  applyLinkReplacements,
  buildRemotePublishScript,
  chooseCandidate,
  extractMarkdownLinks,
  isInternalLink,
  mergeMissingMetadata,
  normalizeIntentOptions,
  parseArticlePack,
  parseLinkReplacement,
  runRailwayNodeScript,
  slugify,
};
