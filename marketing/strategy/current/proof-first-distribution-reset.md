# Current Push: Proof-First Distribution Reset

**Date:** 2026-05-15  
**Owner:** Ambrose  
**Status:** Active

**Implementation plan:** [`proof-sprint-implementation-plan.md`](proof-sprint-implementation-plan.md)

## Verdict

Porizo is not failing because one Apple Search Ads bid, one keyword, or one email subject is wrong. The distribution problem is that we have been treating GTM like a tooling problem before proving a message/channel pair. The next push is to create public proof that a finished song is emotionally valuable, then use channels to amplify the proof.

## Core Assumption

Someone with an upcoming emotional occasion will download Porizo and create a song if they first see a believable example that feels personal, not gimmicky.

## Current ICP and Moment

Primary buyer: women 25-45 buying an emotional birthday, anniversary, parent, partner, or best-friend gift.

Primary moment: "I want to say something meaningful, but a card or generic gift feels too small."

Current positioning:

> Turn the story you never know how to say out loud into a song they can keep.

## What Changes Now

1. Lead with the finished song or recipient reaction, not the app.
2. Stop treating cold email and paid ads as the main engine until proof exists.
3. Keep Apple Search Ads painkiller tests running as measurement, but do not scale paid from weak signal.
4. Build one proof surface at a time: real songs, real stories, believable reactions, clear download path.
5. Measure completed songs and meaningful replies, not just impressions, clicks, or installs.

## 14-Day Proof Sprint

### Assets to Produce

- 3 finished songs from specific, believable stories.
- 1 recipient reaction if permission is possible.
- 1 landing/download surface that shows the song first and app features second.
- 5 short-form clips built from those songs/reactions.
- 3 Reddit/story posts that lead with the story, not the product pitch.

### Manual Distribution

- Personally contact 30 people with upcoming gift occasions.
- Offer a free concierge song in exchange for honest feedback.
- Ask for permission to reuse anonymized story/song/reaction only after the recipient has heard it.
- DM 20 tightly matched micro-creators only after at least one proof asset is strong enough to show.

### Paid and Email

- Apple Search Ads: keep the raised painkiller bids running long enough to test delivery. Review via `scripts/aso/spend-history.mjs --days 3` for monitoring and `scripts/aso/review.mjs --days 30` for ASO rerank.
- Cold email: pause generic broad sends unless the audience is specific, permissioned, and tied to a concrete occasion.
- Meta/TikTok paid: do not increase spend until one organic proof asset shows meaningful engagement or download intent.

## Success Thresholds

Within 14 days, this push should produce at least one of:

- 10 completed concierge songs from people outside the immediate inner circle.
- 3 usable testimonials or recipient reactions.
- 25 App Store clicks from proof-led content.
- 5 completed songs from non-paid/non-brand sources.

If none of those happen, the issue is likely not channel selection. It means the offer, proof, or first-run product experience is not compelling enough yet.

## Channel Owners

- App Store and Apple Search Ads: [`appstore/`](appstore/) and [`appstore/aso/`](appstore/aso/)
- Traffic and attribution: [`funnels/`](funnels/)
- Social/content references: [`channels/social/`](channels/social/)
- Email references: [`channels/email/`](channels/email/)
- Creator and partner motion: [`channels/creators/`](channels/creators/)
- Tried/completed strategies: [`../achieved/`](../achieved/)
- Historical GTM operating system: [`../../gtm/`](../../gtm/)
