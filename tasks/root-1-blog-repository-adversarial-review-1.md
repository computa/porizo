# Root 1 Blog CMS Repository — Adversarial Review 1

## Pass-1 verdict: P1 found, fixed before termination

Reviewer: parallel explorer agent, read-only.
Scope:
- `src/services/blog-service.js`
- `src/database/blog-repository.js`
- `src/routes/legal.js`
- `test/blog-service.test.js`
- `test/blog-cms-routes.test.js`
- `test/marketing-seo-pages.test.js`

Validation before review:
- `test/blog-service.test.js`: 2 pass.
- `test/blog-cms-routes.test.js test/marketing-seo-pages.test.js`: 13 pass.
- `npm run lint`: pass.

## Findings

### P1 — Review writes could partially commit on revision conflicts

**Status:** fixed after review.
**Type:** VERIFIED.

Scenario: two review saves race. One succeeds; the other fails on the
`UNIQUE(post_id, revision_number)` revision insert after already updating
`blog_posts.review_report_json` and inserting a `blog_review_runs` row.

Smallest fix applied:
- Blog CMS mutations now run through repository transactions.
- Mutation paths lock/read the row through `findRawPostByIdForUpdate`.
- Review status, review run, and revision snapshot are written in the same
  transaction.
- Added rollback regression coverage with an injected transactional repository.

### P2 — Imported posts with no revision snapshots wrote review run revision 0

**Status:** fixed after review.
**Type:** VERIFIED.

Scenario: a raw/imported `blog_posts` row with no `blog_post_revisions` produced
`blog_review_runs.revision_number = 0` on first review.

Smallest fix applied:
- Review run revision numbers are clamped to at least `1`.
- Added imported/no-revisions characterization coverage.

### P2 — Duplicate draft reuse only scanned the latest 100 drafts

**Status:** fixed after review.
**Type:** VERIFIED.

Scenario: an older duplicate draft outside the first 100 draft rows could remain
live or fail to be reused.

Smallest fix applied:
- Added uncapped repository draft lookup for duplicate detection.
- Added >100 draft characterization coverage.

### P3 — Postgres-style transaction adapter was under-characterized

**Status:** fixed after review.
**Type:** INFERRED.

Smallest fix applied:
- Added `test/blog-repository.test.js` proving transaction-scoped repositories
  use the transaction query adapter and preserve `FOR UPDATE` behavior.
