# Porizo — Monetization & Viral-Loop Decisions (Decision Log)

**Date:** 2026-06-04 · Owner: Ambrose · Status: DECIDED, pre-implementation.
Captures the decisions made while turning the failure diagnosis into a concrete fix. Companion to `porizo-recovery-plan-2026-06.md` and `porizo-growth-playbook-2026-06.md`. Demos: `docs/demos/{reveal-paywall,create-pay-flow,viral-loop}-demo.html`.

**Guiding principle: REFINE, not redesign.** Onboarding and Reveal are already strong. Accommodate these decisions with the _smallest_ changes to existing screens — do not start new designs.

---

## A. Positioning

- **No "your voice."** Voice-cloning tech is not ready. Remove every "in your voice / sing in your voice / voice clone" promise from the App Store listing and marketing (false promise + rejection risk). See [[project_no_voice_cloning_tech]].
- **The wedge is speed + price + emotion:** "the $150–330, 4–7-day custom-song gift (Songfinch/Songlorious) — instantly, for ~$2." This is the TikTok hook and SEO angle.

## B. Monetization model — three tracks, two credit ledgers (intentional)

| Track                            | Credit ledger                      | Role                                                   |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| **Pay-per-song** (NEW, the face) | `songs_remaining`                  | One-off "$1.99 to make a song." The primary CTA.       |
| **Subscription** (retained)      | `songs_remaining` (monthly refill) | Ongoing commitment, demoted to secondary.              |
| **Gift bundles** (retained)      | `gift_wallet`                      | One-off tokens to _send_ a song to someone. Secondary. |

- **The face changes from "subscribe" to "pay for one song."** Subscription was the implicit face of making a song; that is the problem we're testing against.
- **NEW product required:** a pay-per-song consumable (1 song) that credits `songs_remaining` — does **not** exist today (today the only one-off products credit `gift_wallet`). This is the one genuinely new SKU.
- **Two ledgers stay separate** (decision confirmed): make-your-own (`songs_remaining`) vs send-a-gift (`gift_wallet`).

## C. Pricing — reprice to ~$2/song across the board

| Product                    | Old                 | New                   | Per song |
| -------------------------- | ------------------- | --------------------- | -------- |
| 1 song (pay-per-song, NEW) | —                   | **$1.99**             | $1.99    |
| 3 songs                    | $12.99              | **$4.99**             | $1.66    |
| 5 songs                    | $17.99              | **$7.99**             | $1.60    |
| Plus subscription          | $9.99/mo            | **$7.99/mo** (10)     | $0.80    |
| Pro subscription           | $14.99/mo           | **$12.99/mo** (20)    | $0.65    |
| Gift bundles 1/3/5         | $4.99/$12.99/$17.99 | **$1.99/$4.99/$7.99** | matches  |

- **Repricing spans 3 surfaces** (order matters): **(1) App Store Connect IAP** = the real charged price + create the new pay-per-song SKU (sub _increases_ need consumer consent; decreases are fine); **(2) backend DB** (`gift_bundles.price_cents`, `subscription_plans.price_*`, new rows) — display/gating only, must mirror ASC; **(3) website** (porizo.co). ASC is the source of truth; the app must display StoreKit's price or risk rejection.

## D. Create flow — keep current design (no preview), refine only

- **First song is FREE on signup** (existing `free_tier_songs_grant`). This is the value-first hook — _why no preview is needed_.
- **No song preview. Single full generation.** (Intentional — avoids double render cost and spend-before-pay.) Keep.
- **The paywall lands on song #2+**, where pay-per-song ($1.99) is the face. It hits a user who already loved their free first song.

## E. Reveal screen — already great, minimal add

- Keep the existing reveal. Add: **share-link prominence** + a **"Send + capture his reaction"** prompt (the reaction video is the TikTok content asset — viral loop and content engine become one asset).

## F. Viral loop (recipient) — A + B + C stacked (all three)

The web listen stays free and great; the _download_ is motivated by what web can't give.

- **A — Reply:** "Save this song" → **"Make one back for [Sender]"** (reciprocity at peak emotion). Two-sided: recipient's first song free, sender gets one free when they finish (~$0.07 render cost).
- **B — App-only keepsakes:** web = listen; app = **HD audio download + reveal video + lyric card + library.** Never block the listen.
- **C — Claim-to-keep urgency:** "This gift link is live for 7 days — claim it in the app to keep forever."
- **Plumbing:** deferred deep linking via **AppsFlyer OneLink** (already integrated) so installers land in the pre-filled "make one back for [Sender]" flow — without it, recipient→registration attribution stays 0. Instant play, no PIN/signup to listen. Social proof on the landing.
- **Target:** recipient→register 10–15% (from 0%) → K ≈ 0.1–0.15.

## G. Onboarding — already great, minimal change

- Keep the OnboardingV2 sequence. Refine: the **Payoff** screen frames the first song as **free**; strip any "your voice" promise from onboarding copy.

## H. Measurement

- `daily_aggregates` rollup is broken (SQLite placeholders never ported to PG). Track the test directly from `gift_orders` / `gift_wallet_transactions` / `purchase_receipts` / `events` until fixed.
- Ship the test behind a feature flag for a clean A/B.

---

## I. Screen-by-screen refinement map (REFINE, not redesign)

Verified against the live SwiftUI/web code. **Every change is a copy edit or a minor reorder — no new screens.**

| Decision                                           | File(s)                                                                    | Change                                                                                                                                 | Size        |
| -------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| First song FREE in onboarding payoff               | `Onboarding/OnboardingPayoffView.swift` (headline ~:39, CTA ~:64)          | Headline "Your first forever gift" → "Make your first song free"; CTA "Make This Song" → add "— Free" / subtext                        | **XS**      |
| "First song free · $1.99 after" at create entry    | `Flows/InlineNamePromptView.swift`                                         | One `Text` pricing label below type selector                                                                                           | **XS**      |
| Reveal: action-forward share + reaction            | `Flows/RevealBloomView.swift` (~:285–296 share, :303 tertiary)             | "Share with {name}" → "Send to {name}"; add secondary "Send & see their reaction"                                                      | **XS–S**    |
| Paywall: pay-per-song hero, subscription secondary | **`SubscriptionViewV2.swift`** (the LIVE paywall — verified on device)     | **ADD** a pay-per-song hero section at top (V2 has NO one-off purchase today); demote the Free/Plus/Pro cards to "or subscribe & save" | **M**       |
| Paywall personalized w/ recipient name             | `SubscriptionViewV2.swift` + caller `WarmCanvasFlowView.swift:1049`        | Thread `recipientName: String?`; one personalized line                                                                                 | **S**       |
| NoCreditsView personalized CTA                     | `WarmCanvasFlowView.swift:951–967`                                         | "Upgrade" → "Make {name}'s song · $1.99"                                                                                               | **XS**      |
| Recipient A (reply)                                | `ShareClaimView.swift:209` (dead text) + web `web-player/index.html:290`   | "Make one for someone you love" → "Make one back for {senderName}" (interactive)                                                       | **XS–S**    |
| Recipient B (keepsakes)                            | `ShareClaimView.swift` (~:543–562), `web-player/index.html`                | "Save" framing → app-only HD/video/lyric-card; reorder                                                                                 | **S**       |
| Recipient C (claim urgency)                        | `ShareClaimView.swift` preview, web teaser                                 | "Save before this link expires (7 days)" chip                                                                                          | **XS**      |
| Repricing                                          | App Store Connect IAP + DB (`gift_bundles`,`subscription_plans`) + website | Numbers + new pay-per-song SKU                                                                                                         | **M** (ASC) |

**Existing screens kept as-is** (strong already): the OnboardingV2 sequence structure, `RevealBloomView` (bloom + play + share), `WarmCanvasFlowView` create steps. We touch _copy and order_, not structure.

## J. 🔴 Live false-promise to fix NOW (App Store rejection + voice-decision risk)

Promotional text in **live v1.5.14** and fastlane says: _"Make a personal song for Dad **in his voice** or yours."_ — "in his voice" implies cloning the _recipient's_ voice, which is **not supported** (enrollment is self-only, and per [[project_no_voice_cloning_tech]] voice isn't shippable). This is a false promise in live store copy.

- Files: `marketing/appstore/metadata/version/1.5.14/en-US.json:6`, `PorizoApp/fastlane/metadata/en-US/promotional_text.txt:1` (also stale in 1.5.12/1.5.13 What's New).
- Fix: remove the voice claim entirely (align with the no-voice positioning). **Pair with the Issue-1 screenshot fix.**
- Onboarding Swift copy audited: **clean** (zero voice claims). Web player AI-disclosure footer is accurate (not a promise).

## K. Live paywall verified on device (2026-06-04)

The running iPhone paywall is **`SubscriptionViewV2`** — cream canvas (NOT the dark iPad mock, which was stale), title "Subscription", "{N} credits remaining" (coral), Monthly/Annual **SAVE 40%**, three cards: **Free** ("2 song + 12 poem one-time"), **Plus $9.99/mo**, **Pro $22.99/mo (CURRENT)**, each with feature bullets + coral **Subscribe** button. **No one-off / gift purchase appears here at all.** Tapping Subscribe → native App Store sheet ("Plus Monthly · $9.99/month").

- **Price mismatch:** live **Pro = $22.99/mo** but DB `subscription_plans` says $14.99 → DB is out of sync; ASC is the source of truth. Repricing must set ASC and reconcile the DB to it.
- So the paywall refinement = **refine V2 + ADD a pay-per-song hero section** (it has none today), demote the subscription cards.

## Open items before implementation spec

1. Final confirm the new **pay-per-song SKU** ($1.99 → `songs_remaining`).
2. Confirm pricing numbers (esp. subscription reprice) — note live prices (Plus $9.99 / Pro $22.99) differ from DB; decide final ladder.
3. ~~V1 vs V2?~~ **RESOLVED:** the live paywall is `SubscriptionViewV2` — refine that one.
