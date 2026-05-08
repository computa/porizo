# Porizo Distribution Growth Plan

Updated: 2026-05-08

## Positioning

Porizo should not be distributed as a generic AI music app. The strongest wedge is occasion-based gifting:

- Mother's Day song
- birthday song maker
- anniversary song gift
- custom song gift
- personalized song for Mom, partner, dad, friend, or recipient

This matches user intent better than broad "AI music" positioning and gives Apple Ads, App Store metadata, web SEO, short-form content, and share loops the same message.

## Operating Strategy

1. Capture existing App Store demand with exact-intent Apple Ads.
2. Create demand with short-form emotional demos.
3. Convert demand with occasion-specific App Store Custom Product Pages and web landing pages.
4. Turn recipients into creators through playable shared-song pages.
5. Preserve spend by measuring the install-to-song funnel and fixing drop-offs before scaling budgets.

## App Store Custom Product Pages

Create one Custom Product Page per high-intent occasion. Each page needs its own first screenshot, subtitle/promotional text angle, and matching Apple Ads ad group.

| Page | Primary Intent | Screenshot Hook | Apple Ads Keywords |
|---|---|---|---|
| Mother's Day | urgent seasonal gift | "Turn Mom's story into a song" | mother's day song, song for mom, gift for mom |
| Birthday | always-on gift | "Make a birthday song from one memory" | birthday song, custom birthday song, birthday gift |
| Anniversary | romantic gift | "Your love story, in a song" | anniversary song, love song gift, wedding anniversary gift |
| Custom Song | broad intent | "A personal song gift, made from your story" | custom song, personalized song, song gift |
| My Voice | feature differentiator | "Sing it in your own voice" | ai voice song, personalized voice song |

## Apple Ads Rules

- Keep Brand, Category, Competitor, and Discovery separated.
- Use Discovery only to mine search terms.
- Exact-match proven terms get budget first.
- Broad terms must be killed quickly if they do not produce song-starts or registrations.
- No budget scale without backend funnel confirmation.

Current action from the last audit:

- Increase bids/budget on exact `gift song` and Mother's Day exact terms.
- Reduce broad gift terms that spend without installs.
- API write access was blocked by Apple Ads permissions, so campaign edits must be applied in the Apple Ads UI unless account permissions change.

## Web SEO Pages

The repo now includes first-pass landing pages:

- `/mothers-day-song`
- `/birthday-song-maker`
- `/anniversary-song-gift`
- `/custom-song-gift`

Each page links to `/download` with UTM parameters so the existing `download_events` table can attribute landing-page traffic.

## Short-Form Content Loop

Use the product output as the ad creative. Produce batches, not one-offs.

Hooks to test:

- "I turned my mum's story into a song."
- "I made a birthday gift in two minutes."
- "She thought it was just a card. Then the song played."
- "I used my own voice for a song gift."
- "Last-minute Mother's Day gift that does not feel last-minute."

Minimum weekly test: 20 vertical clips across 4 hooks and 5 occasions.

## Recipient Loop

Every shared song page should make the next action obvious after playback:

- "Make one for your mum"
- "Create a birthday song"
- "Make a song for someone you love"

The CTA should point to `/download` with `utm_source=share&utm_medium=recipient_cta`.

## Measurement Gates

Do not scale spend unless these are visible by source/campaign:

- App Store impression
- product page view
- install
- backend registration
- onboarding completed
- create started
- song completed
- song shared
- recipient opened
- recipient clicked create/download

The backend already has `download_events`, Apple Ads attribution capture, and event ingestion. The main risk is pre-auth visibility: if users install and never authenticate, backend-only analytics cannot see them. App Store Connect and Apple Ads remain the source of truth for install counts.

## Confidence

There is no 100% guaranteed install channel. The confidence here is in the strategy as a falsifiable system: each channel has a measurable gate, a kill condition, and a next action.

