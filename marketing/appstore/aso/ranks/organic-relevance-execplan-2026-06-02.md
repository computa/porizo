# Increase Organic App Store Relevance For Porizo Keywords

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain a checked-in PLANS.MD. Maintain this document according to the global standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, Porizo's App Store listing will be more organically relevant to high-intent song-gift searches without relying on Apple Search Ads. A searcher looking for a birthday song gift, anniversary song gift, gift song, song gift for Dad, or custom song gift should see App Store metadata and first-screen creative that match the exact job they searched for.

This matters because Porizo already ranks well for several exact song-gift phrases, but broader and adjacent keywords need stronger relevance signals. The work is not to buy traffic. The work is to improve App Store search text coverage, search-result conversion assets, Custom Product Page keyword targeting, and owned web routing so Apple's organic ranking system has better evidence that Porizo satisfies those searches.

## Progress

- [x] (2026-06-02 10:54Z) Read the global ExecPlan standard, repository context, product spec, architecture docs, and ASO skills.
- [x] (2026-06-02 10:54Z) Confirmed current live App Store metadata from OpenASO and local metadata sources.
- [x] (2026-06-02 10:54Z) Confirmed the current rank picture: Porizo is strong on exact song-gift long tails and weak on broad AI/music terms.
- [x] (2026-06-02 10:54Z) Found existing Dad Custom Product Page brief and generated Dad screenshot assets.
- [x] (2026-06-02 10:54Z) Created this ExecPlan in the writable ASO ranks directory.
- [x] (2026-06-02 10:54Z) Started implementation artifacts with a keyword-to-surface map and CPP/screenshot specs in this directory.
- [x] (2026-06-02 10:54Z) Corrected the local 1.5.14 promotional text source from Father's Day June 15 to June 21.
- [x] (2026-06-02 10:54Z) Updated the existing Dad CPP brief to remove the stale paid/routed-only CPP assumption and use Dad/Father's Day search keyword assignment.
- [x] (2026-06-02 10:54Z) Added Gift Song, Custom Song Gift, and Anniversary variants to the screenshot generator headline/profile map.
- [x] (2026-06-02 11:05Z) Built the screenshot generator with `npm run build`.
- [x] (2026-06-02 11:05Z) Generated Gift Song, Custom Song Gift, and Anniversary screenshot assets.
- [x] (2026-06-02 11:05Z) Visually inspected representative generated assets and confirmed 6.9-inch hero dimensions.
- [x] (2026-06-02 11:20Z) Received Ambrose's approval to proceed with the App Store Connect implementation path.
- [x] (2026-06-02 11:35Z) Generated and validated iPad 12.9-inch screenshot variants for Gift, Custom, and Anniversary CPPs.
- [x] (2026-06-02 11:45Z) Prepared ordered five-slide iPhone 6.5 and iPad 12.9 upload packages for Gift, Custom, and Anniversary.
- [x] (2026-06-02 11:55Z) Created new App Store Connect draft versions for existing Gift and Anniversary custom product pages.
- [x] (2026-06-02 11:58Z) Created the new Custom Song Gift custom product page in App Store Connect.
- [x] (2026-06-02 12:00Z) Updated CPP promotional text and deep links in App Store Connect for Gift, Anniversary, and Custom.
- [x] (2026-06-02 12:01Z) Assigned Anniversary CPP search keywords `anniversary,wife,husband` and Custom CPP search keywords `custom,personalized,voice`.
- [x] (2026-06-02 12:02Z) Confirmed Gift CPP search keyword assignment cannot use `gift` until the default app version keyword field contains that token.
- [x] (2026-06-02 12:03Z) Uploaded iPhone 6.5 and iPad 12.9 screenshots for all three CPP draft versions.
- [x] (2026-06-02 12:07Z) Created review submission `4300e74c-e67b-4a0e-934a-74a9ce923966`; confirmed it has no attached review items yet.
- [x] (2026-06-02 12:53Z) Confirmed all 30 ASC screenshots reached `COMPLETE`, attached the three CPP versions to review submission `4300e74c-e67b-4a0e-934a-74a9ce923966`, and submitted it.
- [x] (2026-06-02 12:53Z) Verified the review submission and all three CPP versions are `WAITING_FOR_REVIEW`.
- [x] (2026-06-03 10:13Z) Verified review submission `4300e74c-e67b-4a0e-934a-74a9ce923966` is `COMPLETE` and all three review items are `APPROVED`.
- [x] (2026-06-03 10:13Z) Verified Gift, Anniversary, and Custom CPP versions are `APPROVED`.
- [x] (2026-06-03 10:13Z) Verified all six ASC screenshot sets still contain five `COMPLETE` screenshots.
- [x] (2026-06-03 10:13Z) Verified the public Gift, Anniversary, and Custom CPP URLs return HTTP 200 and include the approved promotional text snippets.

## Surprises & Discoveries

- Observation: The local `custom-product-pages` skill says CPPs are not worth it for all-organic traffic and are not shown organically. Current Apple behavior allows custom product pages to be associated with search keywords so they can appear for matching App Store search queries. Treat the skill wording as stale for this task.
  Evidence: Apple current product-page guidance discussed in the prior research turn; this plan embeds the needed behavior instead of relying on the older local skill.

- Observation: OpenASO currently reports zero stored iPhone screenshots for the live listing, while local iPhone screenshot assets exist under `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/current/`.
  Evidence: `mcp__openaso.list_screenshots` returned no iPhone items for app 6758205028, while local files exist in `current/6.9`, `current/6.5`, `current/6.3`, and `current/6.1`.

- Observation: A Dad/Father's Day CPP brief already exists at `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/cpp-dad-song-gift.md`, and generated Dad screenshots already exist under `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/cpp-dad/`.
  Evidence: Local file inventory found `cpp-dad/6.9/porizo-hero.png`, `porizo-pick.png`, `porizo-tell.png`, `porizo-hear.png`, and `porizo-share.png`.

- Observation: The current local promotional text uses the wrong US Father's Day date.
  Evidence: `/Users/ao/Documents/projects/porizo/marketing/appstore/metadata/version/1.5.14/en-US.json` says "finish it for Father's Day, June 15"; US Father's Day 2026 is Sunday, June 21.

- Observation: Custom Product Page search keyword assignment only accepts tokens already present in the current app version localization keyword field.
  Evidence: Assigning `anniversary,wife,husband` and `custom,personalized,voice` succeeded because those tokens exist in the current keyword field. Assigning `gift,song` failed because `gift` is not present in the current app version keyword field.

- Observation: App Store Connect accepted all screenshot uploads but is holding some assets in `UPLOAD_COMPLETE`, which blocks review submission with "Upload is still in progress" errors.
  Evidence: The local `asc screenshots validate` checks passed for PNG, progressive JPEG, and baseline JPEG packages. The App Store Connect review item add call rejected the Gift CPP version because screenshot IDs were still processing.

- Observation: Progressive JPEG was a plausible processing risk, but switching to baseline JPEG did not immediately clear the App Store Connect processing state.
  Evidence: `file` identified the first JPEG package as progressive; the second package was baseline. After the baseline re-upload, ASC still reported pending screenshot resources.

- Observation: Screenshot processing cleared after waiting on the baseline JPEG upload package.
  Evidence: A later ASC poll reported all 30 screenshots as `COMPLETE`, allowing all three CPP versions to attach to the review submission.

- Observation: The approved CPP pages are publicly reachable and show the submitted promotional text.
  Evidence: Fetching the three `apps.apple.com` URLs returned HTTP 200, and each response body contained its expected CPP promotional text snippet.

## Decision Log

- Decision: Keep the default app name as `Porizo: Song Gift Maker`.
  Rationale: Live rank evidence shows the current name is working for the highest-fit organic lane, including exact song-gift searches. Moving the default title toward generic AI music would weaken the winning niche.
  Date/Author: 2026-06-02 / Codex

- Decision: Treat broad AI/music terms as support keywords, not the primary default-listing strategy.
  Rationale: Broad searches like `ai song generator`, `ai music generator`, `birthday song`, and `custom song` are dominated by large AI music apps with much higher review counts. Porizo's strongest organic wedge is buyer-intent song gifting.
  Date/Author: 2026-06-02 / Codex

- Decision: Use Custom Product Pages as an organic-search relevance surface where Apple keyword assignment is available.
  Rationale: CPPs can carry query-specific screenshots and promotional text while preserving the default listing. They let Porizo match `gift song`, `custom song gift`, `anniversary song gift`, and Dad/Father's Day searches without bloating the default listing.
  Date/Author: 2026-06-02 / Codex

- Decision: Start implementation with durable local artifacts before editing live metadata or submitting to App Store Connect.
  Rationale: App Store Connect changes have production impact and should remain explicit. Local plan, mapping, and specs are reversible and provide a clear basis for later generator and metadata edits.
  Date/Author: 2026-06-02 / Codex

- Decision: Apply the Father's Day date fix and Dad CPP wording update as local source edits, but do not submit them to App Store Connect.
  Rationale: The date was factually wrong, and the CPP wording was stale relative to the organic search strategy. Submitting live metadata still needs explicit user approval.
  Date/Author: 2026-06-02 / Codex

- Decision: Keep the screenshot generator's existing five-slide structure and add organic variants through the established `HEADLINES` and variant profile maps.
  Rationale: The existing generator already supports CPP variants and is the least risky path. Larger layout changes can wait until the new headline variants have been rendered and inspected.
  Date/Author: 2026-06-02 / Codex

- Decision: Proceed with App Store Connect CPP implementation after Ambrose approved "proceed with these."
  Rationale: The user explicitly asked to move from local plan/screenshots into implementation, so the next leverage point was creating/updating CPP versions and assigning eligible search keywords.
  Date/Author: 2026-06-02 / Codex

- Decision: Do not submit the review submission while screenshots remain in `UPLOAD_COMPLETE`.
  Rationale: App Store Connect rejects CPP versions whose screenshots are still processing. Submitting before the review items attach would be a false completion claim.
  Date/Author: 2026-06-02 / Codex

- Decision: Submit the three CPP versions once all screenshots reached `COMPLETE`.
  Rationale: The review gate accepted the CPP versions only after screenshot processing completed; all review submission items were created in `READY_FOR_REVIEW`, so submission was safe.
  Date/Author: 2026-06-02 / Codex

## Outcomes & Retrospective

First implementation milestone completed on 2026-06-02. The durable artifacts created in this directory define the organic relevance plan, the keyword-to-surface map, and the CPP/screenshot briefs that should drive App Store Connect setup. The local metadata source now has the correct Father's Day date, the existing Dad CPP brief now matches the organic-search CPP strategy, and the screenshot generator has Gift, Custom, and Anniversary variants wired.

Second implementation milestone completed on 2026-06-02 and approval was verified on 2026-06-03. App Store Connect now has approved CPP versions for Gift, Anniversary, and Custom, with updated promotional text, deep links, and uploaded iPhone/iPad screenshot sets. Anniversary and Custom keyword assignments were accepted. Gift keyword assignment is blocked until a future editable app version includes `gift` in the hidden keyword field. Review submission `4300e74c-e67b-4a0e-934a-74a9ce923966` is `COMPLETE`.

Generated assets exist under:

- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-gift/`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-custom/`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-anniversary/`
- Matching `exports-*-nav/` directories for the navigation variants.

Prepared upload packages exist under:

- `/private/tmp/porizo-cpp-upload-2026-06-02/`
- `/private/tmp/porizo-cpp-upload-jpeg-2026-06-02/`
- `/private/tmp/porizo-cpp-upload-baseline-jpeg-2026-06-02/`

App Store Connect CPP URLs:

- Gift: `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=c27abef4-0e68-4beb-b9ba-eaf718ca8271`
- Anniversary: `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=b24b31c4-d42d-4c07-8290-52621a2c3c4d`
- Custom: `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=a973cd06-248a-4f3d-acc0-4d29c6d57326`

Validation performed: `npm run build` passed in the screenshot generator project; the three variant capture runs completed; 72 non-navigation PNGs were generated across the three variants; representative 6.9-inch hero screenshots measured 1320 x 2868; and representative hero, picker, tell, and share screenshots were visually inspected for readable copy and no obvious overlap.

## Context and Orientation

Porizo is an iOS app for making personalized song gifts. The current live visible metadata is:

- App name: `Porizo: Song Gift Maker`
- Subtitle: `Birthday, Love & Wedding Songs`
- Live keyword field: `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai`
- Staged keyword field in local metadata: `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music`

The important local files are:

- `/Users/ao/Documents/projects/porizo/marketing/appstore/metadata/app-info/en-US.json` for visible app name and subtitle source.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/metadata/version/1.5.14/en-US.json` for description, keyword field, promotional text, and release notes source.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/keywords.json` for the ASO keyword bank and live surface records.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/organic-keyword-portfolio.json` for organic strategy lanes.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/current/` for default screenshot assets.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/` for the screenshot generator used to create App Store screenshots.
- `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/cpp-dad-song-gift.md` for the existing Dad CPP brief.

Definitions used in this plan:

Organic search means App Store search ranking and discovery without paid ads.

Relevance means Apple's ability to connect a search query to Porizo through indexed text, page content, and user behavior.

Search-result conversion means the rate at which users who see Porizo in App Store search tap through, view the product page, and download. Better matching screenshots and copy should improve this.

Custom Product Page, or CPP, means an alternate App Store product page variant. A CPP can have different screenshots, promotional text, and app preview videos. It cannot change app name, subtitle, keyword field, description, icon, price, or age rating.

Default listing means the normal App Store product page all users see unless they are shown or routed to a custom product page.

## Plan of Work

First, keep the default listing focused on the proven `song gift` lane. The app name should remain `Porizo: Song Gift Maker`. The subtitle should remain stable unless later rank data shows a specific need to trade visible conversion copy for more token coverage.

Second, correct the staged promotional text date in the local metadata file. The exact replacement should say Father's Day is June 21, not June 15. Promotional text is not indexed for App Store search, but it affects conversion and should not contain a factual error. This local source edit is complete.

Third, create or update CPP briefs for the organic search clusters. The existing Dad CPP should be retained and updated to remove the outdated claim that CPPs do not affect organic search. Add briefs for `gift song`, `custom song gift`, and `anniversary song gift`. Consider an AI support CPP only after the gift surfaces are implemented.

Fourth, update the screenshot generator in `marketing/appstore/screenshots/generator-designed/` to support new variants. The existing Dad mechanism is the model: add variant headline arrays and variant-specific in-phone copy, then run the capture script to generate assets. This generator update and first capture pass are complete for `gift`, `custom`, and `anniversary`.

Fifth, update the keyword bank and organic portfolio to include the new surface mapping: each keyword should have exactly one primary surface. For example, `gift song` maps to the Gift Song CPP, while `song gift` remains on the default page.

Sixth, validate. For documents, validate that files exist and contain the expected cluster names. For JSON metadata, run Node JSON parsing and character-count checks. For screenshots, inspect generated images and confirm dimensions, no alpha channel, and first-slide copy alignment.

## Concrete Steps

Run these commands from `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/ranks` to inspect the first implementation artifacts:

    ls -1 organic-relevance-execplan-2026-06-02.md keyword-surface-map-2026-06-02.md cpp-organic-search-specs-2026-06-02.md

Expected result:

    organic-relevance-execplan-2026-06-02.md
    keyword-surface-map-2026-06-02.md
    cpp-organic-search-specs-2026-06-02.md

The promotional text has been updated in:

    /Users/ao/Documents/projects/porizo/marketing/appstore/metadata/version/1.5.14/en-US.json

Use this replacement text:

    Make a personal song for Dad in his voice or yours. Preview free, finish it for Father's Day, June 21.

Validate JSON and character length:

    node -e "const fs=require('fs'); const p='/Users/ao/Documents/projects/porizo/marketing/appstore/metadata/version/1.5.14/en-US.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(j.promotionalText.length, j.promotionalText)"

Observed result: promotional text length is 102 and the corrected June 21 text is present.

The screenshot generator has been updated at:

    /Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/src/Generator.tsx

Variants named `gift`, `custom`, and `anniversary` were added following the existing `dad` variant pattern. The generator was run from:

    cd /Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed
    VARIANT=gift PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node capture.mjs
    VARIANT=custom PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node capture.mjs
    VARIANT=anniversary PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node capture.mjs

Observed result: new export directories exist for each variant and include generated slides per supported device size.

## Validation and Acceptance

Acceptance for the plan artifact is that a novice can open this file and know what to edit, why it matters, how to validate the changes, and which production actions still require explicit approval.

Acceptance for organic relevance implementation is:

- The default listing still covers `song gift`.
- A Gift Song CPP exists with screenshots and copy matching `gift song`.
- A Custom Song Gift CPP exists with screenshots and copy matching `custom song gift` and `personalized song gift`.
- An Anniversary CPP exists with screenshots and copy matching `anniversary song gift`, `song for wife`, and `song for husband`.
- The Dad/Father's Day surface has correct date-sensitive copy and does not claim CPPs are paid-only.
- Local metadata JSON parses successfully and all App Store character limits are respected.
- Generated screenshot assets visually show the target keyword promise on slide 1 and stay readable at search-result thumbnail size.

Do not call an App Store Connect submission complete until App Store Connect shows the updated pages or metadata as accepted or ready for sale.

## Idempotence and Recovery

The plan, map, and specs in this directory are safe to edit repeatedly. They do not affect production.

Local metadata file edits are safe to repeat if JSON remains valid. Recovery is to restore the prior JSON value from git or from the current source text listed in this plan.

Screenshot generator edits are safe if variants are added without changing the default variant output. Recovery is to run the generator with the default variant and compare current default screenshot exports to the existing `current/` screenshots.

App Store Connect submission is not idempotent in the same way: every submitted CPP or metadata edit can enter review. Do not submit without explicit approval.

## Artifacts and Notes

Implementation artifacts created with this milestone:

- `organic-relevance-execplan-2026-06-02.md`
- `keyword-surface-map-2026-06-02.md`
- `cpp-organic-search-specs-2026-06-02.md`

Generator and metadata artifacts updated with this milestone:

- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/src/Generator.tsx`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/metadata/version/1.5.14/en-US.json`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/cpp-dad-song-gift.md`

Generated screenshot outputs:

- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-gift/`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-custom/`
- `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-anniversary/`

Key observed ranks from live OpenASO checks on 2026-06-02:

    birthday song gift: Porizo #1
    anniversary song gift: Porizo #1
    personalized song gift: Porizo #1
    custom song gift: Porizo #2
    song gift for dad: Porizo #1
    song gift for mom: Porizo #1
    song gift: Porizo #3

## Interfaces and Dependencies

Use the existing local screenshot generator rather than inventing a new screenshot pipeline. The generator lives at:

    /Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/

Use JSON files already present in the metadata source tree. Do not create a second metadata system.

Use OpenASO as the evidence layer for current rank and competitor data. OpenASO cannot provide hidden keyword fields or exact App Store Connect analytics; use App Store Connect for those when needed.

Do not use Apple Search Ads as part of implementation or validation for this plan. This strategy is organic-only.
