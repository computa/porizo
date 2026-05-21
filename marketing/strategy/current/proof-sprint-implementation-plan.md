# 14-Day Proof Sprint Implementation Plan

**Date:** 2026-05-16  
**Status:** Active operating plan  
**Parent strategy:** [`proof-first-distribution-reset.md`](proof-first-distribution-reset.md)

## Goal

Prove that strangers want the emotional outcome enough to download or create by leading with finished songs and reactions instead of "Porizo the app."

## Success Bar

By day 14, hit at least one of:

- 10 completed concierge songs for people outside the inner circle.
- 3 usable testimonials or recipient reactions.
- 25 App Store clicks from proof-led content.
- 5 completed songs from non-paid/non-brand sources.

## Operating Rule

This sprint is not a scattershot channel push. Every activity must connect to one of three things:

1. A finished song proof asset.
2. A real person with a real occasion.
3. A measurable next action: reply, App Store click, install, or completed song.

If an activity does not produce one of those, do not do it during this sprint.

## Workstream 1: Proof Assets

Create three strong song examples before scaling outreach or paid media.

### Occasions

Use three different emotional moments:

- Birthday for mum or dad.
- Anniversary or partner appreciation.
- Best friend, long-distance, apology, memorial, or "I never say this enough."

### Asset Package

For each proof asset, create:

- `story.md`: believable 5-8 sentence story.
- `song.mp3` or `song.m4a`: finished song.
- `clip.mp4`: 20-40 second proof clip.
- `caption.md`: short-form/social caption.
- `notes.md`: what this asset is testing.

### Output Folder

Use:

`marketing/campaigns/output/proof-sprint-2026-05/`

Recommended structure:

```text
marketing/campaigns/output/proof-sprint-2026-05/
├── 01-parent-birthday/
│   ├── story.md
│   ├── song.mp3
│   ├── clip.mp4
│   ├── caption.md
│   └── notes.md
├── 02-partner-anniversary/
│   └── ...
└── 03-friend-distance/
    └── ...
```

## Workstream 2: Manual Concierge

Start with real people, not ads.

### Daily Target

For the first 7 days:

- Send 5 personal/manual outreaches per day.
- Complete up to 2 free songs per day for responders.
- Ask for honest feedback first.
- Ask for testimonial/reaction permission only after they hear the song.

### Outreach Offer

Use this plain version:

> I’m testing Porizo with real gift moments. Send me 5 sentences about someone you love and I’ll make a short personalized song for free. I only want honest feedback.

### Tracker

Create:

`marketing/channels/creators/proof-sprint-outreach.csv`

Columns:

```csv
date,source,name,occasion,status,song_done,feedback,permission,result
```

Status values:

- `identified`
- `contacted`
- `replied`
- `story_received`
- `song_created`
- `feedback_received`
- `permission_granted`
- `closed_no_response`

## Workstream 3: Proof-Led Posting

Only post once at least one proof asset is strong enough to show.

### Channels

- Reddit/community: story-first post, no hard app pitch.
- TikTok/Reels: song/reaction/lyric line in first 2 seconds.
- Personal network: direct ask for people with upcoming birthdays, anniversaries, apologies, or parent moments.

### Posting Rule

Every post must show the artifact before describing the product.

Weak:

> Download Porizo, an AI song app.

Strong:

> I turned one memory about my mum into this song. She replayed it three times.

### CTA

Use one of:

- "Send me a story and I’ll make one for you."
- "Make yours free in Porizo."
- "Who would you make this for?"

Choose based on channel trust. Reddit and personal network should usually use the first or third CTA.

## Workstream 4: App Store and Apple Search Ads

Keep Apple Search Ads running as measurement, not scale.

### Monitoring

For short-window monitoring:

```bash
node scripts/aso/spend-history.mjs --days 3
```

For ASO rerank:

```bash
node scripts/aso/review.mjs --days 30 --note "Weekly ASO review"
```

Do not increase broad paid spend until a proof-led asset shows meaningful engagement or download intent.

## Workstream 5: Sprint Measurement

Create:

`marketing/strategy/current/proof-sprint-tracker.md`

Track daily:

- Outreaches sent.
- Replies.
- Stories received.
- Songs completed.
- Testimonials/reactions.
- Posts shipped.
- App Store clicks.
- Installs.
- Completed songs.
- Strongest learning.

Template:

```md
## Day N — YYYY-MM-DD

- Outreaches sent:
- Replies:
- Stories received:
- Songs completed:
- Testimonials/reactions:
- Posts shipped:
- App Store clicks:
- Installs:
- Completed songs:
- Strongest learning:
- Decision for tomorrow:
```

## Day-by-Day Plan

### Day 1

- Create `proof-sprint-tracker.md`.
- Create `proof-sprint-outreach.csv`.
- Create `marketing/campaigns/output/proof-sprint-2026-05/`.
- Pick three proof stories.
- Generate the first proof song.
- Draft an outreach list of 30 people.

### Days 2-3

- Finish three proof songs/clips.
- Send 10 manual outreaches.
- Post one proof-led story if at least one asset is strong enough.
- Record replies and objections in the tracker.

### Days 4-7

- Send 5 manual outreaches per day.
- Make songs for responders.
- Collect feedback/testimonials.
- Ship 1-2 proof-led posts.
- Keep Apple Search Ads monitoring only.

### Day 8

- Review data.
- Pick the strongest occasion/message.
- Cut weak channels.
- Decide whether creator outreach is justified by proof quality.

### Days 9-14

- Double down on the best occasion/message.
- DM creators only with the strongest proof asset.
- Continue manual concierge.
- Keep measuring completed songs and meaningful replies over impressions.

## Immediate Next Action

Create the operating files:

```bash
mkdir -p marketing/campaigns/output/proof-sprint-2026-05
touch marketing/strategy/current/proof-sprint-tracker.md
touch marketing/channels/creators/proof-sprint-outreach.csv
```

Then create the first proof package under:

`marketing/campaigns/output/proof-sprint-2026-05/01-parent-birthday/`

The first proof asset should be strong enough that someone understands the emotional value before they understand the app mechanics.

