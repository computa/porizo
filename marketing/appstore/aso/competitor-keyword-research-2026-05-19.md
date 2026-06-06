# Competitor Keyword Research - AI Generator Lane

Date: 2026-05-19

## Source

- OpenASO local rank tracking for Porizo and competitor result sets.
- App Store public listings for Suno, Muzio, Donna, and Banger.
- Apple Search Ads 30-day keyword pull from `marketing/appstore/aso/inputs/asa-2026-05-19.csv`.

## Finding

The earlier conclusion that we should not chase AI-generator terms was too conservative. OpenASO shows the generic AI generator lane has materially higher search popularity than the gift-song lane:

| Keyword | US popularity | Porizo rank | Competitive shape |
| --- | ---: | ---: | --- |
| ai music generator | 57 | Unranked | Suno, Muzio, Donna, MyTunes, Banger |
| ai song generator | 53 | Unranked | Suno, Muzio, Donna, Mozart, Zona |
| ai music maker | 50 | Unranked | Suno, Donna, Soniva, MyTunes, BandLab |
| ai song maker | 50 | Unranked | Suno, Soniva, Donna, Muzio, Zona |
| ai voice song generator | 5 | Unranked | Banger, VocalMe, MyTunes, SingUp, Suno |
| ai song generator with my voice | 5 | Unranked | MyTunes, VocalMe, Shoom, Suno, Banger |
| text to song ai | 5 | Unranked | Suno, AI Text To Song Generator, MyTunes, Muzio |
| lyrics to song ai | 5 | Unranked | Shoom, Suno, MyTunes, Banger, Muzio |

Porizo currently ranks strongly for low-volume long-tail terms like `birthday song gift`, `anniversary song gift`, `personalized song gift`, and `custom song gift`, but it is not indexed competitively for the larger AI generator lane.

## Competitor keyword pattern

The recurring indexed terms in competitor titles and result sets are:

- ai
- song
- music
- generator
- maker
- voice
- cover
- text
- lyrics

The highest-volume competitors use direct, literal naming:

- Suno: `AI Songs & Music`
- Muzio: `AI Song Music Generator`
- Donna: `AI Song & Music Maker`
- Banger: `AI Music Generator`
- Zona / Mozart / Soniva: `AI Song Generator` / `AI Song Maker`

## ASA reality check

Our existing paid data has only tested the voice-adjacent branch, not the full AI generator branch:

| ASA keyword | Impressions | Taps | Installs | Spend | Read |
| --- | ---: | ---: | ---: | ---: | --- |
| my voice song app | 1913 | 9 | 0 | $11.01 | Lots of exposure, weak intent or poor listing match |
| sing in my voice | 228 | 2 | 0 | $2.92 | Insufficient conversion |
| song with my voice | 77 | 1 | 0 | $1.47 | Insufficient conversion |
| ai voice cover gift | 21 | 0 | 0 | $0.00 | No signal yet |

This does **not** prove `ai song generator` and `ai music generator` are bad. It only proves that the current listing does not convert well on the “my voice” branch and that the broad probe may have been matching poorly.

## Decision

Create an AI-generator ASO lane while preserving the gift differentiation:

1. App name should include `AI Song`.
2. Subtitle should keep the gift promise rather than becoming generic.
3. Hidden keywords should include generator/maker/music/voice/text/lyrics.
4. Paid testing should use exact match for AI generator terms, not broad.
5. Do not replace the gift lane. Run AI generator as a second lane and compare install-to-activation quality.

## Staged metadata direction

Recommended next-version metadata:

- Name: `Porizo: AI Song Gift Maker`
- Subtitle: `Custom music gifts`
- Keywords: `ai,song,generator,music,maker,gift,birthday,personalized,custom,voice,text,lyrics,mom,dad,love`

Rationale: this gives Apple enough tokens to form `ai song generator`, `ai music generator`, `ai song maker`, and `ai music maker` combinations while keeping Porizo differentiated from generic creation tools.

## Paid test plan

Add exact-match Apple Ads keywords in a separate AI Generator test ad group:

- `ai song generator`
- `ai music generator`
- `ai song maker`
- `ai music maker`
- `text to song ai`
- `ai text to song generator`
- `ai voice song generator`
- `ai song generator with my voice`

Bid policy:

- Start exact terms at $1.50-$2.00 CPT.
- Cap daily spend separately from gift campaigns.
- Kill or demote after 8+ taps and 0 installs.
- Promote only terms that generate installs and at least one downstream song-start event.

## Risk

The AI generator market is larger but more competitive and less emotionally qualified. The strategic risk is becoming a worse Suno rather than the best personal-song gift app. The mitigation is to use AI keywords for discovery while keeping the product promise gift-first.
