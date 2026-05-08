# Blog Cannibalization Fix — Plan

**Status:** READY TO EXECUTE — needs GSC data confirmation (1 query) before redirects
**Risk:** Low if executed in the order below; can lose existing rankings if reversed

---

## The problem

5 of the 9 blog posts target near-identical "why personalized song gift means / is better / hits harder" intent. Google picks one and demotes the others (keyword cannibalization).

**The 5 competing posts:**

1. `/blog/why-personalized-song-gift-means-more-than-physical-present` — first published, longest title
2. `/blog/why-personalized-song-gift-is-better` — broadest claim
3. `/blog/why-personalized-song-gift-hits-harder-than-any-present` — emotional angle
4. `/blog/why-a-personalized-song-gift-means-more-than-a-card` — card-specific comparison
5. `/blog/why-a-personalized-song-is-the-best-fathers-day-gift-for-dad` — Father's Day specific

The remaining 4 posts (kept as-is, distinct intent):

- `/blog/personalized-song-gift-ideas` — "ideas to give one"
- `/blog/how-to-give-personalized-song-gift` — "how-to"
- `/blog/how-to-communicate-better-in-a-relationship` — relationship adjacent
- `/blog/fathers-day-song-gift-personalized` — Father's Day specific (kept; complements #5 above)

---

## The decision tree

### Step 1 — Pull GSC data (5 minutes, before any redirect)

```
Google Search Console → Performance → Pages
Filter: page contains "/blog/why-"
Date range: last 90 days
Export: clicks, impressions, CTR, position per URL
```

### Step 2 — Pick the canonical post

Rule: keep the post with the highest **impressions** (not clicks — impressions reflect ranking surface area for the cluster). Among ties, keep the one with the lowest average **position**.

Most likely canonical (educated guess pre-GSC): post #1 or #3 (the ones with the most distinctive titles).

### Step 3 — Decide redirect targets

Of the 4 non-canonical posts, classify each:

- **Subset of the canonical's intent** → 301 redirect to canonical
- **Distinct intent** that should be re-titled to avoid overlap → keep, but rewrite the title and intro to clearly differentiate
- **Father's Day-specific** (post #5) → keep as Father's Day evergreen; it's already differentiated by occasion

### Step 4 — Execute redirects

Two options for execution:

**Option A — DB level (preferred):**
Mark the non-canonical blog posts as `status='redirected_to'` with a `redirect_target_slug` column, and have the blog route emit a 301 when status is `redirected_to`. Requires a small schema migration and a route update.

**Option B — Route level (faster, no schema change):**
Add explicit 301 redirects to `src/routes/blog.js` keyed by slug. Less elegant but ships in 10 minutes.

---

## SQL for Option A (when ready to execute)

```sql
-- Migration (one-time):
ALTER TABLE blog_posts
  ADD COLUMN redirect_target_slug TEXT,
  ADD COLUMN status_check CHECK (status IN ('draft','published','redirected','archived'));

-- After picking canonical (replace <CANONICAL_SLUG>):
UPDATE blog_posts SET status='redirected', redirect_target_slug='<CANONICAL_SLUG>'
  WHERE slug IN (
    'why-personalized-song-gift-is-better',
    'why-personalized-song-gift-hits-harder-than-any-present',
    'why-a-personalized-song-gift-means-more-than-a-card'
  );
```

## Route handler update for Option A

In `src/routes/blog.js`, when serving a slug:

```js
const post = await db
  .prepare(
    `SELECT slug, status, redirect_target_slug FROM blog_posts WHERE slug = ?`,
  )
  .get(slug);

if (post?.status === "redirected" && post.redirect_target_slug) {
  return reply.redirect(301, `/blog/${post.redirect_target_slug}`);
}
```

---

## Sitemap impact

Sitemap is auto-generated from `WHERE status='published'`. Redirected posts will drop out automatically — no manual sitemap edit needed.

---

## Verification (after deploy)

```bash
# Each redirected URL should 301 to canonical:
curl -sI https://porizo.co/blog/why-personalized-song-gift-is-better | grep -i "^location\|^http"
# Expected: HTTP/2 301 ... Location: /blog/<canonical-slug>
```

In GSC, after 4–8 weeks:

- Canonical post should accumulate impressions/clicks of the cluster
- 301'd URLs should drop from index
- Total cluster organic clicks should rise (less Google indecision)

---

## Why this isn't shipped today

This fix needs **GSC data** to choose the canonical post safely. Picking blind risks 301'ing the post that was actually ranking. The fix is fully written above; it needs ~5 minutes of GSC export + 1 SQL run + 1 route patch.

If GSC data shows none of the 5 are ranking meaningfully (all <50 impressions/30 days), execute the simpler version: 301 all 4 to post #1 (the longest, most-targeted title) and move on.
