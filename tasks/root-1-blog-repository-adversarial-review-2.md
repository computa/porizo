# Root 1 Blog CMS Repository — Adversarial Review 2

## Pass-2 verdict: P1 found, fixed before termination

Reviewer: parallel explorer agent, read-only.
Scope:
- `src/database/blog-repository.js`
- `src/services/blog-service.js`
- `src/routes/admin.js`
- `src/routes/legal.js`
- `test/blog-service.test.js`
- `test/blog-repository.test.js`

Prior review:
- `tasks/root-1-blog-repository-adversarial-review-1.md`

Validation before review:
- `test/blog-repository.test.js test/blog-service.test.js`: 6 pass.
- `test/blog-cms-routes.test.js test/marketing-seo-pages.test.js`: 13 pass.
- `npm run lint`: pass.

## Findings

### P1 — Stale review report could approve newer content than was reviewed

**Status:** fixed after review.
**Type:** VERIFIED.

Scenario: an admin starts review at revision N. Another admin edits the post to
revision N+1 while editorial review is in flight. The stale review result could
then approve revision N+1 using a report generated from revision N.

Smallest fix applied:
- Repository post rows now expose `current_revision_number`.
- `BlogService.saveReviewResult` accepts `expectedRevisionNumber` and rejects
  with `BLOG_POST_CHANGED` under the transaction lock if the current revision
  changed.
- Admin review route captures the reviewed revision before editorial review and
  maps stale saves to `409 BLOG_POST_CHANGED`.
- Mutation return paths refetch after snapshot insertion so returned
  `current_revision_number` is accurate.
- Added stale-review regression coverage.

### P2 — Concurrent duplicate creates can still race without a persisted fingerprint

**Status:** deferred.
**Type:** INFERRED.

Scenario: two concurrent create requests for the same article body but different
slugs can both scan before either commits, then both insert. The uncapped
duplicate scan fixes deterministic and older-draft cases, but not the
cross-transaction no-match race.

Rationale for deferral: fixing this properly needs schema support such as a
draft fingerprint and partial unique index, or provider-specific advisory locks.
That is outside this movement-only repository slice.

### P3 — Non-transactional repository fallback could hide partial-commit risk

**Status:** fixed after review.
**Type:** VERIFIED.

Smallest fix applied:
- `BlogService` now requires `repository.transaction` for mutation paths.
- `blog-repository.transaction` fails loudly if the underlying DB adapter has no
  transaction support.
