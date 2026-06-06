# Porizo Organic Demand Discovery - US iPhone - 2026-05-24

Skill: `$porizo-organic-demand-discovery`

Goal: find buyer-demand keywords from normal-user App Store and web behavior, not from Porizo's current rankings. This pass starts with outcome intent, expands through broad gift/family/celebration searches, validates with App Store top results, OpenASO, Kickstart, Apple Search Ads, Google Search Console baseline, and Porizo web surfaces, then maps each keyword to the right organic-growth surface.

No live App Store Connect, Apple Search Ads, or production web changes were made in this pass.

## Baseline

Country/device: US, iPhone.

Live App Store state verified 2026-05-24:

| Field | Live value |
| --- | --- |
| App | Porizo: Song Gift Maker |
| App Store ID | 6758205028 |
| Bundle ID | porizo.ios.app.PorizoApp |
| Version | 1.5.13 |
| Live subtitle | Birthday, Love & Wedding |
| Local/submitted subtitle | Birthday, Love & Wedding Songs |
| Category | Music |
| Rating evidence | 5.0 with tiny rating count in sampled sources |
| Current live promo angle | Father's Day / make Dad a personal song |

Important timing note: local/submitted 1.5.14 metadata is ahead of the live App Store page. Do not judge 1.5.14 keyword impact until the version is live and has at least 7 days of App Store Search impression, rank, product-page-view, and download data.

Data-source status:

| Source | Status | Notes |
| --- | --- | --- |
| Live App Store page | Available | Used as live listing baseline. |
| OpenASO | Available | Metadata, rank, tracked keywords, competitors. Popularity endpoints returned HTTP 403 for many terms, so popularity is not reliable here. |
| Kickstart | Available | Used for sampled keyword ranking and competitor language. Analytics were unavailable. |
| Apple Search Ads | Local export available | Used `marketing/appstore/aso/inputs/asa-2026-05-22.csv`. |
| Google Search Console | Screenshot baseline only | User screenshot showed 1 click, 101 impressions over 3 months, mostly `porizo`; 9 indexed pages and 39 not indexed as of 2026-05-18. |
| Porizo web crawl/sitemap | Available | Sitemap confirms gift, occasion, and blog SEO inventory is live/submitted. |

## Outcome Seed Universe

These seeds were created before checking whether Porizo ranks. They cover recipient, occasion, adjacent gift formats, and song-making actions.

| Seed | Buyer job | Recipient | Occasion | Intent | Priority |
| --- | --- | --- | --- | --- | --- |
| gift for dad | find a gift for dad | dad | Father's Day, birthday | broad gift | web/tracking |
| unique gift for mom | find a meaningful mom gift | mom | Mother's Day, birthday | broad gift | web/tracking |
| anniversary gift for wife | find anniversary gift | wife | anniversary | broad gift | web/tracking |
| anniversary gift for husband | find anniversary gift | husband | anniversary | broad gift | web/tracking |
| birthday surprise for husband | surprise partner | husband | birthday | broad celebration | web/tracking |
| birthday surprise for wife | surprise partner | wife | birthday | broad celebration | web/tracking |
| graduation gift for son | find graduation gift | son | graduation | broad gift | web/tracking |
| graduation gift for daughter | find graduation gift | daughter | graduation | broad gift | web/tracking |
| wedding anniversary idea | find anniversary idea | spouse | anniversary | idea/gift | web |
| father's day idea | find Father's Day idea | dad | Father's Day | idea/gift | web |
| mother's day idea | find Mother's Day idea | mom | Mother's Day | idea/gift | web |
| valentine surprise | surprise romantic partner | partner | Valentine's Day | celebration | web |
| song for husband | dedicate song | husband | love, birthday | relationship/song | web/track |
| song for wife | dedicate song | wife | love, birthday | relationship/song | web/track |
| song for dad | dedicate song | dad | Father's Day, birthday | relationship/song | web/track |
| song for mom | dedicate song | mom | Mother's Day, birthday | relationship/song | web/track |
| song for best friend | dedicate song | friend | birthday, thank-you | relationship/song | web/track |
| memorial gift | remember someone | family | memorial | tribute/gift | web |
| tribute for dad | create tribute | dad | memorial, Father's Day | tribute | web |
| remembrance gift | remember someone | family | memorial | tribute/gift | web |
| celebration of life song | memorial song | family | memorial | tribute/song | web/track |
| personalized card | send card | any | any | adjacent format | web only |
| photo book gift | create keepsake | family | birthday, memorial | adjacent format | web only |
| video montage gift | group video gift | family/friend | birthday, memorial | adjacent format | CPP/web |
| voice message gift | send voice keepsake | family/partner | any | adjacent format | web |
| custom poem gift | personalized poem | family/partner | any | adjacent format | web |
| make a song for dad | create song | dad | Father's Day, birthday | app/song creation | track/CPP |
| create birthday song | create birthday song | any | birthday | app/song creation | track/web |
| custom love song | create love song | partner | anniversary, love | song creation | track/CPP |
| ai song for wife | create AI song | wife | anniversary, love | AI/song creation | support |
| personalized song gift | buy/send song gift | any | any | direct gift-song | defend/attack |
| birthday song gift | send birthday song gift | any | birthday | direct gift-song | defend |
| custom song gift | buy/send custom song | any | any | direct gift-song | attack |
| song gift | find song-gift app | any | any | direct gift-song | attack |
| gift song | find song-gift app | any | any | direct gift-song | attack |

## Intent Expansion Search

The search path matters. Broad gift and family celebration searches mostly do not start with "song gift"; they start with recipient, occasion, or adjacent keepsake formats. That means the organic system needs web SEO and custom product pages to bridge the user from broad gift intent to the app install.

### Web/SERP Intent Checks

| Query | Dominant web intent | Repeated language | New candidates | Decision |
| --- | --- | --- | --- | --- |
| gift for dad personalized song | Father's Day gift guides and personalized gift pages | dad gift, unique, custom, meaningful | song gift for dad, father's day song gift | web/CPP |
| unique gift for mom custom song | personalized gift stores and gift guides | unique gift, mom, custom | custom song for mom, song gift for mom | web |
| anniversary gift for wife personalized song | anniversary gift guides and custom keepsakes | anniversary gift, wife, personalized | anniversary song for wife, custom love song | web/CPP |
| birthday surprise for husband custom song | birthday surprise ideas and relationship gifts | birthday surprise, husband, custom | song for husband birthday | web |
| graduation gift for son personalized song | graduation gift guides | graduation gift, son, keepsake | graduation song for son | web |
| memorial gift tribute song personalized | tribute/memorial keepsakes | memorial, tribute, remembrance | memorial song gift, celebration of life song | web |
| video montage gift personalized song alternative | group video gift and memory-video apps | video montage, group video, birthday video | song gift alternative, video-to-song gift | CPP/web |
| custom poem gift personalized song | custom poem and personalized keepsake pages | custom poem, personalized gift | poem alternative, personalized song gift | web |
| make a song for dad app | app/tool intent | make a song, dad, app | custom song for dad, father's day song | CPP/track |
| create birthday song app | app/tool intent, birthday video makers | birthday song, name song, video maker | create birthday song, birthday song maker | web/track |
| custom love song for wife gift | romantic gift/song intent | custom love song, wife, gift | custom love song, anniversary song for wife | CPP/web |
| personalized song gift app | direct app/category intent | personalized song, gift, app | personalized song gift, custom song gift | metadata/track |
| father's day song gift personalized dad | seasonal gift-song intent | Father's Day, Dad, song gift | father's day song, song gift for dad | IAE/CPP |
| mother's day song gift personalized mom | seasonal gift-song intent | Mother's Day, Mom, song gift | mother's day song, song gift for mom | seasonal |
| wedding song gift custom song | wedding gift/song intent | wedding song, custom song, gift | wedding song gift | web/track |
| birthday song for best friend gift | relationship birthday-song intent | best friend, birthday song, gift | best friend birthday song | web/track |

### App Store Autocomplete And Top-Result Checks

Apple Search Hints for US software returned mostly echo-only suggestions for sampled phrases. Autocomplete did not add meaningful phrase expansion, so the stronger App Store signal here is the top-result composition.

| Query | App Store top-result pattern | Porizo visibility | Competitor lane | Decision |
| --- | --- | ---: | --- | --- |
| gift for dad | dad communities, dad/pregnancy utilities, Snapfish, Personal Creations | not top 9 | generic gift/dad | reject App Store; web only |
| unique gift for mom | Callie, SOUFEEL, Peanut, gift baskets, Personal Creations, eCards | not top 7 | generic gift/card | web only |
| anniversary gift for wife | countdowns, photo frames, cards, GiftYa, Personal Creations | not top 10 | generic gift/card | web only |
| birthday surprise for husband | birthday cards, reminders, countdowns, Personal Creations | not top 10 | birthday utility/card | web only |
| graduation gift for son | invitation/school/gift apps | not top 9 | generic graduation/gift | web only |
| birthday surprise | kids games, countdowns, reminders, cards | not top 9 | birthday utility/card | reject App Store |
| song for husband | prayer/love/song apps, noisy results | tracked #17 | mixed relationship/song | web/track |
| song for wife | prayer/love/song apps, noisy results | tracked #20 | mixed relationship/song | web/track |
| memorial gift | Giftory, pet memorial, Mixbook, Memento, Ink Cards, FreePrints | not top 10 | memorial/photo/gift | web |
| video montage gift | VidDay, Memento, Leap Second, video editors | not top 9 | video gift | CPP/web |
| custom poem gift | Zazzle, Rhymer's Block, Floward, TouchNote, Printerval, SOUFEEL | not top 10 | poem/gift/card | web |
| make a song for dad | Muzio, Father's Day Song Maker, MyTunes, Jam, Mozart, Song Maker | not top 10 | AI-generator/seasonal | CPP/track |
| create birthday song | birthday video/name song apps, reminders, Muzio | not top 10 | birthday video/song | web/track |
| custom love song | MyTunes, Love Nudge, Lovebox, GiftSong, Porizo, SongSnap | #7 | relationship/direct song | support/CPP |
| personalized song gift | WishSong, GiftSong, SOUFEEL, Porizo/GiftSong mix | #1 to #4 by provider | direct gift-song/gift | attack/defend |
| song gift | WishAI, GiftSong, Mozart, Porizo | #5 | direct gift-song/AI | attack |
| birthday song gift | Porizo, GiftSong, Birthday Countdown/Cards, Givingli | #1 | direct gift-song/cards | defend |
| custom song gift | GiftSong, Porizo, Zazzle, TouchNote, MyTunes, SOUFEEL | #2 to #3 by provider | direct gift-song/gifts | attack |
| anniversary song gift | GiftSong, Porizo, WishSong, anniversary/card apps | #3 | direct gift-song | attack/defend |
| father's day song | Father's Day Song Maker, cards/photo/quotes apps | tracked #116; absent top 10 | seasonal song/cards | IAE/CPP |
| custom song for dad | Father's Day Song Maker, SongSnap, Dad Tribes, Mozart, HiDaddy | tracked #13, not top sample | seasonal song/AI | CPP/track |
| graduation song for son | music/songwriting/school results | tracked #23 | noisy song/graduation | web/track |
| ai song generator | Suno, Muzio, Donna, Mozart, Zona, Soniva, MyTunes | absent top 15 | AI-generator | track only |
| personalized gift | SOUFEEL, C.Gifts, FreePrints, Gifts.com, Zazzle, Personal Creations | tracked #17, not top sample | generic gift | web only |

## Normal-User Search Evidence

Normal users who do not know Porizo are not reliably searching "Porizo" or even "personalized song gift" first. The observed discovery routes are:

1. Recipient/occasion first: `gift for dad`, `anniversary gift for wife`, `birthday surprise for husband`.
2. Adjacent keepsake first: `video montage gift`, `custom poem gift`, `photo book gift`, `memorial gift`.
3. Song-creation first: `make a song for dad`, `create birthday song`, `custom love song`.
4. Direct category first: `song gift`, `gift song`, `custom song gift`, `birthday song gift`.

Porizo is already strongest in route 4. The main organic growth gap is routes 1-3. Those routes should be captured with web SEO, custom product pages, and seasonal in-app events before trying to force broad generic gift language into the App Store title/subtitle.

## Competitor Lane Map

### Direct Gift-Song Apps

Apps to steal traffic from first:

| Competitor | Evidence | Language to steal | Weakness to exploit |
| --- | --- | --- | --- |
| WishAI: Gift Song & Music Maker | #1 for `song gift` | gift song, music maker, AI gift | young category, likely low trust/review base |
| GiftSong: AI Song Maker | #1 for `custom song gift`, #1 `custom love song gift`, #2 `anniversary song gift` | custom song gift, love song, AI song maker | generic AI naming; Porizo can own occasion emotion |
| GiftSong | #2 `birthday song gift`, #3 `song gift` | gift song, birthday song | similar promise; beat with better occasion pages and reviews |
| WishSong: Gift Song | strong on `personalized song gift` | personalized song gift, wish/gift | attack with specific recipient/occasion promises |
| Father's Day Song Maker | #1 `father's day song`, #1 `custom song for dad` | Father's Day, Dad, song maker | seasonal narrow app; Porizo can win broader gift trust |

### AI-Generator Apps

Use this lane for discovery/supporting metadata only:

| Competitor | Evidence | Why not primary |
| --- | --- | --- |
| Suno | #1 `ai song generator`, huge review gravity | broad creator/music intent, not gift buyer intent |
| Muzio | top for `make a song...`, `ai song generator` | creator/generator intent; broader than Porizo |
| Donna, Mozart, Zona, Soniva, MyTunes | dominate AI song maker/generator searches | hard to outrank with tiny review base; lower gift qualification |

Keep AI terms as support: `ai`, `voice`, `song maker`, `custom song`, `text to song` only when the surface clearly says gift/occasion/recipient.

### Generic Gift/Card/Photo/Video/Tribute Competitors

These competitors own buyer language before the buyer knows a song is the solution:

| Lane | Competitors surfaced | Useful language |
| --- | --- | --- |
| Gift/card | SOUFEEL, Givingli, TouchNote, Zazzle, Personal Creations, Gifts.com, GiftYa | personalized gift, custom gift, card, last-minute gift |
| Photo/keepsake | FreePrints, Mixbook, Snapfish | photo gift, keepsake, memories |
| Video/group tribute | VidDay, Memento, Leap Second, CapCut, ScreenPal | video montage, group video, tribute |
| Memorial | Furever Pet in Heaven, Memorial, Ink Cards, Memento | memorial gift, remembrance, celebration of life |
| Poem/writing | Rhymer's Block, Zazzle poem/gift pages | custom poem, heartfelt message |

The theft strategy is not to rank Porizo for every broad gift query in the App Store. It is to intercept those queries on web and tailored CPPs, then convert them into "make a song from the memory" install intent.

## Demand Validation

### OpenASO / Kickstart Ranking Evidence

| Keyword | Porizo rank signal | Evidence | Interpretation |
| --- | ---: | --- | --- |
| birthday song gift | #1 | OpenASO/Kickstart samples | Defend; exact phrase works. |
| personalized song gift | #1 to #4 by provider | OpenASO/Kickstart provider disagreement | Keep defending; measure weekly. |
| custom song gift | #2 to #3 by provider | OpenASO/Kickstart | Attack GiftSong above us. |
| song gift | #5 | OpenASO/Kickstart | Highest-ROI attack lane. |
| gift song | #9 tracked; ASA converts | OpenASO + ASA | Keyword-field/tracking attack. |
| anniversary song gift | #3 | OpenASO sample | Attack/defend. |
| song gift for dad | #1 tracked / #2 sample | OpenASO | Seasonal defend/attack. |
| custom love song | #7 | Kickstart/OpenASO | Support relationship CPP. |
| custom song for dad | #13 tracked | OpenASO | Seasonal CPP/IAE. |
| father's day song | #116 tracked / absent top Kickstart sample | OpenASO/Kickstart | Urgent seasonal gap. |
| father's day song for dad | #85 tracked | OpenASO | Urgent seasonal gap. |
| graduation song for son | #23 tracked | OpenASO | Web first; not metadata priority. |
| song for husband | #17 tracked | OpenASO | Web/relationship page, not title. |
| personalized gift | #17 tracked but broad top results | OpenASO/App Store | Web only; generic App Store intent. |
| ai song generator | absent top 15 | OpenASO/Kickstart | Track only; not current primary lane. |

### Apple Search Ads Historical Demand

Latest local ASA snapshot: `marketing/appstore/aso/inputs/asa-2026-05-22.csv`.

| Search term | Impr | Taps | Installs | Spend | CPI | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| gift song | 63 | 9 | 3 | $2.65 | $0.88 | Strong App Store attack lane. |
| mother's day song | 16 | 3 | 2 | $0.15 | $0.07 | Seasonal song proof; reuse for Father's Day. |
| birthday gift ideas | 290 | 6 | 3 | $11.05 | $3.68 | Web/CPP, not title metadata. |
| personalized gift | 18 | 1 | 1 | $0.45 | $0.45 | Web-only generic gift signal. |
| music gift | 142 | 2 | 1 | $1.24 | $1.24 | Support phrase; not primary. |
| birthday gift | 122 | 3 | 1 | $4.17 | $4.17 | Web/CPP. |
| custom gift | 106 | 9 | 1 | $10.50 | $10.50 | Weak CVR; only use when paired with song. |
| my voice song app | 1920 | 9 | 0 | $11.01 | n/a | High impressions, poor install fit. |
| meaningful gift | 56 | 13 | 0 | $15.96 | n/a | High taps, zero installs; avoid broad spend. |
| personalized gifts | 107 | 13 | 0 | $15.60 | n/a | Broad generic traffic; not qualified enough. |
| i miss you song | 943 | 6 | 0 | $7.64 | n/a | No install proof; web/tracking only. |
| apology song | 817 | 4 | 0 | $5.14 | n/a | No install proof; web/tracking only. |
| long distance relationship gift | 356 | 2 | 0 | $2.84 | n/a | Web page/tracking only. |

Paid lesson: `song` + `gift` and seasonal `song` searches are the best paid proxy for organic demand. Generic gift terms can spend without installs unless they land on a very specific song-gift page or CPP.

### Google Search Console / Web Evidence

GSC screenshot baseline from the user:

- 3 months: 1 click, 101 impressions, 1% CTR, average position 4.
- Query visibility was almost entirely brand: `porizo` had 89 impressions and 1 click.
- Indexed pages: 9; not indexed: 39 as of 2026-05-18.

Live Porizo web inventory from sitemap and crawl:

- Core SEO pages: `/fathers-day-song`, `/birthday-song-maker`, `/anniversary-song-gift`, `/custom-song-gift`, `/wedding-song-gift`, `/song-in-your-voice`, `/songfinch-alternative`.
- Gift index: `/gifts/`.
- Programmatic gift pages include `fathers-day-song-for-dad`, `anniversary-song-for-wife`, `anniversary-song-for-husband`, `graduation-song-for-son`, `ai-song-generator-for-gifts`, `ai-song-for-dad`, `song-for-husband-birthday`, `best-friend-birthday-song`, and more.
- Blog inventory covers Father's Day, birthday song gifts, memorial, graduation, gender reveal, baby announcement, proposal, long distance, apology, and anniversary topics.

Assessment: the web inventory exists, but GSC indicates non-brand discovery is still close to zero. The current weakness is not only keyword selection; it is indexing, internal linking, page authority, and measurement of `/download` events by page/query.

## Bias Rejection

Rejected or demoted:

| Keyword/group | Reason | Surface |
| --- | --- | --- |
| porizo, porizo app, porizo song | brand-only; not demand discovery | reporting only |
| ai song generator, ai music generator, song generator | high traffic but broad creator intent and huge incumbents | tracking/support |
| music, song, lyrics, cover, voice alone | too generic without gift or occasion | reject/tracking |
| gift for dad, unique gift for mom, birthday surprise | broad gift intent; Porizo not App Store top results | web only |
| personalized gifts, meaningful gift | ASA spend/taps but zero installs | reject from App Store spend/metadata |
| i miss you song, apology song | paid traffic did not convert in current export | web/tracking only |
| competitor brands | not organic metadata; can be CPP/paid conquest only | track/CPP only |

Kept:

- Core App Store: `birthday song gift`, `custom song gift`, `personalized song gift`, `song gift`, `gift song`, `anniversary song gift`.
- Seasonal/recipient: `song gift for dad`, `father's day song`, `father's day song for dad`, `custom song for dad`, `custom song for mom`.
- Web/CPP bridges: `make a song for dad`, `create birthday song`, `custom love song`, `song for husband`, `song for wife`, `video montage gift`, `custom poem gift`, `memorial song gift`.

## Prioritized Keyword Sets

These are the operational keyword sets from the research. Use them for tracking, App Store surfaces, web pages, CPPs, and weekly review. Do not treat every set as App Store metadata; each set has one primary surface.

### Set 1: primary_app_store_rank_targets

Priority: P0  
Primary surface: App Store organic rank tracking, metadata tests after 1.5.14 has live data  
Owner metric: keyword rank, App Store Search impressions, product page views, first-time downloads, conversion rate

Keywords:

- `birthday song gift`
- `custom song gift`
- `personalized song gift`
- `song gift`
- `gift song`
- `anniversary song gift`
- `song gift for dad`
- `custom love song`
- `custom song for dad`

Why this set exists: these are the highest-fit App Store searches where users already understand they want a song as a gift. Porizo already ranks on several, so the opportunity is to defend #1 terms and move #3-#9 terms toward the top 3.

Evidence: OpenASO/Kickstart ranks plus ASA conversion for `gift song`.

### Set 2: metadata_token_candidates

Priority: P0 hold until 1.5.14 has data  
Primary surface: App Store keyword field, not title/subtitle right now  
Owner metric: rank movement for Set 1 and Set 3 phrases after live release

Current/submitted token field:

`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai`

Do not rotate yet. It is directionally correct because title/subtitle already carry `song`, `gift`, `maker`, `birthday`, `love`, and `wedding`.

Future token pool if the field is retested:

- `personalized`
- `custom`
- `voice`
- `mom`
- `dad`
- `anniversary`
- `fathers`
- `mothers`
- `day`
- `husband`
- `wife`
- `graduation`
- `ai`
- `memorial`
- `love`
- `birthday`

Why this set exists: phrase research has to become App Store-combinable tokens. The field should support phrases like `custom song for dad`, `anniversary song for wife`, `father's day song`, and `personalized song gift` without repeating title/subtitle tokens unnecessarily.

### Set 3: seasonal_sprint

Priority: P0 until Father's Day window closes, then P1 seasonal archive  
Primary surface: in-app event, dad CPP, Father's Day pages, exact/phrase ASA validation  
Owner metric: rank for Father's Day terms, event impressions, CPP product page views, first-time downloads

Keywords:

- `father's day song`
- `fathers day song`
- `father's day song for dad`
- `fathers day gift song`
- `father's day song gift`
- `song gift for dad`
- `custom song for dad`
- `make a song for dad`
- `ai song for dad`
- `birthday song for dad`
- `dad birthday song`

Why this set exists: Porizo is highly relevant but weak for `father's day song` (#116 tracked / absent top samples). This is the clearest immediate organic gap.

### Set 4: recipient_occasion_web

Priority: P1  
Primary surface: web SEO pages, internal links, GSC tracking  
Owner metric: GSC impressions/clicks by page and `/download` events by UTM/page

Keywords:

- `gift for dad`
- `unique gift for mom`
- `birthday surprise for husband`
- `birthday surprise for wife`
- `anniversary gift for wife`
- `anniversary gift for husband`
- `personalized anniversary gift`
- `graduation gift for son`
- `graduation gift for daughter`
- `birthday gift ideas`
- `wedding song gift`
- `memorial gift`
- `remembrance gift`

Why this set exists: this is how normal buyers start before they know "song gift" is the product category. These terms should bridge into Porizo through SEO and landing pages, not App Store metadata.

### Set 5: custom_product_page_targets

Priority: P1  
Primary surface: App Store custom product pages and routed web/ASA traffic  
Owner metric: CPP product page views, conversion rate, first-time downloads

Keywords:

- `father's day song`
- `song gift for dad`
- `custom song for dad`
- `make a song for dad`
- `personalized song gift`
- `custom song gift`
- `gift song`
- `custom love song`
- `anniversary song for wife`
- `anniversary song for husband`
- `song for husband`
- `song for wife`
- `memorial song gift`
- `video montage gift`

Why this set exists: these searches need a tailored first impression. A generic App Store page is too broad for dad, love, memorial, and alternative-format intent.

### Set 6: adjacent_format_conquest

Priority: P2  
Primary surface: web SEO comparison sections, CPP tests after core sets move  
Owner metric: GSC non-brand impressions, comparison-page `/download` clicks, CPP CVR if routed

Keywords:

- `video montage gift`
- `group video gift`
- `custom poem gift`
- `personalized card`
- `photo book gift`
- `voice message gift`
- `memorial gift`
- `tribute for dad`
- `celebration of life song`
- `pet memorial song`
- `song gift alternative`

Why this set exists: these competitors own the buyer before the buyer realizes a song can be the more emotional format. This is traffic theft through reframing, not direct App Store metadata.

### Set 7: tracking_only_or_rejected

Priority: watch/reject  
Primary surface: OpenASO/Kickstart tracking, negative paid lessons, no primary optimization  
Owner metric: only promote if rankings, installs, or web conversions prove qualified intent

Keywords:

- `ai song generator`
- `ai music generator`
- `song generator`
- `music`
- `song`
- `lyrics`
- `cover`
- `voice`
- `meaningful gift`
- `personalized gifts`
- `i miss you song`
- `apology song`
- `long distance relationship gift`
- `porizo`
- `porizo app`

Why this set exists: these terms are either too broad, brand-only, weak-converting in ASA, or dominated by larger AI/music apps. They should not pull the strategy away from gift/occasion intent.

## Validated Keyword Bank

| Keyword | Buyer job | Evidence | Current status | Primary surface | Decision |
| --- | --- | --- | --- | --- | --- |
| birthday song gift | send birthday song gift | Porizo #1 | strong | App Store tracking | defend |
| custom song gift | find custom song gift | Porizo #2/#3, GiftSong above | strong | App Store metadata/tracking | attack |
| personalized song gift | find personalized song app | Porizo #1/#4 by provider | strong but provider disagreement | App Store/web | defend/attack |
| song gift | find song gift app | Porizo #5, ASA validates `gift song` | high ROI | App Store tracking | attack top 3 |
| gift song | reversed phrase | ASA 3 installs at $0.88 CPI | high ROI | keyword field/tracking | attack |
| anniversary song gift | gift for spouse/partner | Porizo #3 | strong | web/tracking | attack |
| custom love song | romantic gift | Porizo #7 | medium/high | CPP/web | support |
| song gift for dad | Dad song gift | Porizo #1/#2 | strong | IAE/CPP/tracking | defend/attack |
| father's day song | Father's Day song | Porizo #116 / absent top samples | urgent gap | IAE/web/CPP | attack seasonally |
| father's day song for dad | specific Dad song | Porizo #85 | urgent gap | IAE/web/CPP | attack seasonally |
| custom song for dad | make Dad a song | tracked #13 | medium/high | CPP/tracking | attack |
| make a song for dad | normal-user action phrase | App Store AI/seasonal top results | medium | CPP/web/tracking | test |
| create birthday song | normal-user action phrase | birthday video/song apps own top results | medium | web/tracking | test |
| song for husband | dedication intent | tracked #17, noisy results | medium | web | track |
| song for wife | dedication intent | tracked #20, noisy results | medium | web | track |
| graduation song for son | graduation dedication | tracked #23 | medium | web | track |
| memorial song gift | tribute gift | web SERP validates memorial/tribute intent | unranked | web | build/track |
| video montage gift | adjacent gift format | VidDay/Memento own App Store results | adjacent | CPP/web | alternative angle |
| custom poem gift | adjacent keepsake format | poem/gift/card competitors own top results | adjacent | web | alternative angle |
| personalized gift | generic personalized gift | ASA one install but broad App Store results | weak App Store | web only | track |
| birthday gift ideas | broad birthday gift | ASA 3 installs, generic intent | weak App Store | web/CPP | web only |
| ai song generator | AI creation | Porizo absent top 15 | weak fit | tracking only | do not chase now |

## Surface Plan

### App Store Title/Subtitle

Keep the primary promise in gift/occasion language. The current/submitted package is strategically correct:

- Title: `Porizo: Song Gift Maker`
- Subtitle target: `Birthday, Love & Wedding Songs`

Do not pivot to `AI Song Generator`. That would put Porizo against Suno, Muzio, Donna, Mozart, Zona, Soniva, and MyTunes, while weakening the buyer-gift intent that is already ranking.

Next subtitle tests only after 1.5.14 is live and measured:

| Candidate | Why | Risk |
| --- | --- | --- |
| Birthday & Anniversary Songs | clearer exact occasion terms | loses love/wedding |
| Songs for Birthdays & Love | relationship plus occasion | less gift-specific |
| Custom Songs for Gifts | strongest category intent | may lose birthday/love specificity |

### Keyword Field

Current submitted US/CA keyword field remains directionally right:

`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai`

Future rotation candidates after data accrues: `gift`, `song`, `birthday`, `wife`, `husband`, `dad`, `mom`, `fathers`, `graduation`, `voice`, `ai`. Avoid repeating words already in title/subtitle unless App Store Connect limits force a tradeoff.

### In-App Event

Highest-priority seasonal action:

- Event: `Father's Day Song for Dad`
- Targets: `father's day song`, `father's day song for dad`, `song gift for dad`, `custom song for dad`, `make a song for dad`
- Promise: make Dad a personal song from one memory, preview free, finish for Father's Day.
- Reason: Porizo is weak for `father's day song` despite strong relevance and existing web pages.

### Custom Product Pages

Create or maintain these CPPs:

| CPP | Target queries | Message |
| --- | --- | --- |
| dad-song-gift | father's day song, song gift for dad, custom song for dad, make a song for dad | Make Dad a song from one real memory. |
| custom-song-gift | custom song gift, personalized song gift, gift song, song gift | A custom song gift in minutes. |
| love-song-gift | custom love song, song for husband, song for wife, anniversary song gift | Turn your relationship story into a song. |
| memorial-tribute-song | memorial song gift, celebration of life song, tribute for dad | A song from the memory they left you. |
| video-to-song-gift | video montage gift, custom poem gift, photo book gift | More personal than a card or montage. |

### Web SEO

Existing priority pages to index, internally link, and measure:

- `/gifts/`
- `/fathers-day-song`
- `/birthday-song-maker`
- `/anniversary-song-gift`
- `/custom-song-gift`
- `/gifts/fathers-day-song-for-dad`
- `/gifts/anniversary-song-for-wife`
- `/gifts/anniversary-song-for-husband`
- `/gifts/graduation-song-for-son`
- `/gifts/ai-song-generator-for-gifts`
- `/gifts/song-for-husband-birthday`
- `/gifts/best-friend-birthday-song`

Recommended web fixes:

1. Request GSC indexing for the gift index and top gift pages.
2. Strengthen internal links from homepage and blog posts to the top gift pages using exact-but-natural anchors.
3. Add comparison/alternative sections on relevant pages: video montage gift, custom poem gift, photo book gift, personalized card.
4. Ensure every SEO page has a visible `/download` CTA with UTM parameters tied to page and query cluster.
5. Clean the homepage dynamic headline if it still renders awkward combined phrases such as "Turn her 30th your proposal mom's love..." because it can weaken first impression and snippets.

### Tracking Only

Track but do not optimize primary metadata for:

- `ai song generator`
- `ai music generator`
- `song generator`
- `make a song with my voice`
- `voice song maker`
- `lyrics to song ai`
- `meaningful gift`
- `personalized gifts`
- `apology song`
- `i miss you song`
- `long distance relationship gift`

## Implementation Plan

Recommended order:

1. Hold metadata until 1.5.14 is live, then record exact live release date/time.
2. Measure 1.5.14 for 7 days before another title/subtitle/keyword-field mutation.
3. Submit Father's Day in-app event if App Store Connect timing still allows it.
4. Create/use `dad-song-gift` CPP and route Father's Day web/ASA links there.
5. Keep ASA in install-only protection: exact/phrase validation only, no broad generic gift spend unless a CPP proves installs.
6. Request GSC indexing for the gift index and top gift pages.
7. Add/track discovered bridge keywords in OpenASO/Kickstart/local tracking: `make a song for dad`, `create birthday song`, `video montage gift`, `custom poem gift`, `memorial song gift`, `celebration of life song`, `song for dad`, `song for mom`, `birthday surprise for husband`, `graduation gift for son`.
8. Build weekly reporting that separates organic App Store Search from paid Apple Search Ads, and web `/download` from App Store product-page traffic.

Expected ranking/indexing delay:

- App Store metadata: can begin indexing within 24-72 hours after live release, but meaningful rank/conversion movement usually needs 7-14 days.
- In-app event: can affect seasonal visibility after approval/live status.
- Web SEO: days to weeks after indexing; current GSC non-brand baseline is near zero.

## Weekly Measurement Plan

Compare last 7 days vs prior 7 days and vs the 2026-05-24 baseline.

| Metric | Source | Segment |
| --- | --- | --- |
| Keyword rank | OpenASO + Kickstart | US/iPhone, keyword |
| App Store Search impressions | App Store Connect | US, source=App Store Search |
| Product page views | App Store Connect | US, source and CPP if available |
| First-time downloads / app units | App Store Connect | organic vs paid where possible |
| Product page conversion rate | App Store Connect | page views to downloads |
| Paid spend and installs | Apple Search Ads | search term, match type, campaign |
| Web impressions/clicks/CTR/position | Google Search Console | query and page |
| `/download` events | web analytics/backend | page, utm_source, utm_campaign, keyword cluster |
| App opens after download | app analytics/attribution | deep link/install handoff |
| Reviews/ratings | App Store Connect/OpenASO | rating count and recent review text |

Keyword watchlist:

- Core: `birthday song gift`, `custom song gift`, `personalized song gift`, `song gift`, `gift song`, `anniversary song gift`.
- Seasonal: `father's day song`, `father's day song for dad`, `song gift for dad`, `custom song for dad`, `make a song for dad`.
- Bridge/web: `create birthday song`, `song for husband`, `song for wife`, `graduation song for son`, `memorial song gift`, `video montage gift`, `custom poem gift`.
- Reject/watch-only: `ai song generator`, `meaningful gift`, `personalized gifts`, `apology song`, `i miss you song`.

Success thresholds for the next weekly check:

- `song gift`: #5 toward top 3.
- `custom song gift`: #2/#3 toward #1.
- `personalized song gift`: provider-disagreement resolved and stable top 3.
- `father's day song`: #116 into top 50 after event/CPP/web changes.
- App Store Search impressions increase week over week without paid spend masking the lift.
- GSC shows non-brand impressions for at least three gift/song pages.
- `/download` events are attributable to page and keyword cluster.

## Loopholes And Fixes

| Loophole | Risk | Fix |
| --- | --- | --- |
| Live listing is still 1.5.13 | Cannot evaluate submitted subtitle yet | Wait for 1.5.14 live; record exact date. |
| OpenASO popularity failed | Volume confidence incomplete | Use ASA impressions, rank movement, and GSC query growth. |
| Kickstart analytics unavailable | No direct install/ROI data inside Kickstart | Use ASC and ASA exports weekly. |
| GSC is screenshot-only | No query/page export proof yet | Export GSC query/page data weekly or connect API. |
| App Store autocomplete echo-only | Weak expansion signal | Use top-result composition plus web SERP language. |
| Porizo rating count is tiny | Ranking/conversion trust ceiling | Add review prompts around successful preview/share/save moments. |
| Generic gift terms spend without installs | Broad demand can waste money and metadata | Keep generic gift on web/CPP until conversion proof. |
| AI-generator incumbents are massive | Chasing generic AI weakens fit and likely loses | Keep AI as support lane only. |
| Web pages exist but are barely visible | Organic web traffic may not move without indexing/links | Request indexing, strengthen internal links, track `/download`. |

## Confidence

I am confident in the direction: Porizo should keep gift/occasion as the primary App Store lane, attack exact direct gift-song keywords, and use web SEO plus CPPs to capture broader buyer language before the buyer knows a song app is the answer.

I am not 100% confident in volume sizing because OpenASO popularity failed and GSC is screenshot-only. The fix is not to change the strategy; it is to instrument weekly measurement and run the next pass with ASC App Store Search impressions, GSC query/page export, and refreshed OpenASO/Kickstart ranks.
