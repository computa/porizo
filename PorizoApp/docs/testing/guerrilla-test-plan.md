# Guerrilla Usability Test Plan

5 test scripts for quick hallway usability testing. Each takes 5-10 minutes per participant. No lab required -- just a phone with TestFlight build and a quiet corner.

**Goal:** Validate the core funnel before investing in paid acquisition.

**Recruitment:** Friends, family, coworkers who have NOT seen the app. Aim for 5 participants total (identifies ~85% of usability issues per Nielsen).

---

## Test 1: First Impression + Onboarding (Pre-Auth)

**What we're testing:** Does the app communicate its value before asking for sign-up?

**Setup:** Fresh install from TestFlight. Hand phone to participant.

**Script:**
1. "Take a look at this app. Don't sign up yet -- just tell me what you think it does."
2. Wait 15 seconds. Note what they look at first.
3. "Who would you use this for? What occasion?"
4. "Now go ahead and sign up however you prefer."

**Watch for:**
- Do they try to tap the play button on onboarding? (P0-1 validation)
- Can they articulate the value prop within 10 seconds?
- Any hesitation at the auth screen?
- How long from app open to authenticated home?

**Success:** 4/5 participants can describe "personalized song for someone" without prompting. Auth completes in under 30 seconds.

---

## Test 2: Create First Song (Core Funnel)

**What we're testing:** Can a new user create a song without getting stuck?

**Setup:** Authenticated user, no prior songs.

**Script:**
1. "I want you to make a song for your friend [name]. Their birthday is coming up."
2. Do NOT give further instructions. Let them figure out the flow.
3. If stuck for 30+ seconds: "What are you trying to do right now?"

**Watch for:**
- Do they find the Create button easily?
- Voice selection confusion (P1-4 -- gender chips vs emotion)
- Do they understand the conversation format?
- Any confusion about when they're "done" telling the story?
- Reaction to the wait screen -- do they trust it? (P0-4, P0-5)

**Success:** 4/5 complete a preview render without asking for help. Time from tap-Create to preview-playing under 3 minutes (including ~90s render).

---

## Test 3: Reveal Moment (Emotional Peak)

**What we're testing:** Does the reveal feel special? Is the transition from waiting to playing satisfying?

**Setup:** Song is rendering or just completed. Participant is on the wait screen.

**Script:**
1. Let them experience the wait-to-reveal transition naturally.
2. After reveal plays: "How did that feel?"
3. "What would you do next with this?"

**Watch for:**
- Emotional reaction at reveal (smile, laugh, surprise, disappointment)
- Do they try to replay? Scrub? Find full player? (P1-1)
- Do they instinctively reach for Share?
- Any confusion about what "reveal" means vs the full song?

**Success:** 3/5 participants smile or express positive emotion. 4/5 attempt to share without prompting.

---

## Test 4: Share Flow (Viral Loop)

**What we're testing:** Can sender share the song, and can recipient claim it?

**Setup:** Participant has a completed song. Use a second test phone for the recipient side.

**Script:**
1. "Now send this song to your friend. Use whatever method feels natural."
2. Watch them navigate sharing.
3. On second phone, open the share link: "You just received this. What do you do?"

**Watch for:**
- Time from "I want to share" to link sent
- Any delay generating the share link? (P0-3)
- Recipient: do they understand what they received?
- Recipient: can they play before entering PIN? (P1-2)
- Recipient: correct sender attribution? (P1-3)

**Success:** Share completes in under 10 seconds. Recipient plays song within 30 seconds of opening link. Correct sender name displayed.

---

## Test 5: Return Visit + Second Song

**What we're testing:** Does the app have legs? Will they come back?

**Setup:** Same participant, 1-3 days after Test 2. Their first song should be visible.

**Script:**
1. "Open the app again. Show me the song you made last time."
2. "Now make another one -- different person, different occasion."
3. After completion: "Would you pay $X for this?" (test price sensitivity)

**Watch for:**
- Can they find their previous song easily?
- Is the second creation faster/smoother than the first?
- Do they try different features (edit lyrics, change style)?
- Willingness to pay -- and at what price point?
- Unprompted feature requests (write these down verbatim)

**Success:** Second song created 30%+ faster than first. 3/5 express willingness to pay. At least 2 mention a specific person they'd make a song for.

---

## Recording Template

For each session, capture:

| Field | Notes |
|-------|-------|
| Participant | Age range, tech comfort (1-5) |
| Date | |
| Build version | |
| Test # | 1-5 |
| Task completion | Yes / No / With help |
| Time to complete | |
| Errors/confusion | Verbatim quotes |
| Emotional reaction | |
| Unprompted comments | |
| Would they pay? | Y/N, price |
| Top friction point | |

## After All 5 Participants

Tally results against success criteria. Any test where fewer than 3/5 succeed indicates a blocker that should be fixed before launch marketing spend.

Priority fixes from testing feed back into the gap analysis backlog.
