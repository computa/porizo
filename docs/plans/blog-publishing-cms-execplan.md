# Build Blog Publishing CMS With SEO/GEO Review Gate

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo needs a real publishing system, not a static `/blog` placeholder. After this work, Ambrose should be able to create a blog post in the admin dashboard, save it as a draft, run an automated SEO/GEO/AEO review, see approval or rejection plus concrete recommendations, and publish the post to a real `/blog/:slug` page. The public blog index must list published posts dynamically, and every published post must expose usable SEO metadata and article structure.

The system must serve both search engine optimization (SEO) and generative engine optimization (GEO, including answer-engine optimization or AEO). In plain language: posts should be easy for search engines to index and rank, and also easy for LLM-powered answer engines to understand, quote, and retrieve.

## Progress

- [x] (2026-04-07 09:05 AWST) Reviewed existing backend, admin dashboard, static blog page, and database migrations. Confirmed there is no current blog CMS.
- [x] (2026-04-07 09:15 AWST) Authored this ExecPlan and locked the MVP scope to a markdown-first internal CMS with deterministic review and human-controlled publish flow.
- [x] (2026-04-07 11:35 AWST) Added database tables and backend services for blog posts, revisions, reviews, and public rendering.
- [x] (2026-04-07 11:50 AWST) Added admin dashboard blog listing, editing, review, preview, and publish controls; wired the page into the router and sidebar.
- [x] (2026-04-07 12:00 AWST) Replaced static `/blog` handling with dynamic listing and dynamic `/blog/:slug` pages; dynamic sitemap entries now include published blog slugs.
- [x] (2026-04-07 12:10 AWST) Added backend tests for review logic and admin/public blog routes, including the publish-review lifecycle.
- [x] (2026-04-07 12:30 AWST) Ran `npm test`, `npm run lint`, `cd admin && npm run lint`, and `cd admin && npm run build`; all passed. Admin build still emits existing non-blocking CSS import order and chunk-size warnings.

## Surprises & Discoveries

- Observation: the current `/blog` route is a static page served from `public/blog/index.html`, and the article cards only log placeholder navigation.
  Evidence: `src/routes/legal.js` serves `public/blog/index.html`, and `public/blog/index.html` contains `console.log('Navigate to article')`.

- Observation: the admin dashboard already has a marketing subsystem, but it is outbound campaign tooling only.
  Evidence: `src/routes/admin.js` defines contacts, campaigns, email template preview, and GMass import/export endpoints, but no article/post endpoints or blog UI routes.

- Observation: admin lint had pre-existing failures unrelated to the blog work.
  Evidence: `admin/src/pages/billing/PlansTab.tsx`, `admin/src/pages/marketing/CampaignTrackerTab.tsx`, and `admin/src/pages/marketing/LeadListTab.tsx` failed before implementation and were fixed as part of repo-health enforcement.

## Decision Log

- Decision: build the CMS inside the existing backend and admin dashboard instead of adopting an external CMS.
  Rationale: the hard requirement is not generic content storage; it is a review-gated publish workflow integrated with existing admin auth, audit logging, and public routing.
  Date/Author: 2026-04-07 / Codex

- Decision: use markdown-first authoring instead of a rich text editor.
  Rationale: markdown is simpler, easier to diff, easier to validate, easier to render safely, and sufficient for SEO/GEO long-form publishing.
  Date/Author: 2026-04-07 / Codex

- Decision: start with deterministic SEO/GEO/AEO review rather than LLM-only review.
  Rationale: deterministic checks are cheaper, explainable, and stable. They can approve, soft-fail, or reject with concrete recommendations. LLM editorial review can be layered later without making the core gate flaky.
  Date/Author: 2026-04-07 / Codex

- Decision: store review reports in the database and block publish when hard blockers remain.
  Rationale: the review gate must be auditable and operationally legible; publish decisions should not depend on transient front-end state.
  Date/Author: 2026-04-07 / Codex

## Outcomes & Retrospective

Delivered a real internal publishing system instead of a static placeholder. The backend now owns blog post CRUD, revision snapshots, deterministic SEO/GEO/AEO review, publish/unpublish workflow, public article rendering, and dynamic sitemap entries. The admin dashboard now exposes a single-screen markdown-first editor with search, save draft, preview, review, and publish controls.

The most important implementation correction during the work was lifecycle safety: editing a published article now returns it to draft, clears the prior review, removes it from public routes, and forces a new review before republishing. That is the right behavior for SEO/GEO publishing, because otherwise public content can drift away from the approved review report.

The current MVP is intentionally deterministic. It does not yet include LLM editorial review or automatic rewriting. That is a deliberate first version choice: the review gate is now cheap, stable, explainable, and auditable. The next worthwhile layer would be optional editorial suggestions from an LLM, but not as the sole publish gate.

## Context and Orientation

The current public website is served from static HTML files in `public/`, with lightweight route wrappers in `src/routes/legal.js`. The admin dashboard is a React + TypeScript Vite app in `admin/`, served from `/admin` by `src/server.js`. Admin API routes live in `src/routes/admin.js` and already have session-based admin auth and audit logging.

The current marketing subsystem uses `marketing_contacts`, `marketing_campaigns`, and `marketing_engagements`, created in `migrations/069_marketing_tables.sql` and `migrations/070_d2c_contacts.sql`. There is no current notion of `blog_posts`, article slugs, article revisions, or publish lifecycle.

The term “GEO” here means optimizing content so generative systems can identify, retrieve, and quote it correctly. “AEO” means optimizing for answer-engine style retrieval by making the article explicit, direct, and easy to summarize. In this implementation, GEO/AEO will be represented by deterministic content checks such as direct answer summary, heading structure, scannability, FAQ presence, and citation/link quality.

## Plan of Work

The first milestone is backend foundation. Add SQLite and PostgreSQL migrations for `blog_posts`, `blog_post_revisions`, and `blog_review_runs`. Then add a blog service and a review service. The blog service owns CRUD, revision snapshots, review persistence, and publish/unpublish state. The review service owns deterministic SEO/GEO/AEO scoring and recommendation generation.

The second milestone is routing. Add admin blog endpoints for list, create, update, preview, review, publish, and unpublish. Add public routes for `/blog` and `/blog/:slug`, then remove `/blog` ownership from the static legal route. Public pages should render server-generated HTML with canonical tags, article metadata, Open Graph tags, and JSON-LD.

The third milestone is the admin UI. Add a Blog page to the sidebar and router. The UI should include a list of posts, an editor form, markdown body authoring, save draft, run review, publish/unpublish, and a review panel with blockers, recommendations, and score breakdown. Keep the interaction model simple: one screen, one editor, one review panel.

The fourth milestone is validation. Add backend tests for review logic and route behavior. Re-run the full backend test suite and admin lint/build. Fix every failure before stopping.

## Concrete Steps

All commands are run from `/Users/ao/Documents/projects/porizo` unless otherwise noted.

1. Add migrations:

   - Create `migrations/077_blog_cms.sql`
   - Create `migrations/pg/077_blog_cms.sql`

2. Add backend services and route module:

   - Create `src/services/blog-review-service.js`
   - Create `src/services/blog-service.js`
   - Create `src/routes/blog.js`
   - Update `src/server.js`
   - Update `src/routes/legal.js`

3. Add admin UI:

   - Create `admin/src/pages/Blog.tsx`
   - Update `admin/src/App.tsx`
   - Update `admin/src/components/Sidebar.tsx`

4. Add tests:

   - Create `test/blog-review-service.test.js`
   - Create `test/blog-routes.test.js`

5. Validate:

   - `npm test`
   - `cd admin && npm run lint`
   - `cd admin && npm run build`

Expected success evidence:

   - `npm test` ends with `343+` tests passed and `0 fail` (the exact total may increase after adding new tests).
   - `cd admin && npm run lint` exits `0`.
   - `cd admin && npm run build` exits `0`; warnings are acceptable only if non-blocking and explicitly called out.

## Validation and Acceptance

Acceptance is behavioral:

1. An admin can open `/admin`, navigate to a new Blog page, create a draft post, save it, and see it in the list.
2. The admin can run review and receive:
   - SEO score
   - GEO score
   - AEO score
   - overall decision
   - blockers
   - recommendations
3. A rejected post cannot be published.
4. An approved post can be published.
5. `/blog` shows published posts dynamically.
6. `/blog/:slug` renders the published article with meta description, canonical link, Open Graph tags, and JSON-LD.

Test acceptance should include at least:

   - review rejects a thin post without summary/headings/keyword coverage
   - review approves a sufficiently structured post
   - unpublished posts are not visible publicly
   - published posts are visible by slug

## Idempotence and Recovery

The migrations must be additive and safe to rerun through the existing migration runner. The admin/editor implementation should write revision snapshots instead of destructive overwrites, so content can be edited repeatedly without losing prior state. If public route wiring fails, the safe recovery path is to restore `/blog` ownership to `src/routes/legal.js` and leave the admin CMS endpoints disabled until fixed.

## Artifacts and Notes

The most important artifact is the review report shape. It must remain small, explicit, and stable enough to render directly in the admin UI. The target shape is:

    {
      decision: "approved" | "rejected",
      overallScore: 0-100,
      seoScore: 0-100,
      geoScore: 0-100,
      aeoScore: 0-100,
      blockers: [{ code, message, recommendation }],
      recommendations: [{ category, severity, message, recommendation }],
      metrics: { wordCount, headingCount, internalLinkCount, externalLinkCount, faqCount }
    }

The public post metadata should include:

    title
    slug
    excerpt
    answer_summary
    primary_keyword
    body_markdown
    hero_image_url
    author_name
    tags_json
    review_status
    review_report_json
    status
    published_at

## Interfaces and Dependencies

The backend continues to use the existing database adapter abstraction, which exposes `prepare().run/get/all` and works for both SQLite and PostgreSQL through repository-specific migrations. New code should follow that style.

Do not add a heavyweight CMS dependency. Do not add a rich text editor. Do not add a markdown parser dependency unless the implementation proves a minimal in-repo renderer is insufficient. Prefer a small local markdown renderer with HTML escaping and a constrained supported syntax subset.

The admin app continues to use:

   - React 19
   - React Router
   - the existing `useApi` hook

The public blog pages should be rendered server-side in route handlers rather than by adding another front-end application. That keeps the system simpler and makes the SEO/GEO output explicit and inspectable.

## Revision Note

Initial version created on 2026-04-07 to implement a minimal but real publishing CMS focused on SEO and GEO outcomes rather than generic content management.
