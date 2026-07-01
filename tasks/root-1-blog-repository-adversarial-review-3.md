# Root 1 Blog CMS Repository — Adversarial Review 3

## Pass-3 verdict: P1 found, fixed before termination

Reviewer: parallel explorer agent, read-only.
Scope:
- `src/database/blog-repository.js`
- `src/services/blog-service.js`
- `src/routes/admin.js`
- `test/blog-service.test.js`
- `test/blog-repository.test.js`

Prior reviews:
- `tasks/root-1-blog-repository-adversarial-review-1.md`
- `tasks/root-1-blog-repository-adversarial-review-2.md`

Validation before review:
- `test/blog-repository.test.js test/blog-service.test.js`: 8 pass.
- `test/blog-cms-routes.test.js test/marketing-seo-pages.test.js`: 13 pass.
- `npm run lint`: pass.

## Findings

### P1 — Stale AI repair could overwrite an intervening admin edit

**Status:** fixed after review.
**Type:** VERIFIED.

Scenario: repair route reads a draft at revision N, spends time generating the
AI repair, and then calls `updatePost`. Another admin can edit the post while
repair generation is in flight. The stale AI repair would overwrite that human
edit and then review its own new revision.

Smallest fix applied:
- `BlogService.updatePost` accepts `expectedRevisionNumber` and rejects with
  `BLOG_POST_CHANGED` under the transaction lock if the current revision
  changed.
- Repair route captures the source revision before repair generation and passes
  it into `updatePost`.
- Added stale-repair regression coverage.
