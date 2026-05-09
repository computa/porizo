# Cold-Intro Mother's Day Campaign

**Cohort:** External email list (people NOT yet Porizo users — early-list signups, prior outreach contacts, etc.).

**Why this cohort matters:** Pure acquisition push. They've never used Porizo, but they're on a list because they expressed some prior interest. Mother's Day is a low-friction reason to introduce the product because it's universally relatable.

**Important:** This template assumes recipients gave consent to be on the early-list. Verify the source list before sending. Include a clear opt-out ("Reply 'stop' if you'd rather not").

**Source list — confirm before sending:**

- [ ] Where did this email list come from?
- [ ] Did recipients explicitly opt in?
- [ ] Is there a record of consent we can cite if questioned?
- [ ] Are these emails verified deliverable?

**SQL definition:** N/A — list comes from outside production DB. Likely from:

- `marketing/emails/email-addresses/` directory
- A Google Sheet of early-list signups
- A CSV from a prior outreach campaign

Always export to `/tmp/cold-intro-mothers-day-2026-05-09.json` and dedupe against any prior contacts before sending.

**Subject:** `The card she'll keep forever`
**Preview:** `A 21-second song, made from one memory of her. Free for Mother's Day.`
**CTA:** `Make her song free`
**CTA URL:** `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028`

**Send window:** 2026-05-09 afternoon/evening US time
**Sender:** `Ambrose from Porizo <support@porizo.co>`
**Reply-to:** `support@porizo.co`

## Send flow

1. Confirm cohort source + consent. Get explicit Ambrose approval before sending.
2. Dedupe against existing Porizo users (don't email people who already have an account).
3. Send one test to `abcobimma@gmail.com` first.
4. Review Resend deliverability insights — pay extra attention to spam-trigger phrases since these recipients may not recognize the sender.
5. **Pilot first:** Send to a 50-recipient batch, watch open/spam rates for 30 minutes before sending the rest.
6. After pilot looks clean, batch-send the remainder.
7. Capture batch ID, monitor delivery for 2 hours, log to `marketing/emails/sent/2026-05-09-cold-intro.log`.
