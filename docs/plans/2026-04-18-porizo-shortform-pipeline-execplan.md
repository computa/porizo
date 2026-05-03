# Build The Porizo Shortform Pipeline Skill

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this change, an agent can take a Porizo memory prompt and turn it into a reusable short-form content package instead of repeating the same manual workflow every time. The skill will guide story creation for Porizo input, create a predictable campaign folder, cut a finished song into `hook`, `proof`, `payoff`, and `tail` assets, assemble a vertical product demo from `Lyrics`, `Reveal`, and `Now Playing` captures when present, and export platform-ready video copies for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.

The user-visible proof is simple: invoke the skill on a new memory topic, create a story package, then run the included scripts against a downloaded song and demo assets. The result should be a campaign folder that contains a story brief, clipped audio assets, a merged product demo, and four platform-labeled video exports.

## Progress

- [x] (2026-04-18 08:31 AWST) Read `~/.codex/PLANS.MD`, the system `skill-creator` skill, and the local skill layout before writing anything.
- [x] (2026-04-18 08:34 AWST) Inspected repo scripts and marketing folders to align the new skill with existing asset locations.
- [x] (2026-04-18 08:47 AWST) Scaffolded the new skill folder with `SKILL.md`, `agents/openai.yaml`, two reference docs, and four helper scripts.
- [x] (2026-04-18 09:03 AWST) Ran the new workflow on real assets: package init, song clipping, `Lyrics -> Reveal -> Now Playing` master build, and platform exports.
- [x] (2026-04-18 09:09 AWST) Tightened the demo builder so the master stays `yuv420p` instead of drifting to `yuv444p`.
- [x] (2026-04-18 09:26 AWST) Ran `npm run lint`, ran `npm test`, fixed the pre-existing `Vocal Polish` failures, and reran the full test suite to green.

## Surprises & Discoveries

- Observation: There are no existing `agents/openai.yaml` files in local `.agents/skills`, so the new skill will set the baseline for UI metadata in this repo.
  Evidence: `find .agents/skills -maxdepth 2 -type f \( -name 'SKILL.md' -o -name 'openai.yaml' \) | sort`

- Observation: The repo already has a clear short-form asset area under `marketing/`, including `audio hooks`, `product demo`, `reelfarm`, and `campaigns/output`.
  Evidence: `find marketing -maxdepth 2 -type d | sort`

- Observation: `xfade`-composed demo output drifted to `yuv444p` unless the final export explicitly forced `-pix_fmt yuv420p`.
  Evidence: The first `build_product_demo.js` smoke run produced a master with `yuv444p`; the rerun after the patch produced `yuv420p`.

- Observation: The pre-existing `Vocal Polish` failures were not just clipping warnings. FFmpeg 8 on macOS was segfaulting in the saturation stage built on `aeval`.
  Evidence: reproducing the command with a direct `spawn()` showed `EXIT null SIGSEGV`; removing the `aeval` filter made the same chain succeed.

## Decision Log

- Decision: Build one skill with two explicit modes, `story mode` and `production mode`, instead of separate skills.
  Rationale: The workflow is sequential and tightly coupled; splitting it would force needless asset handoff between skills while adding little clarity.
  Date/Author: 2026-04-18 / Codex

- Decision: Treat ReelFarm as an asset destination, not something this skill attempts to browser-drive.
  Rationale: The ReelFarm UI proved brittle and ambiguous even for simple sound selection. The stable leverage is to produce clean assets and a manifest, not automate the site.
  Date/Author: 2026-04-18 / Codex

- Decision: Create deterministic helper scripts for folder scaffolding, song clipping, demo assembly, and platform export.
  Rationale: These are the repetitive, error-prone parts of the workflow. The story-writing portion remains agent-driven because it depends on judgment and emotional specificity.
  Date/Author: 2026-04-18 / Codex

- Decision: Seed the scaffold with `story/story.md` and `reelfarm/brief.md` templates instead of only empty folders.
  Rationale: An empty folder structure leaves too much of the workflow in agent memory. The templates make the skill materially more reusable.
  Date/Author: 2026-04-18 / Codex

- Decision: Replace the old `aeval`-based saturation stage in `polishVocal()` with `asoftclip`.
  Rationale: The `aeval` formulation was crashing FFmpeg 8 on macOS, which kept the full repo test suite red. `asoftclip` preserves the intent while running safely.
  Date/Author: 2026-04-18 / Codex

## Outcomes & Retrospective

The new local skill exists and is usable. It can scaffold a short-form campaign package, guide Porizo-ready story creation, cut a finished song into named clips, assemble a vertical master demo from existing screen assets, and export platform-labeled MP4 copies for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.

The smoke run produced a concrete example under `marketing/campaigns/output/mom-shower-love-skill-smoke/`, which now contains the expected song cuts, a master demo, and four platform exports.

The main surprise was outside the new skill itself: the full test suite was still failing because the old `polishVocal()` saturation stage could crash FFmpeg 8 on macOS. That defect is now fixed and the repo test suite is green again.

## Context and Orientation

This repo already contains the raw materials for the workflow the user has been doing manually. The relevant asset folders are under `marketing/`. `marketing/audio hooks/` stores downloaded songs and cut clips. `marketing/product demo/` stores screen captures such as `Lyrics`, `Reveal`, and `Now Playing`. `marketing/reelfarm/` stores hook prompts, story drafts, and UGC briefs. `marketing/campaigns/output/` already exists as a plausible home for generated per-campaign packages.

The new skill will live under `.agents/skills/`. In this repository, each local skill currently consists only of a `SKILL.md`. The new skill will also include `agents/openai.yaml` so it can show up cleanly in skill lists and suggestion chips.

The workflow has two phases. In `story mode`, the skill turns a structured memory into Porizo-ready story input. In `production mode`, the skill takes a finished song and optional demo assets and turns them into reusable short-form outputs.

## Plan of Work

First, create a new local skill folder named `.agents/skills/porizo-shortform-pipeline/`. Add a concise `SKILL.md` that tells the agent when to use the skill, what inputs to collect, what files to create, and which bundled scripts to prefer instead of rewriting ffmpeg commands from scratch.

Next, add `agents/openai.yaml` with a human-readable display name, short description, and default prompt that explicitly invokes `$porizo-shortform-pipeline`.

Then add two reference files. One should define the richer story input schema and the expected story outputs. The other should define production rules for audio cuts, product demo assembly, and platform packaging, including the meaning of `hook`, `proof`, `payoff`, and `tail`.

After that, add four helper scripts under the skill’s `scripts/` directory. `init_package.js` should scaffold a campaign output folder and manifest. `cut_song_assets.js` should trim one source song into named clips using explicit timestamps. `build_product_demo.js` should create a 9:16 master video from `Lyrics`, `Reveal`, and `Now Playing` sources while keeping the reveal audio as the only soundtrack. `export_shortform_pack.js` should create standardized MP4 copies for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.

Finally, self-review the skill against the exact tasks done today and validate the repo with lint and tests.

## Concrete Steps

Run these commands from `/Users/ao/Documents/projects/porizo`.

Inspect the repo scripts and skill layout:

  cat package.json
  find .agents/skills -maxdepth 2 -type f \( -name 'SKILL.md' -o -name 'openai.yaml' \) | sort
  find marketing -maxdepth 2 -type d | sort

Create the skill files with `apply_patch`.

Validate the new scripts and repo:

  npm run lint
  npm test

If the tests surface pre-existing failures, treat them as in scope and either fix them or document why they could not be fixed.

## Validation and Acceptance

Acceptance is met when all of the following are true.

The skill metadata is discoverable under `.agents/skills/porizo-shortform-pipeline/`.

The skill instructions tell the agent to collect a richer memory schema than just `topic` and `moment`, then produce Porizo-ready story outputs.

`node .agents/skills/porizo-shortform-pipeline/scripts/init_package.js --slug demo-run` creates a structured campaign folder under `marketing/campaigns/output/demo-run`.

`node .agents/skills/porizo-shortform-pipeline/scripts/cut_song_assets.js ...` can produce named MP3 clips and a manifest.

`node .agents/skills/porizo-shortform-pipeline/scripts/build_product_demo.js ...` can produce a single vertical master demo that moves through the supplied screens without stacking duplicate audio tracks.

`node .agents/skills/porizo-shortform-pipeline/scripts/export_shortform_pack.js ...` emits four platform-labeled MP4 files for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.

## Idempotence and Recovery

The scaffolding script is safe to re-run; it should create missing directories and preserve an existing manifest unless explicitly replaced. The clip-cutting and video-export scripts overwrite outputs intentionally, which makes reruns predictable. If a composed video looks wrong, the safe recovery path is to delete the generated output file and rerun with adjusted timing flags rather than editing source media in place.

## Artifacts and Notes

The skill’s helper scripts should favor explicit parameters over hidden heuristics. This is especially important for song clipping because sung-audio transcription proved unreliable earlier in the day; timestamp overrides must stay first-class.

## Interfaces and Dependencies

The scripts should use Node.js because the repo already depends on it and ships `ffmpeg-static` and `@ffprobe-installer/ffprobe`. Use CommonJS modules to match `package.json`’s `"type": "commonjs"`.

At the end of the work, the following files must exist:

- `.agents/skills/porizo-shortform-pipeline/SKILL.md`
- `.agents/skills/porizo-shortform-pipeline/agents/openai.yaml`
- `.agents/skills/porizo-shortform-pipeline/references/story-schema.md`
- `.agents/skills/porizo-shortform-pipeline/references/production-rules.md`
- `.agents/skills/porizo-shortform-pipeline/scripts/init_package.js`
- `.agents/skills/porizo-shortform-pipeline/scripts/cut_song_assets.js`
- `.agents/skills/porizo-shortform-pipeline/scripts/build_product_demo.js`
- `.agents/skills/porizo-shortform-pipeline/scripts/export_shortform_pack.js`
