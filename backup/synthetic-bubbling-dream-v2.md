# V2 MVP Scope: User-Voice Song Messaging

## Goal
Let a user send how they feel to a loved one via a 45–60 second song that sounds like the user’s own voice. The user does not need professional singing ability.

## Core User Flow
1. Record voice (spoken + short sung/hummed prompts) and consent.
2. Enter mood, recipient name, and message; review/edit lyrics.
3. Generate song (instrumental + guide vocal → voice conversion → mix/master).
4. Creator shares once; recipient can stream from the link and is offered an optional app download to save.

## In Scope
- In‑app recording only (no file uploads).
- Voice quality checks with re‑record prompts.
- Lyrics generation with user approval/editing.
- Song generation pipeline with async status updates.
- One‑time share link created by the creator only.
- Private playback page with an app download link for recipients; download for creator.
- Basic rate limits and audit logging.

## Out of Scope (MVP)
- Payments/credits and subscriptions.
- Section rerolls, stems editing, and advanced mixing controls.
- Social feeds or public discovery.
- Multi‑language support beyond one default language.

## Functional Requirements
- **User voice default:** all songs render with the creator’s voice; no AI‑voice fallback in the main flow.
- **Consent + deletion:** explicit voice‑use consent; user can delete voice data.
- **Lyrics approval:** user can edit and approve lyrics before rendering.
- **Share‑once:** creator can generate one share token per song; recipient cannot re‑share.
- **Recipient storage:** recipient can stream from the link but can only save the song inside the mobile app.

## Share‑Once Rules
- One share token per song, created only by the creator.
- Token is bound to recipient identity (email/phone verification).
- Recipient playback is allowed only for the verified identity.
- Recipient can stream via the share link; saving is only available in the mobile app (optional install).
- No “share” UI for recipients; forwarding the link fails authorization.
- Creator can revoke access.

## Quality Gates
- Minimum sample length and noise/clipping thresholds before rendering.
- If voice conversion fails, user is prompted to re‑record or try again.

## Non‑Functional Targets
- p95 generation time under 4 minutes.
- 70%+ of users rate “sounds like me” on first attempt.
- Clear failure messaging with no silent errors.

## MVP Acceptance Criteria
- End‑to‑end flow works for a new user within a single session.
- Songs audibly resemble the creator’s voice in the majority of test cases.
- Share‑once enforcement blocks recipient re‑sharing on a second device/account.
- Recipient can stream on the share link but can only store the song inside the mobile app.
- Deleting voice data removes stored samples and prevents further use.
