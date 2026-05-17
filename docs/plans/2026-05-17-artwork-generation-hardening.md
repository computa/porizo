# Harden song artwork generation

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include a root PLANS.MD, so this plan follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo song artwork should look like intentional human-made gift artwork, not synthetic filler. After this change, paid artwork prompts ask for real physical still-life subjects, avoid generated-looking styles and visible identifiers, validate provider images before accepting them, and remove watermark-style branding from the composited artwork layer.

The working behavior is visible by running the focused artwork tests and by generating or sampling a paid-tier artwork: accepted provider images are normalized to a 9:16 JPEG, invalid provider responses fall back to curated library artwork, and the final artwork no longer contains a `porizo` watermark.

## Progress

- [x] (2026-05-17) Read repository instructions, product context, and current artwork pipeline files.
- [x] (2026-05-17) Identified prompt style variants and local compositor branding as the main artwork-quality surfaces.
- [x] (2026-05-17) Hardened prompts around physical realism, occasion relevance, and no visible identifiers.
- [x] (2026-05-17) Added provider-image validation and normalization before accepting generated artwork.
- [x] (2026-05-17) Removed local watermark-style identifier from the artwork overlay.
- [x] (2026-05-17) Added focused regression tests and ran validation.

## Surprises & Discoveries

- Observation: Recipient and sender names are not sent to the image provider; names are composited locally.
  Evidence: `src/services/song-artwork.js` calls `buildPrompt({ occasion, style })` and passes names only to `compositeArtworkWithText`.
- Observation: Existing style variants include intentionally non-photographic directions, which increases the chance of generated-looking art.
  Evidence: `src/services/artwork-prompts.js` defines `paper-art` and `watercolor` as illustration/craft styles rather than photographed physical objects.
- Observation: The compositor adds a visible `porizo` mark to every artwork image.
  Evidence: `src/services/cover-generator.js` renders a bottom `<text>porizo</text>` element in `buildOverlaySvg`.
- Observation: The focused `npm test -- test/services/song-artwork.test.js` command still expands through the package script's full `test/**/*.test.js` glob.
  Evidence: It executed 559 tests before failing on the focused prompt regression. Direct `node --test --test-concurrency=1 test/services/song-artwork.test.js` is the precise focused command.

## Decision Log

- Decision: Keep the existing style keys and order, but redefine their descriptions toward physical, human-made still-life photography.
  Rationale: Style order is load-bearing for existing track bucketing, so preserving keys avoids avoidable churn while improving quality.
  Date/Author: 2026-05-17 / Codex
- Decision: Reject or normalize generated provider output before writing it as `artwork_base.jpg`.
  Rationale: Production should not accept empty buffers, corrupt images, tiny outputs, or unexpected formats just because the provider returned bytes.
  Date/Author: 2026-05-17 / Codex
- Decision: Remove the local `porizo` watermark from song artwork composites.
  Rationale: The lock screen and player already carry product identity; the artwork itself should not contain extra identifiers or watermark-like text.
  Date/Author: 2026-05-17 / Codex

## Outcomes & Retrospective

Implemented and validated. Paid-tier generated artwork now goes through `prepareGeneratedBaseImage`, which rejects tiny or corrupt provider output, decodes the image with `sharp`, normalizes it to a 1024x1536 JPEG, and only then writes `artwork_base.jpg`. Invalid provider output falls back to the curated artwork library.

The prompt registry now points every style toward real photographed physical still-life work, with occasion-specific subjects and explicit constraints against text, signatures, watermarks, app names, personal names, labels, UI marks, synthetic smoothness, warped geometry, duplicated petals, and rendered-looking artefacts.

The artwork compositor no longer adds a `porizo` or `Made with Porizo` watermark to final artwork images.

## Context and Orientation

The artwork flow starts in `src/services/song-artwork.js`. Free-tier tracks use a library image from `storage/artwork-library/{occasion}/{style}/v1.jpg`. Paid tiers call an image provider with a prompt from `src/services/artwork-prompts.js`, write `artwork_base.jpg`, and then call `compositeArtworkWithText` from `src/services/cover-generator.js` to add local typography.

The term "provider image" means the raw image bytes returned by the remote image API. The term "composite" means the final `artwork.jpg` with local recipient and occasion typography.

## Plan of Work

First, update `src/services/artwork-prompts.js` so every style describes a real photographed physical object or real photographed handmade card, and so every prompt explicitly forbids text, signatures, watermarks, generated artefacts, impossible geometry, UI marks, logos, and embedded names.

Second, update `src/services/song-artwork.js` to validate provider output with `sharp`, auto-orient it, crop/resize it to 1024 by 1536, strip metadata, and encode a production JPEG before the image is accepted. Invalid provider output should trigger the existing library fallback.

Third, update `src/services/cover-generator.js` to remove the bottom `porizo` watermark from the artwork overlay.

Fourth, add tests in `test/services/song-artwork.test.js` proving the prompt constraints, provider image validation, invalid-output fallback, and watermark removal.

## Concrete Steps

Run from `/Users/ao/Documents/projects/porizo`:

    NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/services/song-artwork.test.js
    npm run lint

If the full test command is needed after focused validation, run:

    npm test

## Validation and Acceptance

Acceptance is met when the focused artwork test file passes, lint passes, and the code path guarantees:

Generated prompts do not contain recipient names, sender names, app branding, or instructions to render visible text. Provider output is not accepted unless `sharp` can decode it and normalize it into the final base-art dimensions. The final artwork SVG overlay contains recipient and occasion text only, with no `porizo` watermark.

## Idempotence and Recovery

The changes are safe to rerun. Provider validation falls back to the existing library path, so a bad provider response does not block users from receiving artwork. The prompt style keys are unchanged, preserving existing style bucketing.

## Artifacts and Notes

Validation evidence:

    NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/services/song-artwork.test.js
    # tests 52, pass 52, fail 0

    npm run lint
    # eslint . passed

    npm test
    # tests 559, pass 553, fail 0, skipped 6

## Interfaces and Dependencies

Use the existing `sharp` dependency already declared in `package.json`. Expose provider-image preparation as an injectable dependency in `generateSongArtwork` so tests can isolate provider branching without needing real image bytes.
