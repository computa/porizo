# Organic ASO And Web Focus - US iPhone - 2026-05-30

Scope: apply the non-Apple-Ads work after stopping Apple Ads. This update keeps
paid search as historical evidence only and moves execution to organic App
Store search, App Store metadata source files, OpenASO/Kickstart tracking,
Google-visible web pages, and backend `/download` attribution.

No live Apple Ads campaign changes were made.

## Baseline

| Field | Value |
| --- | --- |
| App | Porizo: Song Gift Maker |
| App Store ID | 6758205028 |
| Country/device | US, iPhone |
| Live visible metadata | Name `Porizo: Song Gift Maker`; subtitle `Birthday, Love & Wedding Songs` |
| Live ASC keyword field | `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai` |
| Live ASC promotional text | `Make a personal song for Dad in his voice or yours. Preview free — finish it for Father's Day, June 15.` |
| Local metadata source updated | `marketing/appstore/metadata/version/1.5.14/en-US.json` |
| Staged keyword field source | `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music` |
| Data freshness | App Store Connect live metadata verified 2026-05-30; live website pages verified 2026-05-30; Kickstart screenshot 2026-05-29; OpenASO rank check 2026-05-29; historical ASA through 2026-05-29, now evidence only |

Unsupported or missing: exact App Store Connect organic metrics for this run,
Google Search Console index-status exports, revenue, proceeds, and subscription
conversion by keyword. The live hidden keyword field was verified after the
initial local update; it does not yet include `music`.

## Outcome Seed Universe

| Seed | Buyer job | Recipient | Occasion | Intent | Priority |
| --- | --- | --- | --- | --- | --- |
| personalized song gift | buy/send a song gift | any | any | direct category | P0 App Store |
| birthday song gift | make a birthday gift feel personal | any | birthday | direct occasion | P0 App Store |
| custom song gift | find a custom song present | any | any | direct category | P0 App Store |
| song gift | find apps that make/send songs | any | any | direct category | P0 App Store |
| gift song | find a song as a gift | any | any | direct category | P0 App Store |
| anniversary song gift | create a relationship gift | spouse/partner | anniversary | direct occasion | P0 App Store/web |
| gift for dad | find a meaningful dad gift | dad | Father's Day, birthday | broad gift | P1 web |
| unique gift for mom | find a meaningful mom gift | mom | Mother's Day, birthday | broad gift | P1 web |
| birthday surprise for husband | surprise partner | husband | birthday | broad celebration | P1 web |
| graduation gift for son | find a keepsake gift | son | graduation | broad gift | P1 web |
| video montage gift | find emotional media gift | family/friend | birthday, memorial | adjacent format | P2 web/CPP |
| custom poem gift | buy a written keepsake | family/partner | any | adjacent format | P2 web |
| music generator | create music with AI | creator | none | AI/music creation | tracking only |
| lyrics generator | create lyrics | creator | none | AI/lyrics creation | tracking only |
| voice changer | alter voice | creator | none | voice tool | tracking only |

## Intent Expansion Search

| Query/source | Intent bridge | Repeated language | New candidate keywords | Decision |
| --- | --- | --- | --- | --- |
| Kickstart competitor Keyword Analysis | AI-generator competitors | music, generator, music generator, lyrics, song generator, music maker | music, music generator, lyrics generator, music maker, song creator | Track. Promote only `music` into keyword field. |
| Direct gift-song rank set | App Store buyer already understands category | personalized song gift, custom song gift, song gift, gift song | birthday song gift, custom song gift, gift song | Keep App Store primary lane. |
| Broad recipient gift pages | Web buyer starts from person, not app | gift for dad, unique gift for mom, anniversary gift for wife | song gift for dad, custom song for mom, anniversary song for wife | Web SEO and internal links. |
| Adjacent format pages | Buyer compares cards, poems, videos, photo books | video montage, custom poem, memorial gift, tribute | video montage gift, custom poem gift, memorial song gift | Web/CPP comparison. |

Coverage: dad, mom, spouse/partner, child, friend/family; birthday,
anniversary, Father's Day, Mother's Day, wedding, graduation, memorial, and
Valentine/relationship pages already exist in the web inventory.

## Normal-User Search Evidence

| Query | Top-result pattern | Porizo visibility from prior checks | Lane | Decision |
| --- | --- | ---: | --- | --- |
| birthday song gift | direct song-gift/card apps | strong, top rank signal | direct gift-song | defend |
| custom song gift | GiftSong/Porizo/direct gifts | #2/#3 by provider | direct gift-song | attack |
| song gift | WishAI/GiftSong/Mozart/Porizo | #4/#5 by provider | direct gift-song/AI | attack |
| gift song | direct gift-song phrase, historical conversion | #7/#9 by provider | direct gift-song | attack |
| ai song generator | Suno/Muzio/Donna/Zona incumbents | not top sample | AI-generator | tracking only |
| music generator | competitor-language import | missing fresh rank | AI/music | tracking only |
| gift for dad | generic gifts/cards/photo apps | not top sample | generic gift | web only |
| video montage gift | video/gift apps | not top sample | adjacent format | web/CPP |

## Competitor Lane Map

Direct gift-song apps: WishAI, GiftSong variants, WishSong, SONGYFT, Songly.
Steal exact `song gift`, `gift song`, `custom song gift`, and occasion wording.

AI-generator apps: Suno, Muzio, MyTunes, Zona, Mozart, Donna. Use their
`music`, `generator`, `lyrics`, `creator`, and `maker` language for tracking,
but do not let it replace the gift promise.

Generic gift/card/photo/video/poem/tribute competitors: Zazzle, Givingli,
TouchNote, FreePrints, Mixbook, VidDay, Memento, poem/gift pages. Use them for
web SEO and comparison sections, not ASC keyword stuffing.

## Validated Keyword Bank

| Keyword | Evidence sources | Demand signal | Target surface | Decision | Rationale |
| --- | --- | --- | --- | --- | --- |
| birthday song gift | OpenASO/Kickstart prior ranks, existing web page | high relevance | App Store + web | defend | Exact buyer language. |
| custom song gift | OpenASO/Kickstart prior ranks | high relevance | App Store + web | attack | Direct competitor above us is beatable. |
| personalized song gift | OpenASO/Kickstart prior ranks | high relevance | App Store | defend | Core promise. |
| song gift | OpenASO/Kickstart prior ranks | high relevance | App Store | attack | Closest category phrase. |
| gift song | OpenASO rank + historical ASA conversion | high relevance | App Store | attack | Converted historically and matches buyer wording. |
| anniversary song gift | OpenASO/Kickstart prior ranks + page | high relevance | Web + App Store | defend/attack | Occasion phrase fits product. |
| music | Kickstart competitor token count 24 | broad but relevant token | keyword field | promote cautiously | One token supports music maker/gift combinations. |
| music generator | Kickstart count 17 | broad creator intent | tracking only | watch | High competitor frequency, weak gift qualification. |
| lyrics generator | Kickstart count 12 | broad creator intent | tracking only | watch | Porizo creates lyrics but buyer intent may not be gift. |
| voice changer | Kickstart competitor token | likely wrong intent | tracking only | watch/reject | Voice-tool searcher may not want a gift song. |
| cover song/song cover/ai cover | Kickstart competitor token | likely wrong intent | tracking only | reject unless evidence changes | Cover-app intent can mislead users. |
| gift for dad | prior App Store/web check | broad gift | web SEO | web only | Better captured before App Store install intent. |
| video montage gift | prior App Store/web check | adjacent keepsake | web/CPP | conquest | Comparison page can reframe song as alternative. |

## Prioritized Keyword Sets

`primary_app_store_rank_targets`

- Priority: P0
- Primary surface: App Store rank tracking and metadata measurement
- Keywords: `birthday song gift`, `custom song gift`, `personalized song gift`,
  `song gift`, `gift song`, `anniversary song gift`, `song gift for dad`,
  `song gift for mom`, `custom love song`
- Evidence summary: direct gift-song rank checks and historical conversion for
  `gift song`
- Owner metric: rank, App Store Search impressions, product page views,
  first-time downloads, conversion rate
- Rationale: highest-fit App Store searches where buyers already want a song
  gift

`metadata_token_candidates`

- Priority: P0
- Primary surface: ASC keyword field
- Keywords: `personalized`, `custom`, `voice`, `mom`, `dad`, `anniversary`,
  `fathers`, `mothers`, `day`, `husband`, `wife`, `graduation`, `ai`, `music`
- Evidence summary: current gift-first field plus Kickstart `music` competitor
  signal
- Owner metric: rank movement after next metadata release
- Rationale: 98/100 characters, avoids visible title/subtitle repeats, and
  does not over-pack broad generator terms

`seasonal_sprint`

- Priority: P1
- Primary surface: in-app event, custom product page, web SEO
- Keywords: `father's day song`, `fathers day song`, `song gift for dad`,
  `custom song for dad`, `make a song for dad`, `birthday song for dad`,
  `graduation song for son`, `graduation song for daughter`
- Evidence summary: existing pages and prior organic demand discovery
- Owner metric: seasonal ranks, GSC clicks, `/download` events
- Rationale: near-term recipient/occasion demand without paid spend

`recipient_occasion_web`

- Priority: P1
- Primary surface: web SEO
- Keywords: `gift for dad`, `unique gift for mom`, `birthday surprise for
  husband`, `birthday surprise for wife`, `anniversary gift for wife`,
  `anniversary gift for husband`, `graduation gift for son`, `memorial gift`,
  `remembrance gift`
- Evidence summary: normal buyers start with person and occasion
- Owner metric: GSC impressions/clicks and page-level `/download`
- Rationale: capture buyers before they know a song app is the solution

`custom_product_page_targets`

- Priority: P1
- Primary surface: CPP and routed web traffic
- Keywords: `song gift for dad`, `custom song for dad`, `custom song gift`,
  `custom love song`, `anniversary song for wife`, `song for husband`,
  `memorial song gift`, `video montage gift`
- Evidence summary: requires tailored screenshots/copy
- Owner metric: product page views, conversion rate, first-time downloads
- Rationale: generic product page is too broad for these jobs

`adjacent_format_conquest`

- Priority: P2
- Primary surface: web SEO comparison sections
- Keywords: `video montage gift`, `group video gift`, `custom poem gift`,
  `personalized card`, `photo book gift`, `voice message gift`, `memorial
  gift`, `tribute for dad`, `celebration of life song`
- Evidence summary: adjacent competitors own early gift language
- Owner metric: GSC non-brand impressions, `/download` clicks
- Rationale: reframe other keepsake formats into a personal song gift

`tracking_only_or_rejected`

- Priority: watch/reject
- Primary surface: OpenASO/Kickstart tracking only
- Keywords: `ai song generator`, `music generator`, `lyrics generator`,
  `song generator`, `music maker`, `song creator`, `music creator`,
  `generator song`, `generator music`, `music song`, `cover song`,
  `song cover`, `ai cover`, `voice changer`, `rap song`,
  `royalty free music`, `porizo`
- Evidence summary: competitor-language imports, broad AI/music intent, or
  brand-only demand
- Owner metric: promote only after rank plus qualified App Store/web conversion
- Rationale: too broad or too off-position for immediate ASC metadata

## Surface Plan

| Surface | Applied change |
| --- | --- |
| ASC metadata source | Updated `marketing/appstore/metadata/version/1.5.14/en-US.json` keyword field to add `music` and keep gift/occasion tokens. |
| ASO keyword bank | Updated `marketing/appstore/aso/keywords.json` live surface/source record and review log for organic-only execution. |
| Organic portfolio | Updated `marketing/appstore/aso/organic-keyword-portfolio.json` with Apple Ads stopped status, organic-only next actions, and Kickstart candidate handling. |
| SEO operating docs | Updated `marketing/channels/seo/README.md`. |
| Traffic plan | Replaced Apple Ads channel with Organic ASO And Web Search in `marketing/funnels/traffic-execution-plan.md`. |
| Campaign links | Added plain SEO priority URLs in `marketing/funnels/campaign-links.json`; landing pages keep page-level `/download` UTMs. |

## Implementation Plan

1. Submit or keep staged the next ASC keyword field from the metadata source:
   `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music`.
2. Correct live ASC promotional text. It currently says Father's Day, June 15;
   Father's Day 2026 in the US is Sunday, June 21.
3. Track the Kickstart competitor-language candidates in OpenASO/Kickstart
   rather than running Apple Ads exact-match tests.
4. Request GSC indexing for `/gifts/`, `/custom-song-gift`,
   `/birthday-song-maker`, `/anniversary-song-gift`, `/fathers-day-song`,
   `/wedding-song-gift`, and top recipient pages.
5. Add or strengthen internal links from matching blog posts to the priority
   page for each cluster.
6. Let App Store metadata/rank indexing settle for several days to weeks after
   the release is live before judging impact.

Rollback path: restore the prior 1.5.14 keyword field
`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai`
if `music` weakens ranks or App Store Search conversion.

## Weekly Measurement Plan

Every Friday:

- OpenASO/Kickstart: rank for P0, seasonal, and tracking-only keywords.
- App Store Connect: App Store Search impressions, product page views,
  first-time downloads, and conversion rate.
- GSC: query, page, impressions, clicks, CTR, and average position.
- Backend: `/download` events and registrations by `utm_medium` and
  `utm_campaign`.
- Product: completed songs and retained users by attributed source where
  available.

Success threshold after the next metadata release has been live for at least 7
days: `song gift` and `gift song` improve or hold with better App Store Search
impressions, at least 10 non-brand GSC queries appear, and SEO/programmatic/blog
`/download` clicks are attributable.

## Loopholes And Fixes

| Loophole | Risk | Fix |
| --- | --- | --- |
| OpenASO MCP transport closed during keyword add | external tracking may not include every new candidate yet | two add attempts failed on 2026-05-30; retry after MCP reconnect, using the tracking-only list above |
| Hidden keyword field live in ASC is not independently verified | local source may differ from live listing | verify in App Store Connect before the next submission |
| Kickstart generator/lyrics terms are competitor-heavy | broad traffic may not convert | track only; do not promote until qualified organic evidence appears |
| Web pages exist but GSC visibility has been near zero | SEO traffic may not move without indexing/internal links | request indexing and strengthen blog-to-landing links |
| App Store rank can improve without conversion | more impressions may not create songs | measure product page conversion, registration, and completed songs, not rank alone |
