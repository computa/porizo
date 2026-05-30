# SEO and Blog

Blog drafts live in [`../../blog/`](../../blog/).

Current GTM stance: SEO is the active organic traffic layer now that Apple Ads
are stopped. Use App Store metadata for high-intent song-gift searches, and use
web pages to capture broader gift, recipient, occasion, and adjacent-keepsake
queries before the buyer knows a song app is the answer.

## Priority Search Clusters

| Cluster | Primary pages | Search intent | Weekly owner metric |
| --- | --- | --- | --- |
| Direct song gift | `/custom-song-gift`, `/birthday-song-maker`, `/anniversary-song-gift`, `/wedding-song-gift` | Buyers already looking for a song gift | GSC clicks, `/download` clicks, App Store Search impressions |
| Recipient/occasion | `/gifts/fathers-day-song-for-dad`, `/gifts/song-for-husband-birthday`, `/gifts/best-friend-birthday-song`, `/gifts/graduation-song-for-son` | Buyers searching by person or moment | GSC impressions and page-level `/download` |
| Adjacent keepsake | blog posts for memorial, apology, long-distance, proposal, baby announcement, graduation | Buyers comparing gifts, cards, videos, poems, or tributes | Non-brand query growth and assisted `/download` |
| AI support | `/gifts/ai-song-generator-for-gifts`, `/gifts/personalized-ai-song-generator`, `/gifts/ai-song-maker-for-birthday` | Generator/maker language with gift context | Rank only; promote only if conversion follows |

## Weekly Organic Loop

1. Refresh OpenASO/Kickstart ranks for the tracked App Store keywords.
2. In Google Search Console, request indexing for any priority URL not indexed.
3. Check non-brand queries by page, especially `song gift`, `custom song gift`,
   `birthday song gift`, recipient pages, and adjacent-format pages.
4. Add internal links from matching blog posts to the strongest landing or
   `/gifts/` page.
5. Compare `/download` events by `utm_medium`:
   `landing_page`, `programmatic`, `blog`, and `smart_banner`.

Do not use Apple Ads execution as part of this loop. Historical paid-search
rows can inform keyword relevance, but active decisions should come from rank,
GSC, App Store Search, product-page conversion, and backend completion data.
