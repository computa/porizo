# Porizo Traffic Execution Plan

Date: 2026-05-08

This plan is for creating traffic, not waiting for organic discovery. SEO pages are the landing and measurement layer; the traffic must come from paid intent, short-form demand creation, creators, and partner distribution.

## Measurement Contract

Use these UTM fields on every public link:

- `utm_source`: channel owner, e.g. `apple_search_ads`, `tiktok`, `instagram`, `creator`, `partner`
- `utm_medium`: acquisition type, e.g. `paid_search`, `short_video`, `creator_seed`, `newsletter`, `community`
- `utm_campaign`: campaign theme, e.g. `mothers_day_2026`, `birthday_song_2026`
- `utm_content`: creative or partner id, e.g. `hook_tears_01`, `creator_jane_01`

Download clicks are tracked by `/download`. Shared-song recipient clicks are tracked as:

- `utm_source=share_player`
- `utm_medium=recipient_loop`
- `utm_campaign=shared_song_recipient`
- `utm_content=<placement>_<share_id>`

## Week 1 Traffic Targets

- 500 landing page visits from non-search sources.
- 150 App Store clicks from landing pages or share pages.
- 40 new registrations.
- 10 completed songs.
- 3 usable testimonials or replies.

If registrations remain far below Apple-reported installs, treat it as onboarding or attribution loss, not a channel win.

## Channel 1: Apple Search Ads

Goal: capture high-intent searches that already contain gift/song intent.

Campaigns:

- `asa_exact_custom_song_gift`
- `asa_exact_birthday_song`
- `asa_exact_mothers_day_song`
- `asa_discovery_song_gift`

Keyword groups:

- `custom song gift`, `personalized song gift`, `song gift`
- `birthday song maker`, `birthday song gift`, `custom birthday song`
- `mother's day song`, `mothers day song gift`, `song for mom`
- `anniversary song gift`, `love song gift`

Rules:

- Start exact-match only for the first 48 hours.
- Pause any keyword with installs but no backend registration after 20 taps.
- Move spend toward keywords with registrations, not just installs.
- Keep broad/discovery below 20% of daily spend until registration tracking is stable.

## Channel 2: Short-Form Video

Goal: create demand for people who are not searching yet.

Publish 3 videos per day for 7 days. Every caption links to the relevant landing page, then `/download`.

Primary URLs:

- `https://porizo.co/mothers-day-song?utm_source=tiktok&utm_medium=short_video&utm_campaign=mothers_day_2026&utm_content=<creative_id>`
- `https://porizo.co/birthday-song-maker?utm_source=tiktok&utm_medium=short_video&utm_campaign=birthday_song_2026&utm_content=<creative_id>`
- `https://porizo.co/custom-song-gift?utm_source=tiktok&utm_medium=short_video&utm_campaign=custom_song_gift_2026&utm_content=<creative_id>`

Creative angles:

- “I turned one memory into a song for my mum.”
- “A birthday gift that does not feel copied from a template.”
- “Send a song instead of another card.”
- “The recipient hears their own story in the lyrics.”
- “Last-minute gift, but personal.”

Minimum creative format:

- First 2 seconds show the emotional object: recipient reaction, lyric line, or finished song screen.
- One clear recipient: mum, partner, dad, best friend.
- One CTA: “Make yours free in Porizo.”

## Channel 3: Creator Seeding

Goal: borrow trust and emotion from small creators with specific audiences.

Target creators:

- Motherhood creators under 50k followers.
- Gift guide creators.
- Relationship/couple creators.
- Diaspora family creators.
- Wedding/anniversary creators.

Offer:

- Free song generation for one named person.
- Creator gets a private share link.
- Ask for a reaction video or story post only if they like the result.

Tracking:

- Creator link: `https://porizo.co/custom-song-gift?utm_source=creator&utm_medium=creator_seed&utm_campaign=custom_song_gift_2026&utm_content=<creator_handle>`
- App click: route through `/download` from the landing page.

Daily quota:

- 20 creator DMs per day.
- 5 completed free songs per day for creators who reply.
- Log each creator in `docs/growth/creator-outreach.csv`.

## Channel 4: Partner Distribution

Goal: place Porizo where people are already thinking about gifts.

Targets:

- Local florists.
- Event planners.
- Birthday reminder newsletters.
- Mother's Day gift guide sites.
- Card and gift communities.

Partner link:

`https://porizo.co/custom-song-gift?utm_source=partner&utm_medium=community&utm_campaign=custom_song_gift_2026&utm_content=<partner_slug>`

Offer:

- “Add a personalized song gift to your card/flower/gift bundle.”
- Provide one demo link and one 30-second vertical video.

## Channel 5: Recipient Loop

Goal: every shared song becomes a new acquisition surface.

Implemented tracking:

- Share page App Store CTA.
- Teaser unlock CTA.
- Post-play CTA.

Operational rule:

- Every completed song should produce a share link.
- Weekly report should separate recipient-loop downloads from paid and creator traffic.
- If recipient-loop clicks are low, improve the shared-song web player CTA before increasing ad spend.

## Daily Review

Review these every day before changing spend:

- Landing visits by campaign.
- `/download` clicks by campaign.
- Backend registrations by source/campaign.
- Completed songs by source/campaign.
- Bounce emails and user feedback replies.
- Apple Ads taps vs backend registrations.

Decision rules:

- Double down only when a source produces completed songs.
- Do not optimize for installs alone.
- Pause campaigns that create installs with no registrations until onboarding instrumentation explains the gap.
- Keep one organic/creator experiment running even when paid is active; paid data alone will not reveal message-market fit.
