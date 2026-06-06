# Reddit Posts — A/B Variants + Follow-Up Sub Drafts

---

## r/SideProject — Friday May 9 morning post

### Title A/B options (pick one — save the others for follow-up posts)

1. **(Recommended — leads with mechanic, story-true):**
   `I built an AI app that sings personalized songs in YOUR own voice. Made one for my mom for Mother's Day. Here's what I learned.`

2. **(Story-led variant):**
   `Built a voice-cloning song app over 18 months. Tested it on my mom 3 days before Mother's Day. Wasn't ready for her reaction.`

3. **(Tradeoff-led variant — for an alt-account / second post):**
   `18 months in: shipping an AI gift app that sings in the gifter's own voice. Mother's Day is the first real test.`

4. **(Anti-hype variant):**
   `I made the cheap, fast version of Songfinch — sings in your own voice. Solo founder, year and a half. AMA.`

### Title traps to avoid
- ❌ "Show HN: Porizo" (HN-flavored, kills it on Reddit)
- ❌ "Try Porizo today" (CTA tone — instant downvote)
- ❌ "We launched..." (founder-speak triggers ad detection)
- ❌ Anything with emoji 🎵🎤🎉

### Post body (use as-is for r/SideProject — already drafted in `03-reddit-post.md`)

See `marketing/archive/campaign-packs/mothers-day-2026-plan-pack/03-reddit-post.md` — body is final.

### Reply triggers (set up these saved replies before posting)

| Comment trigger | Saved reply |
|---|---|
| "How does this compare to Songfinch?" | "Honest comparison: Songfinch uses real human composers and ships in 4–7 days for ~$179.99 per song. Porizo uses AI and ships in ~3 minutes for $9.99/month with voice cloning. Different tools — Songfinch wins for hand-crafted human interpretation 2+ weeks out; Porizo wins for last-minute and for "I want it sung in my voice." If you want details: porizo.co/songfinch-alternative" |
| "AI music is slop" | "Fair critique. The fix that worked for me was forcing the lyric LLM to use ONE specific concrete detail from the user's memory as the chorus anchor — generic AI lyrics read like ChatGPT trying to write a Hallmark card; specific lyrics don't. Quality control runs section-by-section so each verse/chorus/bridge passes a similarity gate. I can share a sample if useful." |
| "Voice cloning is sketchy" | "Concerns are real and the safeguards aren't optional: recording-only enrollment (no file uploads), voice embeddings encrypted with user-specific keys, raw recordings auto-deleted at 7 days, impersonation detection blocks public-figure attempts. Voice cloning is also strictly opt-in via Plus/Pro plans — Free tier uses a default voice." |
| "What about Android?" | "iOS-first because of voice quality requirements during enrollment. Android in the roadmap; not committing to a date because the model adaptation work is real. Sorry — I know that's the answer that gets the eye-roll." |
| "Show me the song you made for your mom" | "Privacy reasons I won't share that one specifically, but here's a sample of the same flow: porizo.co (the homepage has 4 ungated samples — Sarah birthday, Mom Mother's Day, Dad 60th, Leah anniversary). Switch between them with the chips." |
| "Pricing?" | "$9.99/month for 4 songs (Plus, includes voice cloning) or $14.99/month for 10 songs (Pro). One song free. Per-song equivalent: $1.50–$2.50 vs Songfinch ~$179.99. Different cost models — Songfinch is per-song with a human; Porizo is subscription with AI." |
| "Open source?" | "The voice conversion (Seed-VC) and music gen (Suno via API) are not — those are external models. The Porizo app and backend are closed. The structured-data + SEO scaffolding I just shipped (Tier 1-3 of a marketing plan) is in the repo as a public reference if anyone wants the JSON-LD + llms.txt patterns." |

---

## r/AiBuilders — Tuesday May 13 (post-Mother's Day, technical angle)

### Title

`How I solved the "AI lyrics feel like Hallmark slop" problem with one prompt change`

### Body

```markdown
**TL;DR:** AI-generated song lyrics by default sound like ChatGPT trying to write a greeting card. The fix that worked for me: force the lyric model to anchor the chorus on ONE specific concrete detail from the user's input, then generate everything else *outward from that anchor*.

I run [Porizo](https://porizo.co?utm_source=reddit&utm_medium=organic&utm_campaign=mothers_day_2026&utm_content=aibuilders) — a personalized song app that turns "tell me a memory about Mom" into an original song in 3 minutes. For the first 9 months I shipped, every song came out wrong in the same way: generic, abstract, full of words like "always" and "forever" and "love". Hallmark slop.

**The hypothesis I'd been testing wrong:**

I assumed the issue was the model. I tried Claude, GPT, Gemini, and a few open-weight models. All of them defaulted to abstract sentiment when asked to write a song from a vague prompt like "she's a great mom."

**What actually fixed it:**

The model wasn't generic because it was bad. The model was generic because the *prompt* was generic. "She's a great mom" doesn't have anywhere concrete to go.

The two-step that landed:

1. **Detail extraction pass.** A first LLM call that reads the user's memory and pulls out the most concrete observable detail. Not "she was loving" → instead "she always woke before the school bell." The system prompt is opinionated: *"Reject abstract claims. Prefer one moment, one phrase, one repeated action, one object."* If the user gives nothing concrete, ask one follow-up question.

2. **Anchor the chorus on that detail.** The lyric generation prompt is now "write a chorus where every line orbits this specific detail: [X]. Verse 1 leads up to it. Verse 2 expands it. Bridge complicates it." The model can't drift into Hallmark territory because every line has to hold a relationship to a concrete anchor.

The output went from "your love is bigger than the sky" to "you woke before the house, cooked before the school bell, held the door so we could run." Same model. Different scaffolding.

**What I'd love feedback on:**

- This pattern probably generalizes beyond song lyrics. I'd guess any "creative artifact from user input" problem has the same shape: the failure mode is abstraction, the fix is forcing a concrete anchor at the smallest semantic unit (line, sentence, paragraph). Has anyone here applied this to other creative-AI domains? Story openers? Email drafting? Cover letters?

- I'm using simple string-match similarity to verify the chorus actually contains the anchor detail (cheap, fast, brittle). Better: an LLM-as-judge on whether the lyric is concrete vs abstract. Worse: hand-tuning per genre. I'd love to hear if anyone has a better grader-of-creative-output approach that doesn't burn tokens at every render.

If anyone's curious about the song output: porizo.co — the homepage has 4 ungated samples. Mother's Day was Sunday; we shipped a few hundred songs over the weekend.
```

### Why this works for r/AiBuilders

- Technical substance, not a sales pitch
- One link, embedded in context, not in the CTA position
- Asks specific questions that invite expertise
- Acknowledges the complexity of the grader problem (the "I'd love to hear" hook)

---

## r/InternetIsBeautiful — Saturday May 17 (low-content, high-karma sub)

### Title

`Porizo — personalized songs sung in your own voice (built around the gift moment)`

### Body

```markdown
After enrolling your voice once (~2 minutes inside the iOS app), every song you generate is sung in your own voice. Built around occasion-driven gifts — birthdays, anniversaries, Mother's Day, weddings, thank-yous, just-because.

Free to try, voice cloning on the paid plans.

[porizo.co](https://porizo.co/song-in-your-voice?utm_source=reddit&utm_medium=organic&utm_campaign=mothers_day_2026&utm_content=internetisbeautiful)
```

### Why this works for r/iib

- Sub culture: short post, link does the work, no founder narrative
- "After enrolling your voice once" frames the magic in one sentence
- Honest disclosure of free vs paid (sub flags hidden paywalls)

---

## r/Entrepreneur — Wednesday May 14 (founder-narrative angle)

### Title

`What I learned shipping an AI consumer app to Mother's Day deadline`

### Body

```markdown
**Setup:** Solo founder, 18 months in, AI personalized-song app called Porizo. Mother's Day was my first real holiday spike. Three takeaways from the past 5 days that I think generalize beyond consumer AI.

**1. The "we built it but didn't position it" trap is real.**

Voice cloning of the gifter's own voice is my product's only defensible feature. No one else in the personalized-song category does it (Songfinch, Songlorious, Songheart, ForeverSong all use stranger voices). And until last week, my homepage didn't say so. I had the moat and it was invisible.

The fix wasn't a redesign — it was a 4-hour copy + structured-data pass:
- Body copy on every landing page now leads with "sung in your own voice"
- JSON-LD `featureList` on the homepage lists voice cloning first
- New competitor-comparison page (Songfinch alternative) anchors the contrast for search

This is the boring positioning work that founders skip. I skipped it for a year.

**2. Schema markup is the cheapest distribution channel I have access to.**

Total spend on Mother's Day SEO/GEO this week: $0. Total work: ~10 hours.
Output:
- 50 valid JSON-LD schemas across 15 pages
- llms.txt expanded from 1.2KB to 8.4KB (Perplexity, ChatGPT, Claude, Gemini all read it)
- Sitemap submitted to Google + IndexNow (Bing, Yandex, Naver)
- 7 new long-tail landing pages built on the existing template

The pages won't rank tomorrow. They'll rank in 4 weeks. But this is foundation that compounds — I'd rather have it eating away in the background than not have it at all.

**3. The marketing kit > the marketing campaign.**

I almost made the same mistake every solo founder makes: try to execute Mother's Day myself. Films. Posts. Pinterest pins. Reddit. ASA. All in 3 days.

What worked: **producing the kit instead of the campaign**.
- Shot scripts (3 reaction videos with shot-by-shot timing)
- Pin specs (5 designs, 1080×1620, brand-locked)
- Reddit post drafts + saved reply scripts for predictable comments
- UTM bundle so every link is pre-tagged
- Tracking checklist with kill criteria

The kit is reusable for Father's Day in 6 weeks. The campaign isn't.

If anyone's doing a similar holiday push for a small/solo product, happy to share the templates — they're public in [the repo](https://porizo.co?utm_source=reddit&utm_medium=organic&utm_campaign=mothers_day_2026&utm_content=entrepreneur). The Tier 1-4 SEO/GEO scaffolding doc lives in `marketing/strategy/achieved/traffic-strategy.md`.
```

### Why this works for r/Entrepreneur

- Three clear takeaways framed as transferable lessons, not bragging
- "Mistakes I made" framing is the most upvoted format on the sub
- Link is in service of "happy to share the templates" — not a CTA
- Shows real numbers ($0 spend, 10h work) — concrete > abstract

---

## CADENCE & CROSS-POSTING RULES

- **Don't post the same content to multiple subs** — Reddit detects cross-posts, shadowbans the link.
- **Spread posts across 2 weeks** so each post has time to compound.
- **Reply within 1 hour** of every post for the first 4 hours. Engagement velocity in the first 60 minutes determines algo placement.
- **One link per post** — multiple links is the strongest spam signal Reddit has.
- **Don't reply with "DMs open"** — instant downvote magnet.
- **Saturday/Sunday posts on builder subs underperform.** Save those for r/iib or r/InternetIsBeautiful which are weekend-friendly.

## TRACKING

After 7 days, log per-post performance:

| Post | Sub | Upvotes | Comments | Link clicks | App installs attributed |
|---|---|---|---|---|---|
| Friday May 9 | r/SideProject | | | | |
| Tuesday May 13 | r/AiBuilders | | | | |
| Wednesday May 14 | r/Entrepreneur | | | | |
| Saturday May 17 | r/InternetIsBeautiful | | | | |

Kill criteria: any post with <50 upvotes after 24h → don't repeat the format. Any post >200 upvotes → schedule a follow-up in the same sub for the same day-of-week +14 days.
