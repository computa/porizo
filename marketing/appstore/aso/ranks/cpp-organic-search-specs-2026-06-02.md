# Organic Search CPP And Screenshot Specs

Created: 2026-06-02

Purpose: this file starts implementation for the organic App Store search relevance plan. It gives concrete copy, screenshot order, and keyword assignments for the Custom Product Pages and default screenshot updates that should be built next.

## Global Constraints

Do not change the live App Store listing or submit App Store Connect changes without explicit approval.

Use the existing screenshot generator at `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/`.

Keep the default app name as `Porizo: Song Gift Maker`.

Keep each CPP focused. A CPP should match one search job, not every song-gift phrase.

Do not use competitor brand names in keywords or copy.

## Default Page Refresh

Goal: keep the default page strong for `song gift`, while making the first three screenshots more relevant to birthday and recipient/person searches.

Default screenshot order:

1. `Create a song gift for someone you love`
   Screen: finished reveal/player with recipient Sarah and birthday occasion.
   Purpose: preserves strongest current lane, `song gift`.

2. `Choose Mom, Dad, or partner`
   Screen: recipient picker.
   Purpose: improves visible relevance to `song gift for mom`, `song gift for dad`, `song for wife`, and `song for husband`.

3. `Tell a birthday memory`
   Screen: message/story prompt.
   Purpose: improves visible relevance to `birthday song gift` while matching the actual story-input slide.

4. `Tell us what you want to say`
   Screen: message/story prompt.
   Purpose: shows emotional input.

5. `Share the song in one tap`
   Screen: Messages share preview.
   Purpose: shows gift delivery.

Notes: the current default set already has five slides. This refresh is mostly a headline and ordering change, not a new visual system.

## CPP 1: Gift Song

Reference name: `Gift Song - Organic Search`

Primary search keywords:

- `gift song`
- `gift song maker`
- `gift song app`

Promotional text, 116 chars:

`Create a gift song from one real memory. Tell the story, preview it free, then send a song they can replay.`

Screenshot order:

1. `Create a gift song today`
   Screen: finished reveal/player.
   In-phone copy: recipient Sarah, occasion Happy Birthday, CTA Share with Sarah.

2. `Start with one memory`
   Screen: story/message prompt.
   In-phone copy: prompt about a real memory, not generic lyrics.

3. `Pick who it is for`
   Screen: recipient picker.
   In-phone copy: Mom, Dad, Partner, Sister, Brother, Best Friend.

4. `Hear it before you gift it`
   Screen: player with preview.
   In-phone copy: tap to play, listen with lyrics.

5. `Send a private song link`
   Screen: Messages share preview.
   In-phone copy: card says A song made just for you.

Hypothesis: `gift song` searchers are already looking for a song-as-present product, so exact wording on slide 1 should improve tap-through and product-page conversion compared with the default `song gift` word order.

Build note: `gift` variant added to the screenshot generator. Generated assets are in `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-gift/`.

## CPP 2: Custom Song Gift

Reference name: `Custom Song Gift - Organic Search`

Primary search keywords:

- `custom song gift`
- `personalized song gift`
- `custom love song gift`

Promotional text, 120 chars:

`Turn their name, memory, and message into a custom song gift. Preview it free, then send the finished song.`

Screenshot order:

1. `Turn their story into a song`
   Screen: story/message prompt with a memory card.
   In-phone copy: Something I have never said out loud.

2. `Add their name and moment`
   Screen: recipient and occasion setup.
   In-phone copy: Sarah, Happy Birthday.

3. `Choose the sound`
   Screen: style or voice picker.
   In-phone copy: show that the user controls genre or voice.

4. `Preview before you finish`
   Screen: player preview.
   In-phone copy: 45-second preview.

5. `Gift it privately`
   Screen: Messages share preview.
   In-phone copy: song link card.

Hypothesis: `custom song gift` and `personalized song gift` users care about specificity and emotional fit. The screenshots should show inputs, not just a finished player.

Build note: `custom` variant added to the screenshot generator. Generated assets are in `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-custom/`.

## CPP 3: Anniversary Song Gift

Reference name: `Anniversary Song Gift - Organic Search`

Primary search keywords:

- `anniversary song gift`
- `anniversary song for wife`
- `song for wife`
- `song for husband`

Promotional text, 122 chars:

`Turn your anniversary memory into a personal song for your partner. Add their name, preview it free, then gift it.`

Screenshot order:

1. `Make your anniversary a song`
   Screen: finished reveal/player.
   In-phone copy: For Emma, Happy Anniversary.

2. `Start with your best memory`
   Screen: story/message prompt.
   In-phone copy: the first trip, the vows, the moment you knew.

3. `Write it for your partner`
   Screen: recipient picker or recipient form.
   In-phone copy: wife, husband, partner.

4. `Hear it in minutes`
   Screen: player preview.
   In-phone copy: listen with lyrics.

5. `Send a private song gift`
   Screen: Messages share preview.
   In-phone copy: I made this for our anniversary.

Hypothesis: anniversary searchers are high-intent but relationship-specific. The default page says love and wedding, but a dedicated anniversary page should convert better because it says the occasion directly.

Build note: `anniversary` variant added to the screenshot generator. Generated assets are in `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/generator-designed/exports-anniversary/`.

## Existing CPP: Dad / Father's Day

Existing file: `/Users/ao/Documents/projects/porizo/marketing/appstore/aso/cpp-dad-song-gift.md`

Existing screenshots: `/Users/ao/Documents/projects/porizo/marketing/appstore/screenshots/cpp-dad/`

Recommended updates:

1. Replace the statement that CPPs do not affect organic search with a current statement: CPPs can be associated with App Store search keywords, and this Dad page should be assigned Dad/Father's Day combinations where available.

2. Change slot 1 headline from `A song for Dad, from one memory` to `Make Dad a Father's Day song` for the seasonal window ending 2026-06-21.

3. Fix any local promotional text that says Father's Day is June 15. The US date in 2026 is Sunday, June 21.

Primary search keywords:

- `father's day song`
- `father's day song for dad`
- `song gift for dad`
- `custom song for dad`
- `make a song for dad`

## Optional CPP 4: AI Song Gift

Do not build this until the three gift-first CPPs above are implemented.

Reference name: `AI Song Gift - Organic Search`

Primary search keywords:

- `ai song generator`
- `ai music generator`
- `ai song maker`
- `ai music maker`
- `personalized ai song`

Promotional text, 115 chars:

`Create an AI song that feels personal. Add a name, memory, and message, then preview your song gift free.`

Screenshot order:

1. `Create a personal AI song`
2. `Add a name and memory`
3. `Choose the sound`
4. `Preview the song free`
5. `Send it as a gift`

Risk: this page may improve AI keyword relevance but could attract lower-fit creator traffic. Ship only if gift-first surfaces are done and the keyword field includes `generator`.

## App Store Connect Submission Notes

Production implementation status as of 2026-06-03 10:13Z:

- Gift CPP exists at `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=c27abef4-0e68-4beb-b9ba-eaf718ca8271`.
- Anniversary CPP exists at `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=b24b31c4-d42d-4c07-8290-52621a2c3c4d`.
- Custom CPP exists at `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028?ppid=a973cd06-248a-4f3d-acc0-4d29c6d57326`.
- Gift draft version ID: `e8c3867d-be0b-44b7-be12-636753816fd5`.
- Anniversary draft version ID: `d5cd3e14-9c3c-4c3b-9277-895763e2bcca`.
- Custom draft version ID: `a0e559e1-0582-4b8d-b5a0-36002b79c552`.
- Review submission ID: `4300e74c-e67b-4a0e-934a-74a9ce923966`.
- Anniversary search keyword assignment accepted: `anniversary,wife,husband`.
- Custom search keyword assignment accepted: `custom,personalized,voice`.
- Gift search keyword assignment is blocked because App Store Connect requires the assigned CPP tokens to already exist in the current app version keyword field, and `gift` is not present there.
- Screenshot sets were uploaded with baseline JPEG assets. ASC later reported all 30 screenshots as `COMPLETE`.
- Review submission `4300e74c-e67b-4a0e-934a-74a9ce923966` is `COMPLETE`.
- Gift, Anniversary, and Custom CPP version states are all `APPROVED`.
- Public page checks returned HTTP 200 for all three CPP URLs, and each page body contained its expected CPP promotional text snippet.

When ready to submit or retry submission:

1. Create each CPP in App Store Connect with the reference names above.
2. Upload the generated screenshots for the required device sizes.
3. Add the promotional text for that CPP.
4. Assign unique search keywords for that CPP where App Store Connect offers the keyword assignment control.
5. Submit for review.
6. Record the created CPP URL or ID in this file or a follow-up tracking file.

For the current submission, steps 1 through 5 are complete except Gift keyword assignment. The next operational step is to add `gift` to the hidden app-version keyword field in the next editable version, then assign Gift CPP search keywords when ASC permits it.

## Measurement Notes

Evaluate after enough product-page views to reduce noise. For low-volume searches, inspect directional movement weekly but do not overreact to one-day rank movement.

Primary metrics:

- Keyword rank.
- Search impressions.
- Product page views.
- Product page conversion rate.
- First-time downloads.
- Review count and rating.

Secondary metrics:

- `/download` events from matching web landing pages.
- Smart banner clicks.
- App opens after install when available.
