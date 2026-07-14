# Porizo Marketing Pipelines — Source of Truth

**What this is:** the one file that says how Porizo marketing gets made. Six pipelines, three loops, one router skill (`$marketing` in Codex, `/marketing` in Claude Code). If you're about to do marketing work and you're not sure which tool, start here.

**Last verified:** 2026-07-10. Only commands explicitly labelled **Proven** were executed end to end; build-status rows distinguish working automation from documented/manual flows.

---

## Global constraint checklist (applies to ALL copy/creative)

- **No voice-cloning claims.** Porizo cannot deliver "a song in _your_ voice" yet. Never promise it (false promise + App Store rejection risk). The real wedge is speed + price + emotion: "instant, ~$9, sounds like a real song" vs Songfinch's $200 / 7-day.
- **Tagline:** "Song Gift Maker".
- **Share links are LIFETIME.** No "expires in N days" urgency — that's a dark pattern and factually wrong. Real urgency = first-to-claim device binding + permanent library ("Claim in the app to make it yours — keep it forever").
- **Video/reel audio:** ONE continuous ≥21s track, ducked under voiceover. Never clip-and-loop short segments.
- **Creator outreach:** rank by **median views** (last ~10 videos), not followers. TikTok DMs are blocked → reach via bio email or IG. Tag every outreach row with channel.

---

## Priorities first (read this before the loops)

Porizo's problem is **distribution, not production**: ~26 genuine users in ~98 days, and a viral loop where ~39 recipients converted to **0** new users. This doc used to lead with video/ads/blog — production capacity the funnel can't yet convert. Fixed. **The order below is the priority order.** In a bad week, do the top items and drop the bottom ones — that's the whole point of ranking them.

| Rank  | Pipeline                                 | Why it's here                                                                                                  | Effort            |
| ----- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------- |
| **0** | **Recipient conversion** (Pipeline 1)    | The diagnosed failure. 39 people already felt the payoff → 0 converted. Cheapest acquisition surface there is. | 1 hypothesis/week |
| **1** | **ASO** (Pipeline 4)                     | The one channel with a live #1 signal (US/AU/GB "birthday song gift" #1). `node` command, proven.              | ~5 min            |
| **2** | **Blog / programmatic SEO** (Pipeline 5) | Extends the #1 ASO keyword win into organic web search. Lowest-cost, highest-leverage content.                 | biweekly          |
| **3** | **Organic social** (Pipeline 6)          | Free top-of-funnel; creator seeding is cheaper to test than paid.                                              | batch             |
| **4** | **Video** (Pipeline 2)                   | Feeds the above; per-launch only.                                                                              | per-launch        |
| **5** | **Paid acquisition** (Pipeline 3)        | **DORMANT.** Meta ran at 5× target CPI on a non-converting funnel; TikTok has no proven winner to port.        | dormant           |

Low-cost one-time bets (do them, but they're not recurring pipelines): **Reddit** (occasion/relationship subreddits, genuine-comment playbook), **App Store editorial pitch** (a #1–2 niche gifting app is exactly Apple's featuring profile — an afternoon, asymmetric upside), **creator seeding** (free codes to 5–10 median-3k-view gifting creators).

## Build status — runnable TODAY vs not

Don't infer automation level from prose. This table is the truth:

| Capability           | Status                    | Note                                                                                                                  |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Recipient conversion | **PARTLY BUILT**          | Receiver events and `viral_loop_metrics` exist; recipient-to-creator cohorts and a weekly reporting surface do not.   |
| ASO                  | **RUNNABLE TODAY**        | `scripts/aso/*` proven 2026-07-10.                                                                                    |
| Meta ads (measure)   | **RUNNABLE TODAY**        | `scripts/ads/run.mjs` proven; publish via MCP/CLI is manual.                                                          |
| Video                | **RUNNABLE TODAY**        | Remotion proven.                                                                                                      |
| Blog                 | **RUNNABLE TODAY**        | `tools/blog-publish-production.js` runs create/review/repair/publish with CMS and Railway-remote modes.               |
| Social               | **RUNNABLE (needs keys)** | `tiktok-pipeline` CLI proven; full generation still needs `ANTHROPIC_API_KEY` + an image source.                      |
| — TikTok ads         | **NOT BUILT**             | Manual Ads Manager via browser-harness; runbook is a TODO.                                                            |
| — Instagram publish  | **NOT BUILT**             | Phase-2 glue; manual posting today.                                                                                   |
| Marketing router     | **BUILT** (2026-07-10)    | Tracked canonical router at `.agents/skills/marketing/SKILL.md`; tracked Claude compatibility router delegates to it. |

## Credentials — one table, with recovery

Each pipeline names its credential in passing; here they are together. Pattern (from `railway-auth`): validate live, don't trust "login succeeded."

| Pipeline           | Credential                                          | Lives                       | If dead                                                                   |
| ------------------ | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| Meta ads (measure) | token in `~/meta-ads/.env`                          | `run.mjs` reads it directly | run `meta` from `~/meta-ads/`; re-auth per that CLI                       |
| Meta ads (publish) | Meta Ads MCP session (primary)                      | in-session                  | falls back to `meta` CLI / Graph API — measurement still works via `.env` |
| ASO rank           | none                                                | —                           | `rank-track.mjs` always runs                                              |
| ASO review         | ASA v5 JWT (.pem)                                   | ASA key on disk             | only `review.mjs` needs it; `rank-track` unaffected                       |
| Blog publish       | admin Bearer session                                | admin dashboard login       | 401 → re-login to admin dashboard                                         |
| Social             | `ANTHROPIC_API_KEY` + image key (`FAL_KEY`/curated) | `~/.tiktok-pipeline/env`    | queue dir per-post is safe to resume; re-run the failed slug              |
| App Store submit   | `asc` CLI auth                                      | configured                  | use the iOS release workflow and verify ASC state before mutation         |

## The three loops (Claude-driven cadence — no cron)

Trigger via `$marketing` in Codex or `/marketing` in Claude Code. Every loop also lists raw commands so it works even if the router is unavailable.

| Loop                     | Trigger                                              | ~Time          | Contents                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Minimum week (floor)** | `/marketing weekly --min`                            | **~15 min**    | Two proven `node` commands only: `scripts/aso/rank-track.mjs` + `scripts/ads/run.mjs` (read the flags). The version that survives a bad week.                                                   |
| **Full Monday block**    | `/marketing weekly`                                  | **60–150 min** | The floor PLUS, in priority order, cutting from the bottom when short: 1 recipient-conversion hypothesis (Pipeline 1) · biweekly `review.mjs` · biweekly blog article · batch 3–6 social posts. |
| **Friday status**        | `/marketing status`                                  | ~15 min        | Roll up ranks / spend / installs / social median-views into one note; choose next week's briefs. Replaces the old gtm-daily/gtm-weekly rituals.                                                 |
| **Per-launch**           | `/marketing video` → `/marketing ads` / `tiktok-ads` | varies         | Produce a campaign video → creative chain → publish → measured in the next Friday status.                                                                                                       |

**Honest time note:** the old "~90 min" was fiction — it understated editorial authoring and zero-retry social generation. Real ranges: blog authoring/review 20–40 min (publishing is automated), 6 social posts 30–48 min, Meta apply 2–20 min. That's why the **floor is 15 min** and blog is biweekly.

**Friday `/marketing status` is the forcing function.** It doesn't just "roll up" — it diffs this week's ranks/spend/installs/median-views vs last week and prints a one-line verdict + action per pipeline ("ASO: NZ still weakest, unchanged 2wk → action?"). A loop only closes if this runs. A metric nobody reads is a warehouse, not a loop.

**Channel ledger: `marketing/CHANNELS.md`** — one section per channel (Google organic/ads, Meta, TikTok, App Store, ASA, Etsy, email, web funnel, recipient loop) with dated actions → results, next step, and kill/scale gate. Update it after EVERY channel action; Friday status reads it and appends the week's result rows. Google keyword/campaign work has its own skill: `/google-ads`.

### If you skip a week — what rots

| Pipeline                         | Skip impact                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meta ads (if ever un-paused)** | **MUST NOT SKIP silently.** `run.mjs` is recommend-only — no auto-pause; live spend bleeds with nobody watching. **Set a hard daily budget cap as the real backstop** before running paid at all; a doc warning won't stop money leaving while you sleep. |
| ASO                              | Safe — the 14-day guard just delays the next legal rerank.                                                                                                                                                                                                |
| Social                           | Queue empties, posting stops. Check `social/queue/` count. No other harm.                                                                                                                                                                                 |
| Blog                             | No harm, just no new article.                                                                                                                                                                                                                             |
| Recipient conversion             | No new hypothesis — but this is THE priority, so skipping means the actual problem goes unworked.                                                                                                                                                         |

> **Automation stance:** no new launchd/cron. Do not recreate the retired `co.porizo.ads-analyzer` or `co.porizo.cold-daily-send` agents. The follow-up inventory found no matching Porizo agents loaded; restore `co.porizo.audio-probe` only as an explicit production-health decision. **Staleness tripwire:** if this file's "Last verified" date is >14 days old, the ritual has lapsed — the marketing status route flags it.

---

## Repo layout

```
docs/marketing/PIPELINES.md            # this file — the index
marketing/
  appstore/aso/                        # LIVE ASO data (keywords.json, ranks/, spend-history/, snapshots/, audits/)
  appstore/metadata/                   # ASC metadata, versioned; 1.5.26 live
  appstore/screenshots/current/6.9/    # shipped Warm Canvas set
  remotion/                            # video factory (see Pipeline 2)
  briefs/                              # tracked brief template + YYYY-MM-DD-<pipeline>-<slug>.md briefs
  social/{queue,posted}/               # tracked queue contract + metrics.csv schema
  ads-campaign/                        # living creative inputs: brand-profile.json, Meta + TikTok concepts
  campaigns/                           # tiktok-pipeline campaign workdirs + seasonal packs (LIVE input — not clutter)
  product demo/ · audio hooks/         # reusable creative source pools (tiktok-pipeline reads by exact path)
  email-templates/                     # active nurture templates (untouched)
  email/                               # cold-email templates + audio-probe .state logs (LIVE — channel paused, dir is not)
  gtm/                                 # gtm-daily/weekly operating-system data (LIVE while those skills exist)
  archive/2026-07-consolidation/       # dead dirs moved here + ARCHIVE-MANIFEST.md
scripts/{aso,ads,seo}/                 # the mature script pipelines (unchanged)
.agents/skills/marketing/SKILL.md      # tracked router shared by clones
.claude/skills/marketing/SKILL.md      # tracked thin Claude compatibility router
```

Start each job from `marketing/briefs/BRIEF-TEMPLATE.md`, saved as `marketing/briefs/YYYY-MM-DD-<pipeline>-<slug>.md`. The template fixes the goal, audience, hook, constraints, mutation gate, attribution key, and decision rule before production. `marketing/social/README.md` defines the queue and measurement contract.

---

## Pipeline 1 — Recipient conversion (the viral loop) · TOP PRIORITY · PARTLY BUILT

**This is the diagnosed failure and it had no pipeline until now.** ~39 people received a finished song — they felt the emotional payoff, they know a real user — and **0** became users. That's a confirmed 0% funnel stage on the cheapest acquisition surface Porizo has. Every hour spent producing more top-of-funnel content is wasted while this stage sits at zero.

**Existing foundation:** `receiver_sessions` and `receiver_session_events` record link, CTA, handoff, app-open, and claim stages; `viral_loop_metrics` reports rolling receiver-to-registration rates. Do not create a second event system.

**Flow (finish this):** expose the existing funnel in an operator-facing weekly report → add the missing cohort from a matched recipient to their first create/share → establish a dated baseline → run **one hypothesis per week** on the claim page (CTA copy, a "make one for someone else" second CTA, incentive, timing of the follow-up) → read the conversion delta the next Friday.

**Why it leads:** it's not production, it's distribution — the exact thing the whole business is stuck on. A 1-hypothesis/week cadence is cheap and survives a bad week.

**Cadence:** one hypothesis in the Full Monday block (skip only if the week collapses). **Loop close:** recipient→signup rate in Friday status, tracked over weeks.

**Consultants:** the share/claim code (`src/services/share-service.js`, `app-link-service.js`, `attribution-service.js`), `referral-program`, `web-to-app-funnel`, `onboarding-optimization`. Note: share links are LIFETIME — the urgency is first-to-claim device binding + permanent library, never a fake expiry.

> **Build status: PARTLY BUILT.** Event capture and a rolling SQL view exist; the weekly report and recipient-to-creator cohort do not. Completing that reporting boundary is the highest-value factory work next, ahead of more ad/video/blog machinery.

---

## Pipeline 2 — Marketing video

**Renderer decision:** **Remotion is the sole renderer for produced brand video.** HeyGen (user-global `create-video`/`avatar-video`) is used only when a real human face is needed — as a clip source finished in Remotion, or posted raw via Pipeline 6. `tiktok-pipeline`'s compositor handles lo-fi UGC volume reels (Pipeline 6), not brand video.

**Flow:** brief → extend the **current** composition lineage (never V1/V2) → QA (contrast lessons: `textShadow`, 35–45% photo overlays, `remotion-best-practices` skill) → render → hand to paid acquisition (Pipeline 3) or organic social (Pipeline 6).

```bash
cd marketing/remotion
npx remotion compositions src/Root.tsx                 # list live comp IDs
npx remotion still  src/Root.tsx <Comp> out.png --frame=60   # cheap compile check
npx remotion render src/Root.tsx <Comp> out/<channel>/<date>-<comp>.mp4
```

**Current comp IDs** (verified — these differ from older doc names): `Ad-FathersDay-Product-Vertical`, `Ad-DriveHome-V5` (+ `-Landscape`), `Video1-RememberWhen-V3`, `Video2-SayItDifferent-V3`, `Video3-ThatSummer-V3`, `Product-Demo-Vertical`, `Complete-App-Walkthrough`. V1/V2 of each are superseded → archived to `remotion/src/_archive/`.

**Attribution:** embed the composition ID in the ad name so the Meta analyzer reports map back to source comps.

**Cadence:** per-launch only. **Loop close:** the comp's ad performance in the next Monday Meta report.

**Proven 2026-07-10:** `npx remotion compositions` bundles clean (34 comps); `npx remotion still Ad-FathersDay-Product-Vertical` rendered a 2.9 MB frame. ✓

**Consultants (skills):** `remotion-best-practices`, `app-preview-video`, `video-edit`, `video-understand`, HeyGen cluster.

---

## Pipeline 3 — Paid acquisition · DORMANT (measurement stays, spend paused)

> **Status: dormant by decision.** Last live Meta campaign ran at A$19.67 CPI — ~5× the A$4 target — on a sample too small to be significant (analyzer's own verdict: "HOLD, no winner"). Paid is a _scaling_ channel; you scale into a funnel that converts. Porizo's funnel has a confirmed 0% stage (Pipeline 1) and an undiagnosed ASO→registration step. **Re-enter paid only after** Pipeline 1 shows >0% recipient conversion AND the ASO→registration funnel is understood. Until then: keep the analyzer running so no live spend ever goes unwatched, but don't originate new campaigns. **Before any un-pause, set a hard daily budget cap** — that's the real backstop, not a doc note.

**Creative chain (when re-activated):** reuse `marketing/ads-campaign/brand-profile.json` (don't re-run `ads-dna`) → `ads-create` (campaign-brief.md via creative-strategist + copy-writer agents) → statics via `ads-generate`/`ads-photoshoot` (visual-designer), video from Pipeline 2 → `format-adapter` (spec compliance → format-report.md).

**Publish:** **Meta Ads MCP is the primary path** (verified working in-session — see below), with the `meta` CLI (`~/meta-ads/.env`) / Graph API as fallback. SKAN rule: `promoted_object` at **campaign AND adset** level (campaign one is immutable — recreate the campaign if missing). Keep the human-in-the-loop posture: review before applying.

**Measure:**

```bash
node -r dotenv/config scripts/ads/run.mjs dotenv_config_path=$HOME/meta-ads/.env
# pull(Insights) → store → evaluate(deterministic rules) → narrate(LLM) → report.md + dashboard.html
# RECOMMEND-ONLY: never mutates the account; prints the exact apply commands.
```

**Cadence (while dormant):** run the analyzer in the minimum-week floor purely as a spend-watchdog (it's a 5-second `node` command). No Thursday check, no apply cycle — there's nothing live to tune. When re-activated: analyzer top-of-block + Thursday check while spend is live; quarterly `ads-meta` audit. **Loop close:** the analyzer's ranked recommendations → you apply → next report measures the effect.

**Proven 2026-07-10:** `scripts/ads/run.mjs` ran full pull→evaluate→narrate→report on the live Father's-Day campaign (correctly diagnosed: paused, 10 installs / A$19.67 CPI, below significance floor → HOLD, no winner). Meta MCP `ads_get_ad_accounts` returned live account `29474028` (Acuoos Pty Ltd, mcp-enabled + queryable). ✓

> **Correction to prior memory:** the note "Meta official Ads MCP can't OAuth via Claude Code CLI" is **no longer true in this session** — the MCP tools work. `meta` CLI is now the fallback, not the only path.

**Consultants:** `ads-meta`, `ads-create`, `ads-generate`, `ads-photoshoot`, `ads-budget`, `audit-meta`, `audit-tracking`, `audit-budget`, `audit-creative`.

---

### TikTok ads (folded into Pipeline 3 — dormant, not standalone)

Not a separate pipeline: it's blocked on a precondition that has never fired — "port a Meta-proven winner" — and Meta itself is dormant with no winner. Keeping it as a co-equal numbered pipeline created the illusion of a working second paid channel. So: **dormant-by-design.** When (if) a Meta winner emerges AND paid is re-activated, port it here — same creative chain, TikTok 9:16 specs, `tiktok-pipeline` UGC reels (platform-native beats polish; 21s-one-track rule), QA against the `ads-tiktok` audit rubric, publish manually in Ads Manager via browser-harness. The TikTok Marketing API (approved dev app) is deferred until TikTok would exceed ~30% of paid budget. **The browser-harness apply runbook is a TODO — not written yet** (see Build status).

**Stale-gate:** if no Meta winner exists after ~6 weeks of re-activated paid, either lower the "winner" bar (port the best creative even without significance) or leave this dormant — do not let it sit as a permanent someday-item in the weekly checklist.

---

## Pipeline 4 — Apple Ads / ASO

**The most mature pipeline. Don't reinvent it.**

**Flow:**

```bash
node scripts/aso/rank-track.mjs           # live iTunes-Search ranks per storefront → ranks/ + history.csv
node scripts/aso/review.mjs --note "..."  # weekly orchestrator: ASA pull → rerank → lane comparison → spend dashboard
node scripts/aso/acquisition-report.mjs   # ASC analytics access/report-request gate; fails loudly on missing role
node scripts/aso/cpp-audit.mjs            # compare the canonical five-page CPP manifest with live ASC
#   (refuses rerank on <14-day window; --skip-asa/--skip-rerank/--force-short-window-rerank/--asc/--external)
node scripts/aso/apply-<x>.mjs --execute  # the ONLY scripts that WRITE to ASA. Dry-run by default.
```

`keywords.json` is the source of truth; every rerank writes a dated snapshot. **Tool ranks are estimates — live truth comes only from `rank-track.mjs`.** App Store submissions use `asc` CLI (numeric app ID `6758205028`) + fastlane metadata; follow `porizo-swiftui-release-workflow` and the distribution checklist before submission.

**Cadence:** Monday — `rank-track`, `acquisition-report`, and `cpp-audit` weekly; full `review` bi-weekly (the 14-day guard enforces the cadence). **Loop close:** App Store Search/Browse impressions → product-page views → first-time downloads, plus `ranks/history.csv` and the spend dashboard. A permission failure is a blocked measurement system, never a zero-result week.

**Proven 2026-07-10:** `rank-track.mjs` pulled live ranks across 5 storefronts — US "birthday song gift" #1, AU #1, GB #1, US "anniversary song gift" #2; NZ weakest (matches the 2026-07-07 rank-regression audit). ✓

**Consultants:** `porizo-aso-review`, `apple-search-ads`, `keyword-research`, `seasonal-aso`, `metadata-optimization`, `aso-audit`, and `screenshot-optimization`.

---

## Pipeline 5 — Blog

**Publish target: the live backend blog platform (DB-authored via admin API). VERIFIED.** Published posts are `blog_posts` rows created only through `/admin/dashboard/blog/posts/*`; served as server-rendered HTML at `porizo.co/blog/:slug`. **The 24 files in `marketing/blog/*.md` feed nothing** — no code reads that dir → they're drafts/archive, not source of truth.

**Publish flow (a status machine with a hard, code-enforced review gate):**

```
draft → review → approved | rejected → published
```

| Step             | Endpoint (admin Bearer auth)                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create draft     | `POST /admin/dashboard/blog/posts` (title, slug, body_markdown)                                                                                        |
| Derive metadata  | `POST /admin/dashboard/blog/posts/autofill` (needs body_markdown; heuristic, no LLM)                                                                   |
| Review (gate)    | `POST /admin/dashboard/blog/posts/:id/review` — deterministic SEO/GEO/AEO scorer; `approved` iff zero blockers. LLM editorial review is advisory only. |
| Repair on reject | `POST /admin/dashboard/blog/posts/:id/repair` (LLM rewrites the failing draft, re-reviews)                                                             |
| Publish          | `POST /admin/dashboard/blog/posts/:id/publish` — throws if not `approved`                                                                              |

**Content generation and publishing are separate concerns.** `marketing-writer` produces the article body. The tracked production tool then owns CMS persistence, metadata, review/repair, publish, and post-write verification:

```bash
npm run blog:login
npm run blog:publish -- --article-file marketing/briefs/<article>.md --dry-run
# Remove --dry-run only after reviewing the report and explicitly choosing to publish.
npm run blog:publish -- --article-file marketing/briefs/<article>.md
node scripts/seo/submit-indexnow.mjs
```

If direct CMS auth is unavailable, use the tool's first-class `--railway-remote` mode rather than assuming the local shell can reach the production database. The publish tool verifies the saved article body before reporting success.

**Programmatic SEO is the high-leverage half — not a footnote.** Porizo already ranks #1 on the App Store for the exact gifting keywords; `node scripts/seo/build-programmatic-pages.mjs` (gifts/[slug] pages + sitemap) → `submit-indexnow.mjs` extends that same keyword win into organic _web_ search at near-zero marginal cost. Refresh the page set whenever occasions/keywords shift (roughly monthly, not "quarterly footnote").

**Cadence:** **biweekly** article (not weekly — matches the ASO `review.mjs` cadence). Cut this first in a short week. **Loop close:** submit IndexNow after publish, then surface monthly Search Console rankings in Friday status.

**Consultants:** `marketing-writer`, `scripts/seo/`; backend `blog-*-service.js` (prod — do not touch).

**Proven 2026-07-10 review:** the production publisher is wired through package scripts (`blog:login`, `blog:inspect`, `blog:publish`) and covered by `test/blog-publish-production.test.js`. This consolidation did not publish a new production article; that remains an explicit content operation, not a harmless pressure test.

---

## Pipeline 6 — TikTok + Instagram organic posts

**Flow:** brief → `tiktok-pipeline` skill for volume (brief → slides/hooks/captions → slideshow carousels + Hook/Demo UGC reels) OR Remotion `out/{tiktok,instagram}` for hero posts → **post-package convention**: each post lands in `marketing/social/queue/YYYY-MM-DD-<slug>/` containing the video + `caption.txt` (caption / hashtags / cover note) → founder posts from phone → move the dir to `marketing/social/posted/`.

```bash
# tiktok-pipeline runs as a module from the skill dir:
cd ~/.claude/skills && python3 -m tiktok-pipeline.scripts.slideshow <campaign> --hook "..." --image-source curated --project-root /path/to/porizo
# needs ANTHROPIC_API_KEY (slide copy) + an image source; ffmpeg for compose. stdlib-only otherwise.
```

**Publishing:** TikTok stays manual by design (no self-serve API without an audited app); the queue makes it a 2-min phone task. Instagram: `ads_get_ig_accounts` is available via the connected Meta MCP and Graph API supports `instagram_content_publish` on the business account — **phase-2 glue, build only if manual posting proves to be the real bottleneck.**

**Cadence:** batch 3–6 in the Monday block, post through the week. **Loop close:** Friday logs **median views** → `marketing/social/metrics.csv` → feeds the next brief. Creator outreach continues off `channels/creator-outreach.csv` (email/IG only).

**Proven 2026-07-10:** `tiktok-pipeline` modules (slideshow/ugc_reel/compose/llm/audio_cut) load standalone; argparse CLI wired; stdlib + ffmpeg only (no fragile pip deps). Self-contained → the old `tiktok-trial/` A/B dir is redundant. ✓ (A full render needs `ANTHROPIC_API_KEY` + brief — not a free dry-run.)

**Consultants:** `tiktok-pipeline`, `creator-ugc-marketing`, `video-download`, social brand assets in `marketing/social/`.

---

## Email — adjudicated, NOT a pipeline

`email-templates/` + the `share-followups-daily` Railway job are the **healthiest loop in the system** — left untouched. **Cold email stays PAUSED** (2284 sent → 4 clicks → 0 registrations; do not resume without a fresh verified list + new angle). Both runtime directories remain in place: `marketing/emails/` supplies the three admin-dashboard nurture previews, while `marketing/email/` supplies cold-email templates and probe state. Only supplemental outreach files and the private historical list moved to archive.

---

## Entry point — the marketing router

`.agents/skills/marketing/SKILL.md` is the tracked canonical dispatcher. The tracked `.claude/skills/marketing/SKILL.md` compatibility skill exposes the same routes in Claude Code and delegates to the canonical file instead of copying its logic.

| Subcommand              | Does                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `/marketing weekly`     | Minimum floor, then Pipeline 1, Pipeline 4, Pipeline 5, and Pipeline 6 in priority order. |
| `/marketing status`     | The Friday roll-up.                                                                       |
| `/marketing aso`        | Pipeline 4.                                                                               |
| `/marketing recipient`  | Pipeline 1.                                                                               |
| `/marketing ads`        | Pipeline 3 (Meta).                                                                        |
| `/marketing tiktok-ads` | Pipeline 3 (TikTok subsection).                                                           |
| `/marketing video`      | Pipeline 2.                                                                               |
| `/marketing blog`       | Pipeline 5.                                                                               |
| `/marketing social`     | Pipeline 6.                                                                               |

It does no work itself — it dispatches to the pipeline's canonical commands + consultant skills above. This collapses ~55 marketing skills into one thing to remember.

---

## Cleanup / consolidation

Full archive manifest: `marketing/archive/2026-07-consolidation/ARCHIVE-MANIFEST.md` (written during execution). Principle: **archive = move, never delete** (one exception: regenerable `node_modules`, only with explicit user yes).

**MANDATORY pre-move gate (the ENOENT lesson).** Before archiving ANY path, grep for live references and paste the result into the manifest:

```bash
rg -n "marketing/(tiktok-trial|reelfarm|audio hooks|product demo|scripts|gtm|campaigns|emails)(/|\\b)" \
  scripts src test docs package.json eslint.config.mjs .agents .claude \
  --glob '!marketing/archive/**' --glob '!**/node_modules/**'
```

Literal grep is not sufficient for paths assembled with `path.join` or config fragments. Also search the target basename, inspect path-construction call sites, and run a focused consumer test after every move. For runtime template paths, the required smoke test is `test/admin-marketing-routes.test.js`.

This check protects three runtime directories on 2026-07-10:

- **`marketing/email/` — NOT archived.** Load-bearing: `src/routes/admin/marketing.js:282` reads its templates; `import-cold-email-list.js`/`test-cold-email-send.js` read `cold-intro.*` + `.state/cold-list.tsv`; the **kept** `co.porizo.audio-probe` plist logs into `marketing/email/.state/runs/`.
- **`marketing/emails/` — runtime templates retained.** `src/routes/admin/marketing.js:259` reads the three allowlisted HTML files for admin previews. Supplemental campaign notes moved; the allowlisted files did not.
- **`marketing/ads-analytics/` — NOT archived.** `scripts/ads/store.mjs:10` + `dashboard.mjs` write here every analyzer run.

**Archived 2026-07-10:** `tiktok-trial` (160 MB), `reelfarm`, `marketing/scripts` (Mar-17), `appstore/screenshots/archive` (stale generations), and supplemental files formerly beside `marketing/emails/`. The three runtime HTML templates remain at `marketing/emails/`. Heavy/generated payloads and recipient data are local-only and ignored; the manifest and non-personal supplemental files are tracked. See the manifest for retention and revival rules.

**Post-review keep set — do NOT archive** (looked stale, are live): `marketing/email/` and `marketing/emails/` (runtime template paths), `marketing/ads-analytics/` (analyzer output dir), `marketing/product demo/` + `marketing/audio hooks/` + `marketing/campaigns/` (live `tiktok-pipeline` input pools — `audio_cut.py` reads them by exact path), `marketing/gtm/` incl. `L2-content-engine/` (read by the `gtm-daily`/`gtm-weekly` skills). The original literal grep missed `marketing/emails/`; the focused route test is now mandatory.

**Not touched (deferred):** Remotion V1/V2 comps stay — they're `<Composition>`-registered in `Root.tsx`; archiving them is a code change, not a move. The 2 duplicate screenshot generators + their node_modules (~280 MB) left in place per owner decision.

**Schedulers:** none of `co.porizo.ads-analyzer`, `co.porizo.cold-daily-send`, or `co.porizo.audio-probe` appeared in the 2026-07-10 `launchctl list` review. Do not recreate the first two. If the audio probe is intentionally restored, keep its `marketing/email/.state/runs/` path stable.
