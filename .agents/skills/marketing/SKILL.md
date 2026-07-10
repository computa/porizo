---
name: marketing
description: Route Porizo marketing work through the six canonical produce-publish-measure pipelines and weekly/status loops. Use for marketing weekly, marketing status, recipient conversion, ASO, blog, social, video, Meta ads, or TikTok ads work.
user-invocable: true
---

# Porizo marketing router

Read `docs/marketing/PIPELINES.md` before acting. It is the source of truth for priorities, commands, credentials, build status, and copy constraints. This skill chooses a route; it does not duplicate pipeline implementation.

## Routes

| Argument | Route |
| --- | --- |
| `weekly [--min]` | Weekly operating loop |
| `status` | Friday measurement and next-action roll-up |
| `recipient` | Pipeline 1: recipient conversion |
| `video` | Pipeline 2: marketing video |
| `ads` | Pipeline 3: Meta paid acquisition |
| `tiktok-ads` | Pipeline 3: TikTok paid subsection |
| `aso` | Pipeline 4: Apple Ads and ASO |
| `blog` | Pipeline 5: blog and programmatic SEO |
| `social` | Pipeline 6: TikTok and Instagram organic |

When the argument is absent or unclear, print this table and ask which route to run.

## Execution rules

1. Apply the global constraint checklist in `PIPELINES.md` to every asset and piece of copy.
2. Run only commands the selected section marks runnable. State manual or unbuilt steps plainly.
3. Confirm required credentials before a credentialed step. Never print secret values.
4. Preserve dry-run defaults. Paid-media mutations, App Store mutations, production publishing, and outbound messages require explicit user authorization.
5. Complete the selected pipeline's measurement step. Producing an asset without recording its outcome does not close the loop.

## Weekly loop

First check the `Last verified` date. If it is more than 14 days old, report the stale operating contract before running anything.

For `weekly --min`:

1. Run the ASO rank tracker.
2. Run the Meta analyzer as a spend watchdog only. If any campaign is active, verify a hard daily cap before recommending continued spend.

For full `weekly`, run the minimum floor, then:

1. Pipeline 1: execute one recipient-conversion hypothesis only when the existing receiver metrics have a dated baseline and the weekly report can measure the result. Otherwise report the missing recipient-to-creator cohort/reporting task and do not create duplicate instrumentation.
2. Pipeline 4: run the guarded ASO review when its 14-day window permits.
3. Pipeline 5: prepare one biweekly article and use the tracked blog publisher in dry-run mode before any explicit production publish.
4. Pipeline 6: prepare 3-6 organic posts when credentials and source assets are available.

Do not originate Meta or TikTok paid campaigns while Pipeline 3 is dormant.

## Status loop

Compare the current week with the prior recorded week for recipient conversion, ASO ranks, paid spend and installs, blog search performance when available, and social median views. Emit one verdict and one next action per pipeline. Missing data is a tracking gap, not a zero.
