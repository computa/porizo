# Porizo Traffic Execution Plan

Date: 2026-05-08

This plan is for creating traffic without Apple Ads. SEO pages are the landing
and measurement layer; organic App Store search, Google-visible web pages,
short-form demand creation, creators, partners, and the recipient loop are the
active channels.

## Measurement Contract

Use these UTM fields on every public link:

- `utm_source`: channel owner, e.g. `seo`, `tiktok`, `instagram`, `creator`,
  `partner`, `share_player`
- `utm_medium`: acquisition type, e.g. `organic_search`, `landing_page`,
  `programmatic`, `blog`, `short_video`, `creator_seed`, `newsletter`,
  `community`
- `utm_campaign`: campaign theme, e.g. `mothers_day_2026`, `birthday_song_2026`
- `utm_content`: creative or partner id, e.g. `hook_tears_01`, `creator_jane_01`

Download clicks are tracked by `/download`. Shared-song recipient clicks are tracked as:

- `utm_source=share_player`
- `utm_medium=recipient_loop`
- `utm_campaign=shared_song_recipient`
- `utm_content=<placement>_<share_id>`

## Week 1 Traffic Targets

- 25 priority web pages submitted or resubmitted for indexing in Google Search
  Console.
- 10 non-brand GSC queries appearing across `/gifts/`, landing pages, and blog
  posts.
- 150 App Store clicks from landing pages, blog posts, programmatic pages, or
  share pages.
- 40 new registrations.
- 10 completed songs.
- 3 usable testimonials, reviews, or recipient replies.

If registrations remain far below Apple-reported installs, treat it as onboarding or attribution loss, not a channel win.

## Channel 1: Organic ASO And Web Search

Goal: capture high-intent searches that already contain gift/song intent, then
bridge broader gift searches through web pages before asking for the install.

Primary App Store rank targets:

- `birthday song gift`
- `custom song gift`
- `personalized song gift`
- `song gift`
- `gift song`
- `anniversary song gift`

ASC keyword-field source for the next metadata upload:

`personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation,ai,music`

Rules:

- Keep `gift/occasion` as the main App Store promise.
- Use Kickstart competitor tokens such as `music`, `generator`, `lyrics`,
  `cover`, and `voice changer` as tracking inputs first; only `music` is packed
  into the current 100-character keyword-field source.
- Do not execute Apple Ads scripts or mutate paid campaigns while the active
  strategy is organic.
- Request indexing for `/gifts/`, `/custom-song-gift`,
  `/birthday-song-maker`, `/anniversary-song-gift`, `/fathers-day-song`,
  `/wedding-song-gift`, and the top recipient pages under `/gifts/`.
- Every indexed page should route App Store clicks through `/download` with
  `utm_source=seo` and a page-specific `utm_campaign`.

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
- Log each creator in `marketing/channels/creators/creator-outreach.csv`.

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

Review these every day during the first week, then weekly once indexing is stable:

- Landing visits by campaign.
- `/download` clicks by campaign.
- Backend registrations by source/campaign.
- Completed songs by source/campaign.
- Bounce emails and user feedback replies.
- GSC query/page impressions, clicks, CTR, and average position.
- App Store Search impressions, product page views, first-time downloads, and
  product page conversion rate.

Decision rules:

- Double down only when a source produces completed songs.
- Do not optimize for installs alone.
- If a page gets impressions but no clicks, rewrite title/meta and strengthen
  internal links.
- If App Store rank improves but conversion does not, improve screenshots,
  reviews, and landing context before broadening metadata.
- Keep one organic/creator experiment running every week; historical paid data
  is evidence, not the operating channel.
