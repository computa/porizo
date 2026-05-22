"use strict";

const {
  buildFormattedArticle,
  extractFaqPairs,
  slugifyFragment,
} = require("./blog-format-service");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
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
  const match = String(line || "")
    .trim()
    .match(/^@\[(youtube|audio)(?:\s+([^\]]+))?\]\(([^)]+)\)$/i);
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
    } else if (
      host.endsWith("youtube.com") ||
      host.endsWith("youtube-nocookie.com")
    ) {
      if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v") || "";
      } else if (
        parsed.pathname.startsWith("/embed/") ||
        parsed.pathname.startsWith("/shorts/")
      ) {
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
    // label and url come from already-escaped html (pass-1 escapeHtml above),
    // so re-escaping would double-encode entities like &#39; into &amp;#39;.
    const href = safeUrl(url);
    if (!href) return label;
    const external = /^https?:\/\//i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
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
  const lines = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let codeFence = false;
  let codeLines = [];
  const resolveHeadingId = includeHeadingIds
    ? createHeadingIdResolver()
    : () => "";

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
      output.push(
        `<h${level}${headingId ? ` id="${escapeHtml(headingId)}"` : ""}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      flushParagraph();
      closeList();
      output.push(
        `<blockquote><p>${renderInlineMarkdown(blockquoteMatch[1])}</p></blockquote>`,
      );
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      closeList();
      const src = safeUrl(imageMatch[2]);
      if (src) {
        output.push(
          `<img src="${escapeHtml(src)}" alt="${escapeHtml(imageMatch[1])}" />`,
        );
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
    .map(
      (heading) =>
        `<li class="toc__item toc__item--h${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("");

  return `<nav class="toc" aria-label="Table of contents">
    <div class="toc__title">Contents</div>
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

function tagClass(tag) {
  const slug = slugifyFragment(String(tag || ""));
  if (!slug) return "";
  if (["stories", "story", "spotlight", "journal"].includes(slug))
    return "tag--stories";
  if (["product", "updates", "update", "launch", "release"].includes(slug))
    return "tag--product";
  if (
    [
      "tips",
      "tip",
      "guide",
      "guides",
      "playbook",
      "howto",
      "how-to",
      "tutorial",
    ].includes(slug)
  )
    return "tag--tips";
  return "";
}

function renderTagList(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return tags
    .map((tag) => {
      const cls = tagClass(tag);
      return `<span${cls ? ` class="${cls}"` : ""}>${escapeHtml(tag)}</span>`;
    })
    .join("");
}

function renderBlogIndexPage(posts, { siteOrigin = "https://porizo.co" } = {}) {
  const featuredCards = posts
    .map(
      (post, index) => `
    <article class="post-card${index === 0 && posts.length >= 3 ? " post-card--featured" : ""}">
      <div class="post-card__meta">${escapeHtml(formatDate(post.published_at))}</div>
      <h2><a href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <p class="post-card__excerpt">${escapeHtml(post.excerpt)}</p>
      <div class="post-card__tags">${renderTagList(post.tags)}</div>
    </article>
  `,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Porizo Blog</title>
  <meta name="description" content="Porizo articles about personalized songs, gifting, storytelling, and creating memorable moments.">
  <meta name="theme-color" content="#FBF7F2">
  <link rel="canonical" href="${escapeHtml(siteOrigin)}/blog">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Porizo">
  <meta property="og:title" content="Porizo Blog — Notes on personalized song gifts">
  <meta property="og:description" content="Articles about personalized songs, gifting, storytelling, and creating memorable moments.">
  <meta property="og:url" content="${escapeHtml(siteOrigin)}/blog">
  <meta property="og:image" content="${escapeHtml(siteOrigin)}/assets/og-song.png">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Porizo Blog — Notes on personalized song gifts">
  <meta name="twitter:description" content="Articles about personalized songs, gifting, storytelling, and creating memorable moments.">
  <meta name="twitter:image" content="${escapeHtml(siteOrigin)}/assets/og-song.png">

  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${siteOrigin}/blog#blog`,
        url: `${siteOrigin}/blog`,
        name: "Porizo Blog",
        description:
          "Articles about personalized songs, gifting, storytelling, and creating memorable moments.",
        publisher: {
          "@type": "Organization",
          name: "Porizo",
          url: `${siteOrigin}/`,
        },
        inLanguage: "en",
        blogPost: posts.slice(0, 20).map((p) => ({
          "@type": "BlogPosting",
          "@id": `${siteOrigin}/blog/${p.slug}#article`,
          url: `${siteOrigin}/blog/${p.slug}`,
          headline: p.title,
          description: p.excerpt || "",
          datePublished: p.published_at,
          dateModified: p.updated_at || p.published_at,
          author: { "@type": "Organization", name: "Porizo" },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: `${siteOrigin}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: `${siteOrigin}/blog`,
          },
        ],
      },
    ],
  })}</script>

  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/main.css">
  <style>
    .blog-index-hero{padding:calc(var(--s-8) + 60px) var(--s-5) var(--s-7);position:relative;overflow:hidden}
    .blog-index-hero::before{content:'';position:absolute;top:10%;left:15%;width:520px;height:260px;background:var(--glow-gold);pointer-events:none;opacity:.35}
    .blog-index-hero__content{position:relative;z-index:1;max-width:1120px;margin:0 auto;display:grid;grid-template-columns:auto 1fr;gap:var(--s-7);align-items:end}
    .blog-index-hero__stream{display:flex;flex-direction:column;gap:var(--s-2);color:var(--ink-3);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.12em;white-space:nowrap}
    .blog-index-hero__stream span:first-child{color:var(--gold-deep)}
    .blog-index-hero__copy{max-width:640px}
    .blog-index-hero h1{font-size:clamp(3rem,7vw,5rem);line-height:.95;margin:0 0 var(--s-4);letter-spacing:-0.02em}
    .blog-index-hero .lede{font-family:var(--font-display);font-variation-settings:"opsz" 72;font-size:var(--fs-lg);line-height:1.4;color:var(--ink-2);max-width:52ch;margin:0}
    .blog-shell{max-width:1120px;margin:0 auto;padding:0 var(--s-5) var(--s-9)}
    .post-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--s-5)}
    .post-card{background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-6);transition:border-color var(--t-med),transform var(--t-med),box-shadow var(--t-med);opacity:0;animation:blog-fade-up 560ms var(--ease) forwards}
    .post-card:nth-child(1){animation-delay:0ms}
    .post-card:nth-child(2){animation-delay:60ms}
    .post-card:nth-child(3){animation-delay:120ms}
    .post-card:nth-child(4){animation-delay:180ms}
    .post-card:nth-child(n+5){animation-delay:240ms}
    @keyframes blog-fade-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @media (prefers-reduced-motion:reduce){.post-card{animation:none;opacity:1}}
    .post-card:hover{border-color:var(--gold);transform:translateY(-4px);box-shadow:var(--shadow-hover)}
    .post-card--featured{grid-column:span 2;padding:var(--s-7);background:linear-gradient(135deg,var(--surface) 0%,var(--bg-2) 100%)}
    .post-card--featured h2{font-size:clamp(1.75rem,3vw,2.25rem)}
    .post-card--featured .post-card__excerpt{font-size:var(--fs-md);max-width:56ch}
    @media (max-width:680px){.post-card--featured{grid-column:span 1;padding:var(--s-6)}.post-card--featured h2{font-size:var(--fs-xl)}}
    .post-card__meta{color:var(--ink-3);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.1em;margin-bottom:var(--s-3)}
    .post-card h2{font-family:var(--font-display);font-size:var(--fs-xl);line-height:1.25;margin:0 0 var(--s-3);font-variation-settings:"opsz" 72;color:var(--ink)}
    .post-card a{color:var(--ink);text-decoration:none;transition:color var(--t-fast)}
    .post-card:hover a{color:var(--gold-deep)}
    .post-card__excerpt{color:var(--ink-3);line-height:1.6;font-size:var(--fs-sm);margin:0}
    .post-card__tags{display:flex;gap:var(--s-2);flex-wrap:wrap;margin-top:var(--s-4)}
    .post-card__tags span{display:inline-flex;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;background:var(--bg-2);color:var(--ink-3);padding:3px 10px;border-radius:var(--r-pill);border:1px solid var(--hairline)}
    .post-card__tags .tag--stories{background:linear-gradient(135deg,rgba(201,131,125,0.18),rgba(201,131,125,0.04));color:var(--rose-deep);border-color:rgba(201,131,125,0.28)}
    .post-card__tags .tag--product{background:linear-gradient(135deg,rgba(224,120,80,0.18),rgba(224,120,80,0.04));color:var(--gold-deep);border-color:var(--border-gold)}
    .post-card__tags .tag--tips{background:linear-gradient(135deg,rgba(123,143,107,0.18),rgba(123,143,107,0.04));color:var(--sage-deep);border-color:rgba(123,143,107,0.28)}
    .post-empty{text-align:center;color:var(--ink-3);padding:var(--s-9) 0;font-family:var(--font-display);font-variation-settings:"opsz" 72;font-size:var(--fs-lg);max-width:480px;margin:0 auto}
    .post-empty small{display:block;margin-top:var(--s-3);font-family:var(--font-sans);font-size:var(--fs-sm);color:var(--ink-3)}
    @media (max-width:820px){.blog-index-hero__content{grid-template-columns:1fr;gap:var(--s-4);align-items:start}.blog-index-hero__stream{flex-direction:row;gap:var(--s-4)}}
    @media (max-width:640px){.blog-index-hero{padding:100px var(--s-4) var(--s-6)}.blog-shell{padding:0 var(--s-4) var(--s-7)}}
  </style>
</head>
<body>
  <nav class="nav" id="nav">
    <div class="container">
      <div class="nav__inner">
        <a href="/" class="nav__logo"><span class="nav__logo-text">Porizo</span></a>
        <div class="nav__links">
          <a href="/about" class="nav__link">About</a>
          <a href="/pricing" class="nav__link">Pricing</a>
          <a href="/blog" class="nav__link">Blog</a>
          <a href="/support" class="nav__link nav__link--secondary">Support</a>
        </div>
        <a href="/download" class="nav__cta">Get the app</a>
      </div>
    </div>
  </nav>

  <section class="blog-index-hero">
    <div class="blog-index-hero__content">
      <div class="blog-index-hero__stream">
        <span>Porizo Publishing</span>
        <span>${posts.length ? escapeHtml(`${posts.length} article${posts.length === 1 ? "" : "s"}`) : "In progress"}</span>
      </div>
      <div class="blog-index-hero__copy">
        <h1>Blog</h1>
        <p class="lede">Notes on the songs people make for each other.</p>
      </div>
    </div>
  </section>

  <main class="blog-shell">
    ${posts.length ? `<section class="post-grid">${featuredCards}</section>` : '<p class="post-empty">New stories are on the way.<small>We\'re writing about personal songs, memory, and the moments behind them.</small></p>'}
  </main>

  <footer class="footer">
    <div class="container">
      <div class="footer__inner">
        <div class="footer__brand">
          <a href="/" class="nav__logo"><span class="nav__logo-text">Porizo</span></a>
          <p class="footer__tagline">Your moment, in a song.</p>
        </div>
        <div class="footer__col">
          <h4>Product</h4>
          <a href="/pricing">Pricing</a>
          <a href="/#how">How it works</a>
          <a href="/download">Download</a>
        </div>
        <div class="footer__col">
          <h4>Company</h4>
          <a href="/about">About</a>
          <a href="/blog">Blog</a>
          <a href="/support">Support</a>
        </div>
        <div class="footer__col">
          <h4>Legal</h4>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </div>
      </div>
      <div class="footer__bottom">
        <span>&copy; 2026 Porizo. All rights reserved.</span>
        <span>One song at a time.</span>
      </div>
    </div>
  </footer>

  <script>
    window.addEventListener('scroll', function () {
      var n = document.getElementById('nav');
      if (n) n.classList.toggle('scrolled', window.scrollY > 40);
    });
  </script>
</body>
</html>`;
}

function renderBlogPostPage(post, { siteOrigin = "https://porizo.co" } = {}) {
  const { formattedMarkdown, headings, readingTimeMinutes } =
    buildFormattedArticle(post);
  const bodyHtml = renderMarkdownToHtml(formattedMarkdown, {
    includeHeadingIds: true,
  });
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

  const faqPairs = extractFaqPairs(formattedMarkdown);
  const faqJsonLd =
    faqPairs.length >= 2
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqPairs.map((pair) => ({
            "@type": "Question",
            name: pair.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: pair.answer,
            },
          })),
        }
      : null;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${siteOrigin}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${siteOrigin}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: canonicalUrl,
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(post.title)}</title>
  <meta name="description" content="${escapeHtml(post.excerpt)}">
  <meta name="theme-color" content="#FBF7F2">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
  <script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>
  ${faqJsonLd ? `<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/main.css">
  <style>
    .post-shell{max-width:1120px;margin:0 auto;padding:calc(var(--s-8) + 60px) var(--s-5) var(--s-9)}
    .back{display:inline-flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-5);color:var(--gold-deep);text-decoration:none;font-size:var(--fs-sm);font-weight:500;transition:color var(--t-fast),transform var(--t-fast)}
    .back svg{transition:transform var(--t-fast)}
    .back:hover{color:var(--gold)}
    .back:hover svg{transform:translateX(-2px)}
    .post-meta{color:var(--ink-3);font-size:var(--fs-sm);margin-bottom:var(--s-4)}
    .post-meta span+span::before{content:"·";margin:0 var(--s-3);color:var(--ink-3);opacity:.5}
    .post-shell h1{font-size:clamp(2.25rem,5vw,3.5rem);line-height:1.05;margin:0 0 var(--s-4);max-width:22ch}
    .excerpt{font-family:var(--font-display);font-variation-settings:"opsz" 72;font-size:var(--fs-lg);line-height:1.55;color:var(--ink-2);margin-bottom:var(--s-5);max-width:38em}
    .answer-box{background:var(--bg-2);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-4) var(--s-5);margin:var(--s-5) 0}
    .answer-box strong{display:block;font-size:var(--fs-xs);letter-spacing:.12em;text-transform:uppercase;color:var(--gold-deep);margin-bottom:var(--s-2)}
    .answer-box div{color:var(--ink-2);line-height:1.6}
    .hero{width:100%;max-width:72ch;border-radius:var(--r-xl);margin:var(--s-5) 0;box-shadow:var(--shadow-card)}
    .article-layout{display:grid;grid-template-columns:minmax(0,72ch) minmax(240px,280px);gap:var(--s-7);align-items:start}
    .article-main{min-width:0}
    .toc{position:sticky;top:96px;background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-4) var(--s-4) var(--s-3)}
    .toc__title{font-size:var(--fs-xs);font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-deep);margin-bottom:var(--s-3)}
    .toc__list{list-style:none;padding:0;margin:0;display:grid;gap:var(--s-2)}
    .toc__item a{color:var(--ink-2);text-decoration:none;line-height:1.45;font-size:var(--fs-sm);transition:color var(--t-fast)}
    .toc__item a:hover{color:var(--gold-deep)}
    .toc__item--h3{padding-left:var(--s-3)}
    article{font-size:18px;line-height:1.75;color:var(--ink-2)}
    article h2,article h3,article h4{font-family:var(--font-display);line-height:1.15;color:var(--ink);margin:var(--s-7) 0 var(--s-4);scroll-margin-top:96px;font-variation-settings:"opsz" 72;letter-spacing:-0.01em}
    article h2{font-size:clamp(1.75rem,3.5vw,2rem)}
    article h3{font-size:var(--fs-xl)}
    article h4{font-size:var(--fs-md)}
    article p{margin:0 0 var(--s-4);max-width:68ch}
    article a{color:var(--gold-deep);text-decoration:underline;text-decoration-color:rgba(184,90,53,0.3);transition:color var(--t-fast),text-decoration-color var(--t-fast)}
    article a:hover{color:var(--gold);text-decoration-color:var(--gold)}
    article ul,article ol{padding-left:var(--s-5);margin:0 0 var(--s-4)}
    article li{margin-bottom:var(--s-2)}
    article blockquote{position:relative;margin:var(--s-6) 0;padding:0 0 0 var(--s-7);color:var(--ink-2);font-style:italic;font-family:var(--font-display);font-size:var(--fs-lg);line-height:1.5;font-variation-settings:"opsz" 96}
    article blockquote::before{content:"\\201C";position:absolute;left:0;top:-0.15em;font-size:3.5em;line-height:1;color:var(--gold);font-family:var(--font-display);font-style:normal;font-variation-settings:"opsz" 144}
    article blockquote p{margin:0;max-width:58ch}
    article pre{background:var(--ink);color:#F5F5F0;padding:var(--s-4);border-radius:var(--r-md);overflow:auto;font-size:var(--fs-sm)}
    article code{background:var(--bg-2);color:var(--ink);padding:2px 6px;border-radius:var(--r-xs);font-family:var(--font-mono);font-size:0.9em}
    article pre code{background:transparent;padding:0;color:inherit}
    article img{max-width:100%;border-radius:var(--r-md)}
    .embed{margin:var(--s-6) 0;display:grid;gap:var(--s-3)}
    .embed figcaption{font-size:var(--fs-sm);line-height:1.5;color:var(--ink-3)}
    .embed__frame{position:relative;padding-top:56.25%;border-radius:var(--r-lg);overflow:hidden;background:var(--ink)}
    .embed__frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .embed audio{width:100%}
    .tags{display:flex;gap:var(--s-2);flex-wrap:wrap;margin-top:var(--s-6);padding-top:var(--s-5);border-top:1px solid var(--hairline)}
    .tags span{display:inline-flex;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;background:var(--bg-2);color:var(--ink-3);padding:3px 10px;border-radius:var(--r-pill);border:1px solid var(--hairline)}
    .tags .tag--stories{background:linear-gradient(135deg,rgba(201,131,125,0.18),rgba(201,131,125,0.04));color:var(--rose-deep);border-color:rgba(201,131,125,0.28)}
    .tags .tag--product{background:linear-gradient(135deg,rgba(224,120,80,0.18),rgba(224,120,80,0.04));color:var(--gold-deep);border-color:var(--border-gold)}
    .tags .tag--tips{background:linear-gradient(135deg,rgba(123,143,107,0.18),rgba(123,143,107,0.04));color:var(--sage-deep);border-color:rgba(123,143,107,0.28)}
    @media (max-width: 980px){.article-layout{grid-template-columns:1fr}.toc{position:static;order:-1}}
    @media (max-width: 640px){.post-shell{padding:100px var(--s-4) var(--s-7)}}
  </style>
</head>
<body>
  <nav class="nav" id="nav">
    <div class="container">
      <div class="nav__inner">
        <a href="/" class="nav__logo"><span class="nav__logo-text">Porizo</span></a>
        <div class="nav__links">
          <a href="/about" class="nav__link">About</a>
          <a href="/pricing" class="nav__link">Pricing</a>
          <a href="/blog" class="nav__link">Blog</a>
          <a href="/support" class="nav__link nav__link--secondary">Support</a>
        </div>
        <a href="/download" class="nav__cta">Get the app</a>
      </div>
    </div>
  </nav>

  <main class="post-shell">
    <a class="back" href="/blog"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.5 2.5L4 7l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Back to Blog</a>
    <div class="post-meta"><span>${escapeHtml(publishedDate)}</span>${post.author_name ? `<span>By ${escapeHtml(post.author_name)}</span>` : ""}<span>${escapeHtml(`${readingTimeMinutes} min read`)}</span></div>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="excerpt">${escapeHtml(post.excerpt)}</p>
    ${post.answer_summary ? `<section class="answer-box"><strong>Quick Answer</strong><div>${escapeHtml(post.answer_summary)}</div></section>` : ""}
    ${heroImage ? `<img class="hero" src="${escapeHtml(heroImage)}" alt="${escapeHtml(post.title)}">` : ""}
    <div class="article-layout">
      <div class="article-main">
        <article>${bodyHtml}</article>
        <div class="tags">${renderTagList(post.tags)}</div>
      </div>
      ${articleToc}
    </div>
  </main>

  <footer class="footer">
    <div class="container">
      <div class="footer__inner">
        <div class="footer__brand">
          <a href="/" class="nav__logo"><span class="nav__logo-text">Porizo</span></a>
          <p class="footer__tagline">Your moment, in a song.</p>
        </div>
        <div class="footer__col">
          <h4>Product</h4>
          <a href="/pricing">Pricing</a>
          <a href="/#how">How it works</a>
          <a href="/download">Download</a>
        </div>
        <div class="footer__col">
          <h4>Company</h4>
          <a href="/about">About</a>
          <a href="/blog">Blog</a>
          <a href="/support">Support</a>
        </div>
        <div class="footer__col">
          <h4>Legal</h4>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </div>
      </div>
      <div class="footer__bottom">
        <span>&copy; 2026 Porizo. All rights reserved.</span>
        <span>One song at a time.</span>
      </div>
    </div>
  </footer>

  <script>
    window.addEventListener('scroll', function () {
      var n = document.getElementById('nav');
      if (n) n.classList.toggle('scrolled', window.scrollY > 40);
    });
  </script>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderMarkdownToHtml,
  renderBlogIndexPage,
  renderBlogPostPage,
};
