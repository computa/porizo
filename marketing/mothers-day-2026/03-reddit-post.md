# Reddit Post — r/SideProject (Builder community, NOT r/giftideas)

**Why this sub:** r/SideProject welcomes builder narratives. r/giftideas, r/gifts, r/buyitforlife are anti-promo — posting there gets the link removed AND the account flagged. Never post in gift subs.

**Why this works:** Reddit's algorithm rewards specific builder stories. The voice-clone angle is a genuine "I built something interesting" moment, not a sales pitch. Mods of r/SideProject explicitly approve "what I built and what I learned" posts.

**Posting time:** Friday May 9 between 8am–10am PT (peak Reddit traffic, weekend reading window).

---

## TITLE OPTIONS (pick the strongest, A/B test second one Tuesday)

**Option A (recommended — leads with mechanic, not sale):**
`I built an AI app that sings personalized songs in YOUR own voice. Made one for my mom for Mother's Day. Here's what I learned.`

**Option B (story-led):**
`Built a voice-cloning song app over 18 months. Tested it on my mom 3 days before Mother's Day. Wasn't ready for her reaction.`

**Avoid:** Anything starting with "Show HN", "Try", "Get", "Sign up" — kills the post in the first hour.

---

## POST BODY (Markdown — Reddit native)

```markdown
**TL;DR:** I built [Porizo](https://porizo.co) — an iOS app that creates personalized songs from one real memory, in about 3 minutes. The unusual feature: it can sing the song in your own voice via voice cloning. I made one for my mom this week and was not ready for her reaction.

---

**The why:**

I started this 18 months ago because every "personalized song" service I tried (Songfinch, Songlorious, Songheart) had the same trade-off: real human composers, 7-14 days, $199-299 per song, and the song is always sung by a stranger. I wanted to send my mom a song for Mother's Day, but a stranger's voice singing about MY childhood felt off.

So I built the version where the gifter's own voice sings it.

**The stack:**

- iOS native app (SwiftUI)
- Backend: Node.js + Fastify + Postgres on Railway
- Music generation: Suno via API
- Voice cloning: Seed-VC (zero-shot voice conversion)
- Voice embedding: ECAPA-TDNN, 256-dim
- Quality control: section-by-section regen, similarity threshold gates
- Cost per song: ~$0.07 preview, ~$0.25 full render

**The pipeline:**

1. User enrolls voice once: 6-10 short phrases + 1-2 sung prompts (~2 min). Quality controls reject noisy or clipping input automatically.
2. User picks an occasion + recipient + writes one memory. Lyrics are generated in their chosen genre (pop, country, R&B, Afropop, folk, etc.) — verse/chorus/bridge structure.
3. Music plan → instrumental → guide vocal → voice conversion → mix → watermark.
4. Preview drops in <90 seconds. Full song in ~3 minutes.

**The hard problem I'd love feedback on:**

Voice cloning is technically the cheap part now (Seed-VC is excellent zero-shot). The hard part was getting the *song structure* to work emotionally. Generic AI songs read like ChatGPT trying to write a Hallmark card. The fix was forcing the LLM that writes lyrics to use ONE specific concrete detail from the user's input as the chorus anchor. Everything else expanded from that.

If anyone here has shipped narrative-LLM-driven creative products, I'd love to hear how you handled the "everything sounds like AI slop" problem.

**The Mom Test (literally):**

Sent her the song Tuesday. She thought it was a stranger singing for the first 11 seconds. At 0:11 she recognized my voice. The reaction is on my phone and I'll never delete it.

Mother's Day is Sunday. If anyone wants to try it, [it's free for one song](https://porizo.co?utm_source=reddit&utm_medium=organic&utm_campaign=sideproject_mothersday_2026). Voice cloning is on the paid tiers ($9.99/mo). Genuinely curious what builders here think — the iOS app is pretty mature; the marketing is where I'm still figuring it out.
```

---

## EXPECTED REACTIONS + HOW TO RESPOND

| Comment type | Response |
|---|---|
| "How does this compare to Songfinch?" | Respond with the honest comparison from `/songfinch-alternative` page. Don't trash competitors — explain when each tool is better. |
| "AI music is slop" | Acknowledge the critique. Share that Porizo's quality control is section-by-section so each verse/chorus/bridge passes a similarity check. Offer to share a sample link. |
| "Voice cloning is sketchy" | Explain the safeguards: recording-only enrollment (no file uploads), encrypted embeddings with user keys, raw recordings auto-deleted at 7 days, impersonation detection blocks public-figure attempts. |
| "What about [non-iOS platform]?" | Honest: iOS-first because of voice quality requirements. Android in the roadmap. |
| "Show me the song you made for your mom" | Don't share — privacy. But link to a sample on porizo.co. |
| "How are you priced vs Songfinch?" | Plus = $9.99/mo for 4 songs (~$2.50/song). Songfinch = $199 single. Different cost models. |

**Reply within 1 hour of posting** — Reddit ranks based on early engagement. Reply to every comment in the first 4 hours.

---

## DON'T LIST

- Don't repost the same content to r/MachineLearning, r/AI_news, r/iosdev — Reddit detects cross-posting and shadowbans
- Don't link to porizo.co more than once in the post
- Don't reply with "DMs open" — Reddit hates that
- Don't argue with critics — acknowledge, share evidence, move on
- Don't post during weekday work hours — engagement spikes 8-10am and 7-9pm PT
- Don't use bold marketing language ("revolutionary", "game-changing", "the only") — instant downvote magnet

---

## FOLLOW-UP POSTS (if first one hits ≥50 upvotes)

- **r/AiBuilders** (Tuesday May 13): "How I solved the AI lyrics-feel-like-slop problem with one prompt change" — technical post, no commercial pitch
- **r/Entrepreneur** (Wednesday May 14): "What I learned shipping an AI consumer app to Mother's Day deadline" — narrative, ends with porizo.co casually
- **r/InternetIsBeautiful** (Saturday May 17): Just the link with a one-sentence "Personalized songs in your own voice" — high karma sub, no story needed

Spread these across 2 weeks, not consecutive days.
