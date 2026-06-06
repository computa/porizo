---
name: porizo-organic-demand-discovery
description: Demand-first organic growth operating procedure for Porizo. Use when planning, auditing, or implementing App Store organic search, web SEO keyword banks, competitor traffic capture, OpenASO/Kickstart keyword research, Apple Search Ads search-term mining, Google Search Console validation, or weekly organic ROI measurement. Also use when the user asks what buyers would search before knowing Porizo exists, how to avoid Porizo-biased keyword loops, or how to map organic keywords to App Store metadata, in-app events, custom product pages, web SEO pages, and tracking.
---

# Porizo Organic Demand Discovery

## Overview

Use this skill as the wrapper for Porizo organic search work. It turns generic keyword research into a mandatory operating procedure: begin with buyer demand, force intent-expansion search across the web and App Store, validate with live evidence, reject biased terms, map each keyword to the right surface, and measure the result weekly.

Do not begin from Porizo's current rankings, current tracked keywords, brand queries, or paid-ad winners. Use those only after the outcome-first seed universe and intent-expansion search exist.

## Required Inputs

Default to US, iPhone, live App Store data, and the current public Porizo app unless the user specifies otherwise. Do not use TestFlight metadata or internal screenshots as live-market evidence.

Collect or infer:

- Target country, locale, device class, and date.
- Current live Porizo metadata and recently submitted metadata, with release dates if available.
- Current organic-growth goal: more App Store Search impressions, more first-time downloads, better conversion, more web-to-app traffic, or ROI.
- Any known seasonal window, for example Father's Day, Mother's Day, graduation, birthdays, anniversary, wedding, memorial.

If a live data source is unavailable, mark it as missing. Do not invent search volume, installs, revenue, or rank.

## Evidence Sources

Use the strongest available sources, in this order:

1. Live App Store search and autocomplete, as a normal user who has never heard of Porizo.
2. OpenASO for live rank, competitor overlap, tracked keyword movement, and metadata freshness.
3. Kickstart for competitor title, subtitle, description, review, and screenshot language.
4. Apple Search Ads historical search terms for real App Store search demand, impressions, taps, installs, spend, CPT, CPI, and conversion.
5. App Store Connect metrics through `asc-metrics`: App Store Search impressions, product page views, first-time downloads, conversion rate, app units, proceeds if available.
6. Google Search Console for web queries, pages, impressions, clicks, CTR, and position.
7. Web search results for query intent, competing pages, and whether a phrase is normal user language or ASO jargon.

Use related skills when needed: `keyword-research`, `competitor-analysis`, `competitor-tracking`, `apple-search-ads`, `asc-metrics`, `app-analytics`, `web-to-app-funnel`, `metadata-optimization`, `custom-product-pages`, `in-app-events`, and `seasonal-aso`.

## Workflow

### 1. Outcome-First Seeds

Start from buyer jobs, not current Porizo data. Build a seed universe before checking whether Porizo ranks.

Generate seeds across:

- Recipient: dad, mom, husband, wife, boyfriend, girlfriend, best friend, daughter, son.
- Occasion: birthday, anniversary, Father's Day, Mother's Day, wedding, graduation, memorial, Valentine's Day, Christmas.
- Action: make, create, send, surprise, dedicate, gift.
- Product format: personalized song, custom song, song gift, AI song, birthday song, anniversary song.

Examples:

- `gift for dad`
- `birthday surprise`
- `make a song for husband`
- `personalized anniversary gift`
- `birthday song gift`
- `custom song for wife`
- `father's day song`
- `graduation gift song`

For each seed, record the buyer job, recipient, occasion, and likely install intent.

### 2. Intent Expansion Search

Force effort here. This step is mandatory and must happen before checking Porizo's existing rankings, tracked keywords, brand traffic, or paid-ad winners.

Goal: discover new demand language from normal people who want an outcome that could lead to Porizo, even if they would not yet type "song gift" or know that a song app exists.

Search both the web and App Store across these intent bridges:

- Broad gift intent -> song-gift intent: `gift for dad`, `unique gift for mom`, `anniversary gift for wife`, `birthday surprise for husband`, `graduation gift for son`.
- Celebration intent -> personalized-song intent: `birthday surprise`, `wedding anniversary idea`, `father's day idea`, `mother's day idea`, `valentine surprise`.
- Relationship intent -> dedication intent: `song for husband`, `song for wife`, `song for dad`, `song for mom`, `song for best friend`.
- Tribute intent -> remembrance-song intent: `memorial gift`, `tribute for dad`, `remembrance gift`, `celebration of life song`.
- Adjacent format intent -> Porizo alternative: `personalized card`, `photo book gift`, `video montage gift`, `voice message gift`, `custom poem gift`.
- Creation intent -> app intent: `make a song for dad`, `create birthday song`, `custom love song`, `ai song for wife`.

Minimum effort bar for a full pass:

- Cover at least 5 recipient clusters: dad, mom, spouse/partner, child, friend/family.
- Cover at least 6 occasion clusters: birthday, anniversary, Father's Day, Mother's Day, wedding, graduation, memorial/tribute, Valentine's Day, Christmas. If fewer are relevant to the user's request, explain why.
- Search at least 25 non-brand seed phrases before looking at Porizo rank.
- For at least 12 priority phrases, capture App Store autocomplete if available and top 10 app results.
- For at least 12 priority phrases, inspect web results and record SERP intent, competing page types, repeated wording, and any related-search language that appears.
- Include at least 5 adjacent non-song competitors from gift/card/photo/video/tribute categories, because those competitors often own buyer language before the buyer knows a song is the right format.

For each search, record:

- Query, source, country/locale/device, and date.
- Autocomplete or related-search phrases.
- Top apps or pages.
- Repeated words in titles, subtitles, page titles, snippets, reviews, and screenshots.
- Whether the searcher appears to want an app, a gift guide, a generator tool, a physical gift, a card, a video, lyrics, or a finished song.
- New keyword candidates generated from this evidence.

Reject the pass as incomplete if it only researches terms where Porizo already ranks, terms from current metadata, or terms that came from Apple Search Ads alone.

### 3. Normal-User App Store Search

Search like a buyer who does not know Porizo exists.

For each priority seed and each high-signal phrase discovered in Intent Expansion Search:

- Record autocomplete suggestions.
- Record the top 10 apps in the target country and device class.
- Capture title, subtitle, developer, rating, review count, rank, visible ad status if shown, and first-screen screenshot claims.
- Read enough reviews to identify the promise users bought and the pain they complain about.
- Classify each result as `direct gift-song`, `AI-generator`, `generic gift/card`, `music/lyrics`, or `irrelevant`.

Always include the search date, country, and device. If personalization or account history might affect results, say so.

### 4. Competitor Traffic Theft

Identify which apps own each query and what language they use to capture demand.

Separate lanes:

- Direct gift-song apps: closest demand competitors.
- AI-generator apps: useful discovery/supporting metadata, but not automatically Porizo's main promise.
- Generic gift/card apps: useful occasion and recipient language.
- Photo, video, poem, tribute, and keepsake apps/pages: useful emotional outcome language and alternative-format objections.
- Music, lyrics, karaoke, and cover apps: usually reject or track unless evidence shows gift intent.

For each lane, extract:

- Repeated title and subtitle tokens.
- Screenshot hook language.
- Review language from happy and unhappy users.
- Positioning promise.
- Weakness Porizo can credibly exploit.
- The search path that led to the competitor, especially if it began from broad gift, family celebration, tribute, or relationship intent rather than song intent.

Default strategic guardrail: keep `gift/occasion` as Porizo's primary lane. Treat `AI song generator`, `music generator`, `voice`, `lyrics`, and `cover` as discovery/supporting terms unless conversion evidence proves they drive qualified installs.

### 5. Demand Validation

Cross-check each candidate with multiple sources.

For Apple Search Ads:

- Prefer search-term-level data over campaign/ad-group summaries.
- Record impressions, taps, installs, spend, CPT, CPI, TTR, and install conversion.
- Treat high spend with zero installs as a warning, not proof of organic opportunity.
- Do not let paid ads dictate the strategy blindly.

For OpenASO and Kickstart:

- Record current Porizo rank, best competitor rank, volume/difficulty signals if available, and metadata overlap.
- Note stale provider data separately from live App Store evidence.

For Google Search Console:

- Record query, page, impressions, clicks, CTR, position, and whether traffic reaches `/download` or app-open events.

For web search:

- Confirm that the query reflects a real user problem.
- Record dominant SERP intent: app download, gift guide, song lyrics, generator tool, artist/song content, or informational.
- Distinguish discovery keywords that should become SEO/CPP/in-app-event inputs from validation-only keywords that are too broad for App Store metadata.

### 6. Bias Rejection

Reject or demote keywords that are:

- Brand-only: `porizo`, misspellings, or terms only visible because Porizo already ranks.
- Competitor brand terms, unless used for paid conquesting, custom product pages, or tracking.
- Too generic: `music`, `song`, `AI`, `generator`, `lyrics`, `cover`, unless the evidence shows qualified gift-song intent.
- Irrelevant to Porizo's promise, such as listening, karaoke, generic lyrics lookup, beat making, or cover-song publishing.
- High traffic but weak conversion or impossible for Porizo to satisfy.
- Unsupported by live evidence.

Every kept keyword needs a one-line evidence rationale. If confidence is below the user's requested threshold, list the loopholes and run another pass through missing evidence, competitor intent, feasibility, conversion risk, implementation risk, and measurement risk.

### 7. Keyword Set Construction

Build explicit keyword sets from the research. A full pass is incomplete if it only provides scattered evidence, prose recommendations, or a generic validated bank.

Output copy-pasteable sets with 5-20 keywords each where possible. Each set must have:

- `set id`
- priority: P0, P1, P2, or reject/watch
- primary surface
- keywords
- evidence source summary
- owner metric for weekly measurement
- one-line reason the set exists

Required sets:

- `primary_app_store_rank_targets`: exact phrase terms Porizo should rank for in App Store organic search.
- `metadata_token_candidates`: App Store keyword-field/token candidates, respecting title/subtitle composition and the 100-character keyword-field constraint.
- `seasonal_sprint`: time-boxed seasonal terms for in-app events, CPPs, and web pushes.
- `recipient_occasion_web`: broad recipient/occasion terms that should be captured by SEO before users know a song app is the answer.
- `custom_product_page_targets`: terms that need tailored screenshots/copy because the generic product page is too broad.
- `adjacent_format_conquest`: video, card, poem, photo, tribute, memorial, or keepsake alternatives where Porizo can reframe the gift.
- `tracking_only_or_rejected`: high-risk, generic, brand, weak-conversion, or irrelevant terms.

Do not bury these sets inside paragraphs. If a keyword is kept, it must appear in at least one explicit set. If a keyword is rejected, it must appear in the tracking/rejected set with the reason.

### 8. Surface Mapping

Map each kept keyword to exactly one primary surface and optional secondary surfaces.

Use:

- `title/subtitle` for the highest-relevance buyer promise with strong demand and conversion evidence. Respect 30-character title/subtitle limits and avoid repeated tokens.
- `keyword field` for supporting tokens that combine with title/subtitle terms. Respect 100 characters, no spaces after commas, no repeated title/subtitle tokens, no protected brands, and no unsupported claims.
- `in-app event` for seasonal or time-boxed demand, for example Father's Day, Mother's Day, graduation, Valentine's Day, wedding season, memorial/remembrance.
- `custom product page` for competitor/category lanes that need tailored screenshots or ad/web routing.
- `web SEO page` for informational, comparison, or gift-guide demand that can lead to `/download`.
- `tracking only` for high-risk, generic, aspirational, competitor-brand, or insufficiently validated terms.
- `reject` for irrelevant or misleading terms.

Do not mutate App Store Connect metadata, Apple Search Ads campaigns, live SEO pages, or production content unless the current user request explicitly authorizes implementation. If metadata implementation is authorized, use `metadata-optimization` and account for App Store version trains, review timing, and rank-indexing delay.

### 9. Weekly Measurement

Create a weekly measurement plan before or alongside implementation.

Track by keyword, country, locale, surface, and shipped date:

- App Store organic rank.
- App Store Search impressions.
- Product page views.
- First-time downloads.
- Product page conversion rate.
- App units, proceeds, trial starts, or subscriptions when available.
- Google Search Console impressions, clicks, CTR, and position by page.
- Web `/download` events and app-open events.
- Paid spend and paid installs, so organic lift is not misattributed.

Compare the last 7 days against the prior 7 days and the pre-change baseline. Ranking and indexing are not always immediate; state exact live-release dates and allow several days to weeks for meaningful movement.

## Required Output

For a full run, produce these sections:

1. **Baseline**
   - App version, live metadata, country, device, date, and data-source freshness.

2. **Outcome Seed Universe**
   - Table: seed, buyer job, recipient, occasion, intent, priority.

3. **Intent Expansion Search**
   - Table: query, source, intent bridge, autocomplete/related searches, top apps/pages, repeated language, new candidate keywords, decision.
   - Include coverage notes for recipient clusters, occasion clusters, adjacent formats, and any missing searches.

4. **Normal-User Search Evidence**
   - Table: query, autocomplete, top apps, competitor lane, top language patterns, Porizo visibility.

5. **Competitor Lane Map**
   - Direct gift-song apps, AI-generator apps, generic gift/card apps, photo/video/poem/tribute apps, music/lyrics apps, and what Porizo should steal or avoid.

6. **Validated Keyword Bank**
   - Table: keyword, buyer job, evidence sources, demand signal, relevance, competition, Porizo rank, target surface, decision, rationale.

7. **Prioritized Keyword Sets**
   - Explicit keyword sets: `primary_app_store_rank_targets`, `metadata_token_candidates`, `seasonal_sprint`, `recipient_occasion_web`, `custom_product_page_targets`, `adjacent_format_conquest`, and `tracking_only_or_rejected`.
   - Each set must include priority, primary surface, keywords, evidence summary, owner metric, and rationale.
   - A report without these sets fails the skill.

8. **Surface Plan**
   - App Store metadata, keyword field, in-app events, custom product pages, web SEO pages, tracking-only terms, and rejected terms.

9. **Implementation Plan**
   - Exact files or App Store Connect fields to change, review/release constraints, rollback path, and expected indexing delay.

10. **Weekly Measurement Plan**
   - Baseline metrics, target metrics, data sources, cadence, and the threshold for calling the change successful or failed.

11. **Loopholes And Fixes**
   - Missing evidence, risky assumptions, competitor uncertainty, conversion risk, product mismatch, and the next action for each.

When implementation includes local artifacts, update existing ASO records where present, especially `marketing/appstore/aso/organic-keyword-portfolio.json`, and create a dated report under `marketing/appstore/aso/`.
