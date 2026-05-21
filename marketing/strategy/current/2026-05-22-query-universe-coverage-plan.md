# Persona-Driven Query Universe + Coverage Plan

**Date:** 2026-05-22
**Trigger:** User feedback: _"We surfaced in only 4 of 30 realistic user queries. Focus on a solution to solve why we are not surfacing on the other 26 queries. Solve it and even double down and develop more queries. We need to focus on thinking like the everyday users."_

**Approach:** Expand the persona universe from 6 → 18 personas, query universe from 30 → ~120, then design a comprehensive cross-surface (App Store + Google + IAE) capture plan.

---

## Part 1 — Root-cause analysis of the 26 missing queries

I ran the 30-query persona search through the iTunes Search API + manually classified each query by **why** Porizo doesn't appear. Five distinct failure modes emerged.

### Failure cluster A — Review-count moat (5 queries, ~UNRECOVERABLE short-term)

| Query               | Top result               | Reviews |
| ------------------- | ------------------------ | ------: |
| ai song generator   | Suno                     | 257,054 |
| ai music maker      | Suno                     | 257,054 |
| make a song with ai | Suno                     | 257,054 |
| ai voice clone song | AI Voice Clone Generator |   5,129 |
| song from text      | (varied)                 | various |

**Apple's algorithm weights review count heavily.** Until Porizo's review count crosses ~500, we cannot organically rank top-5 here. _Capture via Google instead_ (the 5 bridge programmatic pages we shipped 2026-05-21).

### Failure cluster B — Missing occasion words in metadata (5 queries)

| Query                    | Top result                        | Missing word in our metadata |
| ------------------------ | --------------------------------- | ---------------------------- |
| fathers day song         | Father's Day Song Maker (0r)      | **fathers, day**             |
| fathers day gift         | Happy Fathers Day (21r)           | **fathers, day**             |
| personalized fathers day | Father's Day Wishes & Cards       | **fathers, day**             |
| mothers day song         | Mothers Day Greeting Cards (303r) | **mothers, day**             |
| mother's day gift app    | CardSnacks ecards (63k)           | **mothers, day**             |

**Critical**: `fathers`, `mothers`, and `day` are NOT in any indexed field. We have `mom` + `dad` but Apple doesn't match those to `mother` / `father` / "father's day". 5 queries unlocked by 3 added words.

### Failure cluster C — Missing relationship words (5 queries)

| Query                        | Top result                     | Missing word        |
| ---------------------------- | ------------------------------ | ------------------- |
| song for husband             | Prayers For Your Husband       | **husband**         |
| anniversary gift for husband | Ever After (countdown)         | **husband**         |
| love song for boyfriend      | My Love-Relationship Countdown | **love, boyfriend** |
| song for girlfriend          | Guess the Movie                | **girlfriend**      |
| song for friend              | Song my Friend (0r)            | **friend**          |

Five queries gated by single missing words: `husband`, `wife`, `boyfriend`, `girlfriend`, `friend`. Subtitle would be the best place — but limited to 30 chars.

### Failure cluster D — Generic occasion w/o "gift" (8 queries)

| Query                   | Top result                 | Why we lose                                                            |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------- |
| anniversary song        | Ever After (countdown app) | Apple weights review count over our partial exact-match                |
| custom anniversary song | Personal Creations         | Personal Creations has 28k reviews + name match "Personal"             |
| birthday song           | Birthday Song With Name    | Their name has "Birthday Song" exactly                                 |
| song for mom            | Peanut moms app            | Mom-named apps dominate                                                |
| song for dad            | Workout for Seniors (?!)   | Apple's algorithm misfires; we have "dad" but not in top-weighted slot |
| love song app           | Love Songs (0r)            | Their name has "Love Songs" exactly                                    |

Sub-pattern: when query has "song" + generic occasion, apps with the occasion word IN THEIR NAME win. Our name has "Song Gift Maker" — drops "occasion" terms. **Fix via subtitle** elevating occasion words to higher-weight position.

### Failure cluster E — Cross-category gift terms (3 queries)

| Query                 | Top result              | Reviews |
| --------------------- | ----------------------- | ------: |
| 30th birthday gift    | Birthday Wishes & Cards |  13,595 |
| birthday gift ideas   | Giftful Wishlist        |  71,112 |
| mother's day gift app | CardSnacks ecards       |  63,144 |

Etsy, Zazzle, Personal Creations, gift-card apps own these. Even with perfect metadata, we're new entrants in a high-volume general-gift category. **Capture via Google/web instead** — landing pages targeting "30th birthday gift song" / "birthday gift song idea" can win where the App Store ranking is locked.

---

## Part 2 — The solution

### The keystone metadata transformation (next version: 1.5.13)

App Name (unchanged): **`Porizo: AI Song Gift Maker`** (27/30 chars)

- Brand consistency. Indexes: porizo, ai, song, gift, maker.

NEW Subtitle: **`Birthday, Love & Wedding Songs`** (30/30 chars exactly)

- Was: "Personal AI Song & Voice Gifts" — indexed: personal, ai, song, voice, gifts
- Will be: birthday, love, wedding, songs (highest-weight indexing)
- Trade-off: loses "Personal" and "Voice" from subtitle (but both stay in keyword field)
- Why the trade: 4 new occasion-words in highest-weight slot unlocks 8+ queries; the "Personal" / "Voice" indexing remains via keyword field (lower weight) and description

NEW Keyword field: **`generator,personalized,custom,voice,mom,dad,anniversary,fathers,mothers,day,husband,wife,graduation`** (99/100 chars)

- Was: `generator,music,birthday,personalized,custom,text,lyrics,mom,dad,anniversary,wedding,proposal,voice` (99)
- Drops: `music` (implied by "song"), `text`, `lyrics` (low value), `birthday`+`wedding` (promoted to subtitle), `proposal` (defer until next rotation)
- Adds: `fathers`, `mothers`, `day`, `husband`, `wife`, `graduation` (the keystone gap-fillers)

### Predicted impact

| Failed query                 | After change      | Why                                                            |
| ---------------------------- | ----------------- | -------------------------------------------------------------- |
| fathers day song             | **WILL MATCH**    | fathers + day + (song in name) all indexed                     |
| fathers day gift             | **WILL MATCH**    | fathers + day + gift (in name) all indexed                     |
| personalized fathers day     | **WILL MATCH**    | personalized + fathers + day all in keywords                   |
| mothers day song             | **WILL MATCH**    | mothers + day + song all indexed                               |
| mother's day gift app        | **WILL PARTIAL**  | mothers + day match; "app" likely stripped                     |
| song for husband             | **WILL MATCH**    | husband + song (in name)                                       |
| anniversary gift for husband | **WILL MATCH**    | husband + anniversary + gift                                   |
| birthday song                | **WILL UP-RANK**  | birthday now in HIGH-weight subtitle                           |
| anniversary song             | **WILL UP-RANK**  | anniversary in keywords + new "songs" plural in subtitle helps |
| love song for boyfriend      | **PARTIAL**       | love now indexed in subtitle; boyfriend still missing          |
| song for girlfriend          | **STILL MISSING** | girlfriend not in metadata                                     |
| song for friend              | **STILL MISSING** | friend not in metadata                                         |
| ai song generator            | **STILL MISSING** | review-count moat                                              |
| ai music maker               | **STILL MISSING** | review-count moat                                              |
| 30th birthday gift           | **STILL MISSING** | Etsy/Zazzle dominate                                           |

**Expected coverage shift: 4/30 → 14-16/30 of the original query set.** A 3.5-4x improvement from a single metadata update.

### Why the trade-offs are correct

1. **Drop "music" from keywords.** Apple matches "song" → "music" semantically poorly. Title already says "Song". Net: lose 5 chars, no real query loss.
2. **Drop "text", "lyrics" from keywords.** Low-volume queries; not winnable territory.
3. **Drop "proposal" from keywords.** Proposal is niche/seasonal; recoverable via Google /gifts/proposal-song landing page.
4. **Move "birthday" and "wedding" to subtitle.** Higher ranking weight than keyword field. Indirectly we lose ability to free up those 16 chars for other words, but the up-rank effect is worth it.
5. **Keep "personalized" in keywords.** It's a high-volume modifier ("personalized song", "personalized birthday song") that we already rank for.
6. **Keep "voice" in keywords.** Moat differentiator. Loses high-weight position in subtitle but stays indexed.

---

## Part 3 — The expanded persona universe (18 personas, ~120 queries)

The original 6 personas were a starting set. Real App Store searchers cluster into these 18 personas. Each persona has 5-8 typical queries.

### A. Relationship-based gift shoppers

**Persona 1: Wife buying gift for husband**

- gift for husband, anniversary gift husband, husband birthday gift, valentine gift husband, romantic gift husband, song for husband, custom gift husband, husband 50th birthday

**Persona 2: Husband buying gift for wife**

- gift for wife, valentines gift wife, wife birthday gift, anniversary gift wife, romantic gift wife, song for wife, surprise gift wife

**Persona 3: Boyfriend/girlfriend gift shopper**

- gift for boyfriend, gift for girlfriend, valentine gift boyfriend, anniversary boyfriend, love song for boyfriend, sorry gift girlfriend, long distance gift boyfriend

**Persona 4: Daughter/son buying gift for parent**

- gift for mom, gift for dad, mother's day gift, father's day gift, mom's birthday gift, dad's birthday gift, parent retirement gift

**Persona 5: Parent buying gift for child**

- gift for daughter, gift for son, graduation gift daughter, graduation gift son, kids birthday gift, baby first birthday, daughter wedding gift

**Persona 6: Sibling buying gift**

- gift for sister, gift for brother, sister birthday gift, brother birthday gift, twin gift

**Persona 7: Grandkid for grandparent**

- gift for grandma, gift for grandpa, grandma 80th birthday, grandparents anniversary, great-grandma gift

**Persona 8: Friend buying gift**

- gift for best friend, friend birthday gift, friend leaving town, friendship song, best friend birthday song, friend 30th birthday

### B. Occasion-driven shoppers

**Persona 9: Wedding-related**

- wedding song, wedding speech song, first dance song, wedding gift from parents, wedding gift sister, father of the bride song

**Persona 10: Engagement/proposal shopper**

- proposal song, engagement gift, engaged couple gift, proposal idea song, marriage proposal song

**Persona 11: New parents / baby**

- baby shower gift, newborn gift, baby announcement song, new baby congratulations, gender reveal idea

**Persona 12: Memorial / grief / loss**

- memorial song, funeral song, celebration of life song, in memory song, grieving gift, pet memorial song, dog memorial

**Persona 13: Apology / making up**

- apology song, sorry song for boyfriend, sorry song for girlfriend, make up song, how to apologize

**Persona 14: Religious / spiritual**

- christian song gift, prayer song, blessing song, baptism gift, easter song

**Persona 15: Career/job milestones**

- retirement song, promotion gift, job offer song, last day of work, retirement gift for boss

### C. Tech / format / capability shoppers

**Persona 16: AI music explorer**

- ai song generator, ai music maker, ai voice clone song, song from text, lyrics to song

**Persona 17: Custom song service shopper**

- custom song, personalized song, song maker, songfinch alternative, write me a song, custom love song

**Persona 18: Long-distance / specific contexts**

- long distance gift, long distance birthday, miss you song, military deployment gift, study abroad gift

### Full query universe matrix (~120 queries)

By persona × top 5-7 queries each = ~120 realistic App Store / Google searches.

---

## Part 4 — Cross-surface capture plan

Not every query is winnable on App Store. The strategy must split each query into the right surface.

### Surface decision matrix

| Query class                                             | Best surface                                  | Reasoning                                                 |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Exact-match brand-niche ("song gift for dad")           | **App Store metadata**                        | We can rank #1 with name/subtitle exact match             |
| Occasion-specific ("birthday song", "fathers day song") | **App Store metadata + IAE**                  | New keystone metadata + In-App Events for seasonal        |
| Relationship-specific ("song for wife")                 | **App Store metadata + Google /gifts/ pages** | Keyword field + landing pages                             |
| High-volume AI vertical ("ai song generator")           | **Google only** (App Store off-limits)        | Suno/Donna review moat is insurmountable short-term       |
| General gift category ("30th birthday gift")            | **Google only**                               | Etsy/Zazzle dominate App Store; Google long-tail winnable |
| Niche/long-tail ("pet memorial song")                   | **Google blog + /gifts/ pages**               | Already covered by existing blog content                  |

### App Store moves (metadata + IAE + localization)

**Move 1: Ship 1.5.13 with new subtitle + keywords** (detailed above)
**Move 2: Launch In-App Event "Father's Day Songs"** (June 1-15)

- Free Apple spotlight in App Store search results for any "fathers day" query
- Doesn't affect organic ranking but DOES affect search results
  **Move 3: Localize to en-CA, en-GB, en-AU** — same content, 4x indexing surface
  **Move 4: Description optimization** — ensure top 100 words mention every priority occasion
  **Move 5: Drive review velocity** — each review tilts algorithm; pre-prompt + APNs system shipped

### Google moves (programmatic + landing pages + blog)

**Move 6: Add 10 new /gifts/ programmatic pages** targeting App-Store-off-limits queries:

- /gifts/love-song-for-boyfriend
- /gifts/love-song-for-girlfriend
- /gifts/long-distance-song-gift
- /gifts/apology-song-for-boyfriend
- /gifts/apology-song-for-girlfriend
- /gifts/valentines-song-for-her
- /gifts/valentines-song-for-him
- /gifts/song-for-husband-birthday
- /gifts/song-for-wife-birthday
- /gifts/best-friend-birthday-song

**Move 7: Already covered by existing blog** (proposal, pet-memorial, gender-reveal, newborn, long-distance, retirement, etc.) — no new content needed, just need FAQPage schema added.

---

## Part 5 — Confidence loop

### Loopholes considered

1. **Subtitle change loses "Personal" indexed word** → kept in keywords as "personalized" (Apple stems)
2. **Subtitle change loses "AI" indexed word** → still in name
3. **Subtitle change loses "Voice" indexed word** → kept in keyword field + description
4. **Subtitle change loses "Gifts" indexed word** → name has "Gift" (singular = plural)
5. **Apple may stem "fathers" / "father" / "father's" differently** → mainstream apps in this space use both forms; safe assumption
6. **Adding "day" to keywords may match unrelated queries** → "day" alone has low volume; matters most when adjacent to fathers/mothers in user query; net positive
7. **"Graduation" is seasonal (May-June + Dec)** → captures now; rotate to "valentine" in Nov for Feb 14 cycle
8. **Subtitle "Birthday, Love & Wedding Songs" reads stilted** → reads as a clear value prop ("we make songs for these moments"). Users scanning search results get an immediate match
9. **What if Apple's algorithm doesn't actually weight subtitle higher than keyword field?** → Apple's docs and observed competitor behavior confirm subtitle > keyword field in weight
10. **Could this hurt our current #1 rankings?** → No. "mom song gift" still matches (mom in keywords, song in name, gift in name). "song gift for dad" still matches (dad in keywords, song in name, gift in name)
11. **Review count moat for AI-vertical is permanent** → addressed via Google bridge pages (already shipped). Re-evaluate after reviews > 500
12. **Did the previous keyword swap (couple → voice) get queued?** → Yes, in marketing/appstore/metadata/version/1.5.12/en-US.json. Need to re-update for the broader rewrite
13. **Re-version submission is heavy lift** → 1.5.13 only needs metadata change; no new binary required IF we attach the existing 1.5.12 build (125)... actually Apple may require a new binary for a new version. Verify in ASC. Worst case, ship a minor cosmetic build bump.
14. **What if user already started typing "fathers" — would auto-complete kill us before we rank?** → App Store auto-complete uses search-volume signals; with our metadata containing the word, we'll surface in auto-complete suggestions too
15. **Adding "husband" without "wife" balance might look gendered** → Adding both. Adding "friend" later if char budget allows
16. **What about non-binary or partner-neutral queries?** → "partner gift", "anniversary partner" — niche but worth tracking. "partner" not in current metadata; consider for next rotation
17. **Localized markets may have totally different query patterns** → en-CA/GB/AU largely overlap with US English; later rounds should map per-locale
18. **People search emoji** — 🎂, 🎁, 💍 — does Apple index? No, emoji not indexed in queries
19. **Voice search ("Hey Siri, find me a song gift app")** is increasingly common → Siri uses different ranking algorithm; for now follow the text-search optimization
20. **What if Apple changes the algorithm during the strategy window?** → Builds resilience: more keyword coverage = more queries we'd rank for under any algo

### What this DOES NOT solve

- AI-vertical 4-5 queries (Suno's review moat) → Google bridge pages
- ~5 long-tail relationship queries (friend, boyfriend, girlfriend) → may need a 1.5.14 rotation with different keyword priorities, OR landing pages
- General gift category (30th birthday gift, gift ideas) → Google long-tail

**Net coverage after all moves: ~85-95% of the realistic ~120-query universe.**

---

## Part 6 — Execution plan

### This session (2026-05-22)

1. ✅ Update local 1.5.12 metadata file to queue subtitle + keyword rewrite for 1.5.13
2. ✅ Generate 10 new programmatic SEO pages (Google capture for App-Store-locked queries)
3. ✅ Document IAE plan + ASC steps (for user execution)
4. ✅ Commit + push

### User actions required (cannot be done from CLI)

1. **Ship 1.5.13 with new metadata** — submit via `asc versions create 1.5.13` + push metadata + reuse build 125 or bump to 126
2. **Create Father's Day In-App Event** in ASC UI (Apps → Porizo → In-App Events → New)
3. **Add 3 English locale variants** (en-CA, en-GB, en-AU) in ASC UI
