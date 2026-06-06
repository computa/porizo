# App Store Localizations — Draft (not yet pushed to ASC)

Generated 2026-05-22 alongside the homepage/blog SEO push.
Updated 2026-05-22 to pivot App Store search relevance from the broad
AI-generator lane to the organic gift/occasion lane.

The `en-CA/`, `en-GB/`, and `en-AU/` directories contain draft localizations
adapted from `en-US/`. They are NOT yet pushed to App Store Connect. Review
this doc, then push when ready with:

```bash
asc metadata push --app 6758205028 --version 1.5.12 \
  --locale en-CA --dir PorizoApp/fastlane/metadata
# repeat for en-GB and en-AU
```

You may need to create the localization records first if they don't already
exist in ASC:

```bash
asc localizations create --app 6758205028 --locale en-CA
asc localizations create --app 6758205028 --locale en-GB
asc localizations create --app 6758205028 --locale en-AU
```

## Current ASO Package

| Field    | Value |
| -------- | ----- |
| Name     | `Porizo: Song Gift Maker` |
| Subtitle | `Birthday, Love & Wedding Songs` |
| en-US / en-CA keywords | `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai` |
| en-GB / en-AU keywords | `personalised,custom,voice,mum,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai` |

Rationale: keep `song`, `gift`, and `maker` in the title, put the highest
occasion-intent words in the subtitle, and keep `ai` as support metadata
without making the AI-generator lane the main promise.

## en-CA (Canadian English)

Canadian English aligns with American spelling for tech/software contexts, so
this locale mostly mirrors `en-US`. No spelling adaptations were made.
Father's Day in Canada is the third Sunday of June (same as the US), so the
Father's Day promo + release-notes copy carries through unchanged.

**Adaptations from en-US:** none — identical content.

> Open question: Is shipping a duplicate of en-US worth the extra ASC
> localization slot? You could skip en-CA and rely on en-US fallback. The
> upside is that en-CA stays visible as "Canadianised" in App Store
> impressions, which has minor brand-perception value but zero copy diff.

## en-GB (British English)

**Adaptations from en-US:**

| Field            | en-US                          | en-GB                                  |
| ---------------- | ------------------------------ | -------------------------------------- |
| subtitle         | Birthday, Love & Wedding Songs | Birthday, Love & Wedding Songs         |
| keywords         | …personalized…mom…             | …personal**ised**…**mum**…             |
| promotional_text | …Father's Day, **June 15**.    | …Father's Day, **15 June**.            |
| release_notes    | …send before **June 15**.      | …send before **15 June**.              |
| description      | …personalized AI song gift.    | …personal**ised** AI song gift.        |

Father's Day in the UK is the third Sunday of June (same date as US/CA),
so the seasonal framing carries through. Date format flipped to DD MM
convention. "Mum" replaces "mom" in keywords; description preserves "Dad"
which is identical in both dialects.

## en-AU (Australian English)

**Adaptations from en-US — content + seasonal pivot:**

| Field            | en-US                          | en-AU                                  |
| ---------------- | ------------------------------ | -------------------------------------- |
| subtitle         | Birthday, Love & Wedding Songs | Birthday, Love & Wedding Songs         |
| keywords         | …personalized…mom…             | …personal**ised**…**mum**…             |
| promotional_text | Father's Day, June 15 framing  | **Occasion-neutral** evergreen copy    |
| release_notes    | Father's Day, June 15 framing  | **Occasion-neutral** evergreen copy    |
| description      | personalized AI song gift      | personal**ised** AI song gift          |

**Australia's Father's Day is the 1st Sunday of September**, NOT June. The
Father's Day promo and release-notes copy were swapped for evergreen
language ("birthdays, anniversaries, weddings, and just-because moments") so
the listing reads naturally year-round in AU.

**Recommendation for AU Father's Day window:** prepare a separate AU-specific
metadata push in mid-to-late August (1-2 weeks before AU Father's Day) using
copy mirroring the en-US Father's Day messaging but with the correct AU
date. Track this as a separate, future task.

## Date format notes

- en-US, en-CA: `June 15` (month-day)
- en-GB, en-AU: `15 June` (day-month)
- Always spell out the month — never `15/06` or `06/15` since that ambiguity
  is the whole reason we localized.

## Spelling reference

| en-US        | en-GB / en-AU                        |
| ------------ | ------------------------------------ |
| personalized | personalised                         |
| favorite     | favourite (not used in current copy) |
| color        | colour (not used in current copy)    |
| mom          | mum                                  |
| organize     | organise (not used in current copy)  |

The current en-GB/en-AU drafts only swap the spellings actually present in
the source. If you expand the description in future, re-check this table.
