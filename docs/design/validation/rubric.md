# Human Review Rubric

**Purpose:** Score emotional and experiential quality that automation cannot judge.
**When to use:** After each validation run, review screenshots and videos against this rubric.

---

## Scoring

For each question: **Pass** / **Partial** / **Fail** / **N/A**

---

## Questions

### 1. Is the next action obvious?
Without any explanation, can a first-time user tell what to do next?
- **Pass:** One clear CTA, no ambiguity
- **Partial:** CTA exists but competes with other elements
- **Fail:** User would need to search or guess

### 2. Does the moment feel like a gift, not a tool?
Does the screen feel like receiving or creating something personal?
- **Pass:** Emotional framing, personal names prominent, warm visual tone
- **Partial:** Functional but not emotional
- **Fail:** Feels like a file manager, media player, or admin panel

### 3. Is the person more prominent than the machinery?
Is the recipient/sender name louder than track IDs, status labels, or product branding?
- **Pass:** "For Sarah" is the hero text
- **Partial:** Name is present but secondary to metadata
- **Fail:** "Track v2 - Preview Ready" or similar system language dominates

### 4. Does the app ask come after value?
Is the install/signup/claim prompt timed AFTER the user has received meaningful value?
- **Pass:** User has heard the song / seen the poem before any friction
- **Partial:** Brief friction before value, then value
- **Fail:** "Download the app" or "Sign up" appears before any content

### 5. Is there distracting chrome?
Are there elements that don't serve the current moment?
- **Pass:** Every visible element serves the current user goal
- **Partial:** Minor non-functional elements (e.g., disabled buttons)
- **Fail:** "Coming soon" stubs, exposed system percentages, dead navigation

### 6. Would this make someone share?
After experiencing this flow, would the recipient want to:
a) Show it to someone else?
b) Make one for someone they love?
- **Pass:** Both paths feel natural and compelling
- **Partial:** One path is present, the other is missing or weak
- **Fail:** No viral loop visible or the experience doesn't inspire sharing

---

## Per-Scenario Scoring Template

```markdown
## Run: [date]
## Scenario: [S1/S2/etc]
## Reviewer: [name]

| # | Question | Score | Notes |
|---|----------|-------|-------|
| 1 | Next action obvious? | | |
| 2 | Gift, not tool? | | |
| 3 | Person > machinery? | | |
| 4 | App ask after value? | | |
| 5 | No distracting chrome? | | |
| 6 | Would they share? | | |

**Overall:** Pass / Partial / Fail
**Key observations:**
```

---

## When a flow passes automation but fails this rubric

It is not done. File a follow-up with the specific rubric question that failed and a screenshot showing why. Emotional quality is a shipping requirement, not a nice-to-have.
