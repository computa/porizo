# Paid Social

Paid social setup and experiments live here.

## Current Stance: Paused

As of 2026-06-08, the live Meta campaign
`PORIZO_INSTALLS_FathersDay_2026_SKAN` (`52503493410610`) is paused.

Reason: the campaign spent A$196.53 for 10 installs, roughly A$19.65 CPI,
with no downstream subscription signal. Do not restart or scale broad seasonal
paid social until `/download` attribution is matching installs/users and a
narrow `song gift` test has a measurable conversion path.

Next paid test, when attribution is fixed:

- Wedge: exact `song gift` intent only.
- Creative promise: "Make a song gift in minutes."
- Landing path: App Store product page or custom product page that repeats the
  same `song gift` promise in the first screenshot.
- Budget cap: A$10/day for 3 days, or A$50 total, whichever comes first.
- Kill rule: pause immediately if CPI is above A$8 after 6 installs, or if
  attributed registrations/activated users remain at 0 after A$30 spend.
- Scale rule: no budget increase until install, registration, first-song, and
  purchase/subscription attribution are visible in the same report.

Key files:

- [`meta-ads-setup-checklist.md`](meta-ads-setup-checklist.md)

Related assets:

- Legacy Meta/TikTok creative assets: [`../../ads-campaign/`](../../ads-campaign/)
- TikTok trial assets: [`../../tiktok-trial/`](../../tiktok-trial/)

Current GTM stance: do not increase paid social spend until a proof-led organic asset produces meaningful engagement or download intent.
