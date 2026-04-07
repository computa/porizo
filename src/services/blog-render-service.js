"use strict";

const { buildFormattedArticle, slugifyFragment } = require("./blog-format-service");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (/^(\/|https?:\/\/|mailto:)/i.test(value)) {
    return value;
  }
  return "";
}

function parseEmbedDirective(line) {
  const match = String(line || "").trim().match(/^@\[(youtube|audio)(?:\s+([^\]]+))?\]\(([^)]+)\)$/i);
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    label: String(match[2] || "").trim(),
    url: match[3].trim(),
  };
}

function resolveYouTubeEmbedUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    let videoId = "";

    if (host === "youtu.be") {
      videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v") || "";
      } else if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.split("/")[2] || "";
      }
    }

    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return "";
    }

    return `https://www.youtube-nocookie.com/embed/${videoId}`;
  } catch {
    return "";
  }
}

function renderEmbedDirective(embed) {
  if (!embed) return "";

  if (embed.type === "youtube") {
    const src = resolveYouTubeEmbedUrl(embed.url);
    if (!src) return "";
    return `<figure class="embed embed--video">
      <div class="embed__frame">
        <iframe
          src="${escapeHtml(src)}"
          title="${escapeHtml(embed.label || "Embedded YouTube video")}"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
      ${embed.label ? `<figcaption>${escapeHtml(embed.label)}</figcaption>` : ""}
    </figure>`;
  }

  if (embed.type === "audio") {
    const src = safeUrl(embed.url);
    if (!src) return "";
    return `<figure class="embed embed--audio">
      ${embed.label ? `<figcaption>${escapeHtml(embed.label)}</figcaption>` : ""}
      <audio controls preload="metadata" src="${escapeHtml(src)}"></audio>
    </figure>`;
  }

  return "";
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(label);
    const external = /^https?:\/\//i.test(href);
    return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(label)}</a>`;
  });
  return html;
}

function createHeadingIdResolver() {
  const seen = new Map();
  return (text) => {
    const base = slugifyFragment(text);
    if (!base) return "";
    const current = seen.get(base) || 0;
    seen.set(base, current + 1);
    return current === 0 ? base : `${base}-${current + 1}`;
  };
}

function renderMarkdownToHtml(markdown, { includeHeadingIds = false } = {}) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let codeFence = false;
  let codeLines = [];
  const resolveHeadingId = includeHeadingIds ? createHeadingIdResolver() : () => "";

  function flushParagraph() {
    if (!paragraph.length) return;
    output.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  }

  function flushCodeFence() {
    if (!codeFence) return;
    output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeFence = false;
    codeLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeList();
      if (codeFence) {
        flushCodeFence();
      } else {
        codeFence = true;
        codeLines = [];
      }
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = Math.min(6, headingMatch[1].length);
      const headingId = resolveHeadingId(headingMatch[2]);
      output.push(`<h${level}${headingId ? ` id="${escapeHtml(headingId)}"` : ""}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      flushParagraph();
      closeList();
      output.push(`<blockquote><p>${renderInlineMarkdown(blockquoteMatch[1])}</p></blockquote>`);
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      closeList();
      const src = safeUrl(imageMatch[2]);
      if (src) {
        output.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(imageMatch[1])}" />`);
      }
      continue;
    }

    const embed = parseEmbedDirective(trimmed);
    if (embed) {
      flushParagraph();
      closeList();
      const embedHtml = renderEmbedDirective(embed);
      if (embedHtml) {
        output.push(embedHtml);
      }
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        output.push("<ul>");
      }
      output.push(`<li>${renderInlineMarkdown(unorderedMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        output.push("<ol>");
      }
      output.push(`<li>${renderInlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  flushCodeFence();

  return output.join("\n");
}

function renderArticleToc(headings) {
  if (!Array.isArray(headings) || headings.length < 3) {
    return "";
  }

  const items = headings
    .map((heading) => `<li class="toc__item toc__item--h${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`)
    .join("");

  return `<nav class="toc" aria-label="Table of contents">
    <div class="toc__title">In this article</div>
    <ol class="toc__list">${items}</ol>
  </nav>`;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function renderBlogIndexPage(posts, { siteOrigin = "https://porizo.co" } = {}) {
  const cards = posts.map((post) => `
    <article class="post-card">
      <div class="post-card__meta">${escapeHtml(formatDate(post.published_at))}</div>
      <h2><a href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <p class="post-card__excerpt">${escapeHtml(post.excerpt)}</p>
      <div class="post-card__tags">${(Array.isArray(post.tags) ? post.tags : []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    </article>
  `).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Porizo Blog</title>
  <meta name="description" content="Porizo articles about personalized songs, gifting, storytelling, and creating memorable moments.">
  <link rel="canonical" href="${escapeHtml(siteOrigin)}/blog">
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1020;color:#e5e7eb;}
    .shell{max-width:960px;margin:0 auto;padding:48px 20px 80px;}
    .eyebrow{color:#fb7185;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{font-size:44px;line-height:1.05;margin:12px 0 16px}
    .lede{color:#94a3b8;max-width:720px;font-size:18px;line-height:1.6}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:36px}
    .post-card{background:#111827;border:1px solid #1f2937;border-radius:18px;padding:22px}
    .post-card__meta{color:#94a3b8;font-size:13px;margin-bottom:10px}
    .post-card h2{margin:0 0 10px;font-size:24px;line-height:1.25}
    .post-card a{color:#f8fafc;text-decoration:none}
    .post-card a:hover{color:#fb7185}
    .post-card__excerpt{color:#cbd5e1;line-height:1.6}
    .post-card__tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
    .post-card__tags span{font-size:12px;background:#1f2937;color:#cbd5e1;padding:4px 8px;border-radius:999px}
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">Porizo Publishing</div>
    <h1>Blog</h1>
    <p class="lede">Search-friendly and answer-engine-friendly articles about personal songs, gifting, memory capture, and storytelling.</p>
    <section class="grid">
      ${cards || '<p>No published posts yet.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function renderBlogPostPage(post, { siteOrigin = "https://porizo.co" } = {}) {
  const { formattedMarkdown, headings, readingTimeMinutes } = buildFormattedArticle(post);
  const bodyHtml = renderMarkdownToHtml(formattedMarkdown, { includeHeadingIds: true });
  const canonicalUrl = `${siteOrigin}/blog/${post.slug}`;
  const heroImage = safeUrl(post.hero_image_url || "");
  const publishedDate = formatDate(post.published_at);
  const articleToc = renderArticleToc(headings);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    author: {
      "@type": "Person",
      name: post.author_name || "Porizo Editorial",
    },
    mainEntityOfPage: canonicalUrl,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(post.title)}</title>
  <meta name="description" content="${escapeHtml(post.excerpt)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(post.excerpt)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  ${heroImage ? `<meta property="og:image" content="${escapeHtml(heroImage)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.excerpt)}">
  ${heroImage ? `<meta name="twitter:image" content="${escapeHtml(heroImage)}">` : ""}
  <script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fffaf5;color:#18181b}
    .shell{max-width:1120px;margin:0 auto;padding:48px 20px 96px}
    .back{display:inline-block;margin-bottom:24px;color:#b45309;text-decoration:none;font-weight:600}
    .back:hover{text-decoration:underline}
    .meta{color:#78716c;font-size:14px;margin-bottom:16px}
    .meta span+span::before{content:"·";margin:0 8px;color:#d6d3d1}
    h1{font-size:44px;line-height:1.05;margin:0 0 16px}
    .excerpt{font-size:20px;line-height:1.6;color:#44403c;margin-bottom:24px;max-width:38em}
    .answer-box{background:#fff7ed;border:1px solid #fdba74;border-radius:16px;padding:18px 20px;margin:24px 0}
    .answer-box strong{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9a3412;margin-bottom:8px}
    .hero{width:100%;max-width:72ch;border-radius:20px;margin:24px 0}
    .article-layout{display:grid;grid-template-columns:minmax(0,72ch) minmax(240px,280px);gap:32px;align-items:start}
    .article-main{min-width:0}
    .toc{position:sticky;top:24px;background:#fff;border:1px solid #fed7aa;border-radius:18px;padding:18px 18px 14px}
    .toc__title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9a3412;margin-bottom:10px}
    .toc__list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
    .toc__item a{color:#44403c;text-decoration:none;line-height:1.45}
    .toc__item a:hover{color:#b45309}
    .toc__item--h3{padding-left:14px}
    article{font-size:18px;line-height:1.8;color:#292524}
    article h2,article h3,article h4{line-height:1.25;color:#111827;margin:40px 0 14px;scroll-margin-top:24px}
    article h2{font-size:30px}
    article h3{font-size:24px}
    article p{margin:0 0 18px;max-width:68ch}
    article ul,article ol{padding-left:24px;margin:0 0 18px}
    article blockquote{margin:24px 0;padding:0 0 0 18px;border-left:4px solid #fdba74;color:#57534e}
    article pre{background:#111827;color:#f8fafc;padding:16px;border-radius:14px;overflow:auto}
    article code{background:#f5f5f4;padding:2px 6px;border-radius:6px}
    article img{max-width:100%;border-radius:16px}
    .embed{margin:28px 0;display:grid;gap:10px}
    .embed figcaption{font-size:14px;line-height:1.5;color:#57534e}
    .embed__frame{position:relative;padding-top:56.25%;border-radius:18px;overflow:hidden;background:#111827}
    .embed__frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .embed audio{width:100%}
    .tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}
    .tags span{font-size:12px;background:#f5f5f4;color:#44403c;padding:4px 8px;border-radius:999px}
    @media (max-width: 980px){.article-layout{grid-template-columns:1fr}.toc{position:static;order:-1}}
  </style>
</head>
<body>
  <main class="shell">
    <a class="back" href="/blog">← Back to Blog</a>
    <div class="meta"><span>${escapeHtml(publishedDate)}</span>${post.author_name ? `<span>${escapeHtml(post.author_name)}</span>` : ""}<span>${escapeHtml(`${readingTimeMinutes} min read`)}</span></div>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="excerpt">${escapeHtml(post.excerpt)}</p>
    ${post.answer_summary ? `<section class="answer-box"><strong>Quick Answer</strong><div>${escapeHtml(post.answer_summary)}</div></section>` : ""}
    ${heroImage ? `<img class="hero" src="${escapeHtml(heroImage)}" alt="${escapeHtml(post.title)}">` : ""}
    <div class="article-layout">
      <div class="article-main">
        <article>${bodyHtml}</article>
      </div>
      ${articleToc}
    </div>
    <div class="tags">${(Array.isArray(post.tags) ? post.tags : []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
  </main>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderMarkdownToHtml,
  renderBlogIndexPage,
  renderBlogPostPage,
};
