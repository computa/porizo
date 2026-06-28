# LLM Council Transcript — Share Link Binding

**Date:** 2026-06-21
**Topic:** Why are Porizo share links almost never getting "bound" to a device, and what should we do?

---

## The Question (as framed to the council)

Porizo is an iOS app that generates personalized gift songs. Senders create a song and share a link with the recipient. The business depends on a viral loop: recipient gets a song → recipient becomes a user → recipient sends songs to others. That loop is currently dead (~39 recipients historically → 0 new senders).

Admin dashboard: **605 total share views, only 10 device-bound (~1.7%).** Almost every share token sits in status "unbound" forever.

**Verified mechanism (traced from the codebase):**

1. Share token created with `status="unbound"`, a 6-digit `claim_pin`, `share_type="lifetime"` (never expires). PIN is embedded in the share message text.
2. Recipient opens `https://porizo.co/play/:shareId` → a **web player** page. Song plays free in the browser. A "view" (`web_player_opened`) is counted on page open — this is the 605. The web player deliberately does **not** auto-open/redirect to the app.
3. To bind, recipient must tap "Save to Library" → AppsFlyer OneLink → app if installed, else App Store.
4. Binding (`POST /share/:shareId/claim`) requires ALL of: `platform != "web"` (hard block), app installed + opened, signed in with Apple ID (else 401 `SIGN_IN_REQUIRED`), correct 6-digit PIN (else 401 `INVALID_PIN`), device/user not already bound, valid handoff token (14-day TTL, single-use).

Funnel: open web player (free listen) → tap Save → have app installed → sign in → enter PIN → bound.

---

## Advisor Responses

### The Contrarian (anonymized as Response D)

The mechanism isn't broken — the design is. The web player is too good. It plays the song free, instantly, zero friction. The recipient's entire need — hear the gift — is satisfied in the browser. Binding offers nothing they don't already have. Why install an app, sign in, hunt for a 6-digit PIN to "save" a song they can already replay forever (it's lifetime!)? Stack the friction: install → Apple sign-in → find PIN buried in a text → 14-day handoff token. Four cliffs, each halves survivors. The PIN is the assassin — it lives in the sender's message; if forwarded/screenshotted/scrolled past, binding is impossible and you log it as generic failure. You're probably bleeding people at INVALID_PIN. Hard question you're avoiding: is "bound" even the right success metric? Senders are the buyers. Have you confirmed a single recipient ever became a sender? If zero of 605 did, fixing binding to 50 changes nothing. Prove the loop converts at all before optimizing the funnel. Otherwise you're polishing the lock on an empty vault.

### The First Principles Thinker (anonymized as Response A)

You're asking why recipients don't _bind_. Wrong question. Binding is a six-lock door. You designed a _claim_ flow and accidentally measured _friction_. 1.7% is the predictable yield of asking a gift recipient to do five things to "keep" a song they already heard for free. The viral loop needs recipients to become _senders_, not to "bind tokens." A recipient who loved the song wants to make one _back_. Three assumptions to kill: (1) That recipients should claim the sender's song at all — it's not theirs; skip the claim, go web player → "Make one back" → app. (2) That the PIN protects anything worth 98% of your funnel — delete the PIN. (3) That "free listen in browser" is a feature — it's the leak; the web player should be a trailer, not the whole movie. Real question: what makes a recipient send?

### The Expansionist (anonymized as Response C)

The web player isn't a leak — it's the most undervalued asset Porizo owns. 605 warm humans, each of whom got a personalized song made for someone they love, sat through it, and felt something. That's 60x larger than your entire paid user base (26 in 98 days). Wrong KPI. The asset isn't the recipient's library slot — it's their intent to reciprocate. (1) The highest-converting next action isn't "claim this song," it's "make one back, right now, on this same web page." Put a web-based create flow on the player: pick occasion, type a name, hear a 15s preview, pay $1.99. The web player becomes a storefront, not a turnstile. (2) Every play is a testimonial — 605 chances to capture a reaction or "send one back" referral that re-engages the sender too. (3) Drop binding as the conversion goal entirely. The 605 are screaming to buy, not to claim.

### The Outsider (anonymized as Response E)

You hand me a link, I tap it, the song plays. Done. My friend made me a thing, I heard it, I felt the feeling, I sent back a heart emoji. Why would I keep going? Where you lose me: the moment "Save to Library" throws me at the App Store. Downloading an app is a big ask. Then signing in with Apple ID — now it feels like I'm signing up, not receiving a gift. And a 6-digit PIN from up in the text? I've lost that text in the thread. I'm out. You've already given me the good part for free. There's no reason left to do the hard part. What would make me move: let me save it without an account first — text or email me the link to keep. Pre-fill the PIN so I never type anything. And give me a reason about ME: "Make one back for them" beats "claim your song." Biggest fix: kill the forced app download to keep something I already own.

### The Executor (anonymized as Response B)

The web player is where 605 views go to die. Attack the web player first. Monday task: change the "Save to Library" CTA so the song-end state is a hard wall — "This song was made for YOU. Claim it free, keep it forever" — with the PIN pre-filled into the deep link. Then, in priority order: (1) **Pre-fill the PIN** — it's in the share message already; pass it through the OneLink so claim views auto-populate. One day of work, server already accepts it. (2) **Soften SIGN_IN_REQUIRED** — let the song bind to the device first, then prompt sign-in to "save permanently." Move auth after the emotional payoff. (3) **Instrument the funnel** — you have 605/10 but no idea where the 595 fall off. Log each step: OneLink click, app open, claim attempt, which 401 fired. Do #1 and #3 this week. Don't touch the handoff/claim token TTLs.

---

## Peer Reviews (anonymized mapping: A=First Principles, B=Executor, C=Expansionist, D=Contrarian, E=Outsider)

**Reviewer 1:** Strongest = D (refuses to optimize before validating the premise; "polishing the lock on an empty vault"). Biggest blind spot = C (web storefront is a second product, ignores iOS build cost and App Store IAP risk). All missed: measurement of the prior step (how many shares _sent_, how many _opened_?) and the _sender_ as the warmest re-engagement asset.

**Reviewer 2:** Strongest = D. Biggest blind spot = C (bets on web pay flow with zero evidence of buy intent; contradicts iOS-only payment reality). All missed: nobody questioned the _data_ — 605 views likely includes senders, link previews, bots; real denominator unknown.

**Reviewer 3:** Strongest = D (only falsifiable test of the metric). Biggest blind spot = B (most actionable but never questions whether "bound" is the right goal). All missed: _sender re-engagement_ — the sender already has the app and is the proven buyer; a shared song is a re-purchase trigger.

**Reviewer 4:** Strongest = D. Biggest blind spot = C (web pay flow collides with App Store IAP / 30%; assumes 605 are "screaming to buy"). All missed: device-type split — "web can never bind" means an unknown share of 605 are desktop/web-only and structurally incapable of binding. Also: just _ask_ a few recipients why they stopped.

**Reviewer 5:** Strongest = D. Biggest blind spot = C (abandons iOS distribution surface, IAP collision). All missed: the funnel is uninstrumented, so every claim about _where_ the 595 drop is a guess; and 605 "views" may be inflated by iMessage/WhatsApp link previews (auto-fetch). The denominator may be fiction.

---

## Chairman's Synthesis

See `council-report-2026-06-21_12-04.html` for the full verdict.

**Where the council agrees:**

- The free web player satisfies the recipient's entire need, so binding offers them nothing — 1.7% is the arithmetic of a multi-gate funnel guarding a prize the user already holds.
- The PIN (buried in the sender's message) and the forced sign-in are the two most destructive, least-justified gates.
- The recipient's strongest impulse is to **reciprocate ("make one back")**, not to "claim."

**Where the council clashes:**

- Build a **web-based create/buy flow** (Expansionist) vs. **don't — it collides with App Store IAP and is a second product** (4 of 5 reviewers). Resolved against the pure web-storefront.
- **Optimize the funnel now** (Executor) vs. **validate the loop converts at all first** (Contrarian).

**Blind spots the peer round caught:**

- The **605 is probably inflated** by iMessage/WhatsApp link previews, the sender re-checking, and bots — the real denominator is unknown.
- An unknown share of views are **desktop/web — structurally unable to bind**.
- Nobody is **re-engaging the sender**, the one proven buyer.
- The funnel is **uninstrumented** — we don't know which 401 fires.

**Recommendation:** Diagnose before building. Run the DB queries to (1) segment the 605 by device/dedupe previews, (2) check whether any recipient ever became a sender, (3) find which claim error dominates. Then ship the cheap, high-leverage fixes: pre-fill the PIN through the deep link, defer sign-in until after the song is saved, and reframe the CTA from "claim" to "make one back."

**The one thing to do first:** Run the diagnostic SQL on production (segment the 605, check recipient→sender conversion, count the failing claim errors) before writing any product code.
