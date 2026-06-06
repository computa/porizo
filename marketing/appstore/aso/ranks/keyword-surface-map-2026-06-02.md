# Porizo Organic Keyword-To-Surface Map

Created: 2026-06-02

Purpose: this file turns the organic search research into concrete implementation targets. Each keyword cluster gets one primary App Store surface so Porizo does not dilute relevance by trying to make every page say everything.

## Current Default Listing

Default app name: `Porizo: Song Gift Maker`

Default subtitle: `Birthday, Love & Wedding Songs`

Staged keyword field source: `personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music`

Default screenshots currently lead with: `Create a song gift for someone you love`

## Surface Rules

Default page owns the broadest and strongest exact phrase: `song gift`.

Custom Product Pages own narrower search intent where the first screenshot can exactly match the query: `gift song`, `custom song gift`, `anniversary song gift`, and Dad/Father's Day searches.

Web SEO owns generic gift discovery terms such as `birthday gift ideas`, `birthday gift`, `custom gift`, and `personalized gift`.

Tracking only terms are broad AI/music terms where relevance exists but competition and intent are weak for Porizo's gift-first product.

## Primary Map

| Keyword or Cluster | Current Signal | Primary Surface | Organic Relevance Action | Status |
| --- | --- | --- | --- | --- |
| `song gift` | Live OpenASO #3 on 2026-06-02; local CSV #5 on 2026-06-01 | Default page | Keep title `Porizo: Song Gift Maker`; default screenshot 1 keeps `song gift` phrase | In place |
| `birthday song gift` | Live OpenASO #1 on 2026-06-02; screenshot showed #46 earlier | Default page and birthday-oriented default screenshots | Keep birthday in subtitle and description; make one default screenshot use `birthday song gift` language | Needs screenshot update |
| `anniversary song gift` | Live OpenASO #1 on 2026-06-02; local CSV #18 on 2026-06-01 | Anniversary CPP | Add CPP with anniversary-specific screenshots and copy; keep `anniversary` in keyword field | Spec started |
| `custom song gift` | Live OpenASO #2 on 2026-06-02; screenshot showed #71 earlier | Custom Song Gift CPP | Add CPP with custom-story screenshots; include `custom song gift` as assigned search combination | Spec started |
| `gift song` | Local/screenshot rank around #37; live keyword sample did not return Porizo in top 10 on 2026-06-02 | Gift Song CPP | Add CPP with exact `gift song` copy; route owned web pages for gift-song language to it | Spec started |
| `song gift for dad` | Live OpenASO #1 on 2026-06-02 | Existing Dad CPP and Dad/Father's Day surfaces | Update stale CPP language; verify Dad screenshot set and promotional date | Partially implemented |
| `song gift for mom` | Live OpenASO #1 on 2026-06-02 | Default page initially; future Mom CPP near Mother's Day | Keep `mom` and `mothers` tokens; do not create Mom CPP until seasonal timing returns | Deferred |
| `father's day song` | Screenshot/local rank around #47; seasonal opportunity before 2026-06-21 | Existing Dad CPP plus In-App Event | Correct Father's Day date; update Dad CPP note about organic search; use Dad screenshots | Partially implemented |
| `father's day song for dad` | Screenshot/local rank around #83 | Existing Dad CPP plus In-App Event | Same as above; prioritize first-slide headline `Make Dad a Father's Day song` | Partially implemented |
| `birthday song` | Screenshot rank #112; broad and noisy | Tracking plus default birthday screenshot | Do not optimize default metadata around this alone; use birthday song gift phrasing | Tracking |
| `custom song` | Unranked or weak; broad AI/music intent | Tracking only | Keep `custom` token but do not make default page about generic custom songs | Tracking |
| `personalized song` | Screenshot rank #175; broad creator intent | Tracking only | Keep `personalized` token; push `personalized song gift` via CPP/default copy | Tracking |
| `personalized song gift` | Live OpenASO #1 on 2026-06-02 | Custom Song Gift CPP and default description | Use as supporting keyword in Custom Song Gift CPP | Spec started |
| `birthday gift ideas` | ASA evidence had installs; App Store result set broad | Web SEO | Use web pages and smart banner/download attribution, not App Store default metadata | Web only |
| `birthday gift` | ASA evidence had installs; App Store result set broad | Web SEO | Same as above; App Store keyword field can keep birthday via subtitle, not hidden field | Web only |
| `ai song generator` | High popularity, top results are Suno/Muzio/Donna/Mozart/Zona; Porizo not competitive | Optional AI support CPP later | Add `generator` only if shipping AI support CPP; do not alter default title | Deferred |
| `ai music generator` | High popularity, same broad AI lane | Optional AI support CPP later | Keep `ai` and `music`; add `generator` only after gift surfaces are done | Deferred |

## Metadata Token Recommendation

Default low-risk staged keyword field:

`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music`

This is 98 characters. It keeps the gift and occasion strategy intact.

Optional AI-support keyword field if an AI support CPP is shipped:

`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,ai,music,generator`

This is 97 characters. It drops `graduation` to add `generator`. Do not use this version unless the default listing or a CPP has screenshots that make the AI-generator promise clear.

## Screenshot Implementation Notes

Default screenshot slot 1 should stay:

`Create a song gift for someone you love`

Default screenshot slot 2 should become:

`Choose Mom, Dad, or partner`

Default screenshot slot 3 should become:

`Tell a birthday memory`

Gift Song CPP slot 1:

`Create a gift song today`

Custom Song Gift CPP slot 1:

`Turn their story into a song`

Anniversary CPP slot 1:

`Make your anniversary a song`

Dad CPP slot 1:

`Make Dad a Father's Day song`

## Measurement

Measure weekly without paid ads:

- App Store Search rank for each keyword.
- App Store Search impressions when App Store Connect data is available.
- Product page views.
- First-time downloads.
- Conversion rate from product page views to downloads.
- Review count and rating.
- Web `/download` events by landing page and campaign parameters.

Do not judge a CPP from fewer than 1,000 product page views unless the result is a clear operational failure, such as wrong copy, wrong asset, or broken URL routing.
