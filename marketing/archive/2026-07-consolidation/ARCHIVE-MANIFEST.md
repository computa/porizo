# Archive Manifest — 2026-07 Marketing Consolidation

Moved here on 2026-07-10 during the marketing-pipeline streamlining (see `docs/marketing/PIPELINES.md`).

**Two retention classes:** the manifest and non-personal email templates are Git-tracked. Heavy generated media, dependencies, and historical recipient data are local-only and ignored. Local-only means recoverable on this Mac with `mv`, but not protected by Git or available in another clone.

Historical recipient CSVs contain personal data. They must remain ignored and must never be committed, copied into agent prompts, or reused without source and consent validation.

## Pre-move safety gate (the ENOENT lesson)

The original cleanup used this literal-reference check before moving paths:

```bash
rg -n "marketing/<target>" scripts src test docs package.json eslint.config.mjs .agents .claude ~/.claude/skills/tiktok-pipeline \
  --glob '!marketing/archive/**' --glob '!**/node_modules/**'
```

That check was **not sufficient**. It missed the runtime nurture path assembled with
`path.join(process.cwd(), "marketing", "emails")` in
`src/routes/admin/marketing.js`. The three nurture templates were initially moved,
the route regression test caught the resulting missing HTML, and the templates were
restored to `marketing/emails/`.

Future cleanup must combine reference search with inspection of path construction and
a smoke test of each runtime consumer. The paths in "Kept despite looking stale" are
the post-review keep set, not proof that the original grep found every dependency.

## Moved

| Archived as               | Retention  | Origin                                    | Why dead                                                                                                                 | Revival condition                                                       |
| ------------------------- | ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `tiktok-trial/`           | Local-only | `marketing/tiktok-trial/` (160 MB)        | One-off Mother's-Day A/B cut trial (May); superseded by the `tiktok-pipeline` skill which composes reels self-contained. | Only if re-running that exact 2026 Mother's-Day A/B test.               |
| `reelfarm/`               | Local-only | `marketing/reelfarm/`                     | ReelFarm UGC-automation scripts + bundled skill; explicitly replaced by `tiktok-pipeline`.                               | If ReelFarm is ever adopted again as the compositor.                    |
| `emails-superseded/`      | Mixed      | Supplemental files formerly under `marketing/emails/` | Historical outreach notes, preview tooling, and a private recipient list. The three admin-loaded HTML templates remain at their runtime path. | Reference only; never treat the historical CSV as an approved send list. |
| `scripts-2026-03/`        | Local-only | `marketing/scripts/` (Mar-17)             | Old `template-to-draft.js` build tooling + its own node_modules lockfile; no longer invoked.                             | If reviving that video-script templating flow.                          |
| `screenshot-generations/` | Local-only | `marketing/appstore/screenshots/archive/` | 15+ self-labeled-stale screenshot generations (`_stale-vite-exports`, `_duplicates-*`, pre-warmcanvas).                  | Reference only; shipped set is `screenshots/current/6.9` (Warm Canvas). |

Local-only inventory at consolidation: approximately 2,844 files and 509 MB. The ignored `emails-superseded/email-addresses/` directory is personal data; every other file under `emails-superseded/` is non-personal and tracked.

## Kept despite looking stale (post-review keep set — do NOT archive)

| Path                                                                        | Why it stays                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketing/emails/`                                                         | `src/routes/admin/marketing.js:259-301` loads the three allowlisted nurture templates from this exact runtime directory. The route test now verifies that all three resolve to non-empty HTML.                                                                 |
| `marketing/email/`                                                          | `src/routes/admin/marketing.js:260-303` loads cold-email templates here; `import-cold-email-list.js`/`test-cold-email-send.js` read `cold-intro.*` + `.state/`; the **kept** `co.porizo.audio-probe` plist logs into `marketing/email/.state/runs/`. Channel paused != dir dead. |
| `marketing/ads-analytics/`                                                  | `scripts/ads/store.mjs:10` + `dashboard.mjs` write here every Meta-analyzer run.                                                                                                                                                                                             |
| `marketing/product demo/`, `marketing/audio hooks/`, `marketing/campaigns/` | Live **input pools** for the `tiktok-pipeline` skill: `audio_cut.py` reads `audio hooks/…mp3` by exact path; `ugc_reel.py`/`slideshow.py` write into `campaigns/<slug>/outputs/`; SKILL.md names `product demo/` a project-wide pool. Reusable creative source, not clutter. |
| `marketing/gtm/` (incl. `L2-content-engine/`)                               | Read by the `gtm-daily`/`gtm-weekly` skills (`hooks-backlog.md`, `creators.md`, `plan.md`, `daily-log/`, `weekly-review/`, `metrics.md`). If those skills are formally retired later, archive the tree together with them.                                                   |

## Not touched (deferred, needs code change not a move)

- **Remotion V1/V2 compositions** — registered via `<Composition>` in `marketing/remotion/src/Root.tsx`. Archiving them means editing Root.tsx + re-render verification, a code change deferred to a follow-up.
- **Duplicate screenshot generators** (`appstore/generator`, `screenshots/generator`) + their node_modules (~280 MB) — left in place per owner decision; only `screenshots/archive` (stale exports) was moved.
