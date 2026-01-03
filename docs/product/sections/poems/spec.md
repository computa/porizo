# Poems Section Specification

## Overview
The user's library of personalized poems. Browse, view, and share heartfelt written expressions created for loved ones. Poems offer a text-based alternative to songs for users who want meaningful words without music.

## User Flows

### Primary Flow: Browse Poems
1. User taps Poems tab
2. View grid/list of all created poems sorted by most recent
3. Each poem card shows title, recipient, occasion, and preview snippet
4. Pull to refresh to update list

### Secondary Flow: View Poem
1. User taps on a poem card
2. Full poem displays in elegant reading view
3. Options to share, copy text, or create variation

### Secondary Flow: Share Poem
1. User taps share button on poem
2. Share sheet presents options:
   - Copy text to clipboard
   - Share as image (styled card)
   - Share via Messages, Email, etc.
3. Track sharing for analytics

### Secondary Flow: Create Variation
1. User taps "Create Variation" on existing poem
2. Opens Create flow with pre-filled context
3. Option to adjust tone, length, or style
4. New poem created as variation (linked to original)

## UI Requirements

- Navigation title: "My Poems"
- Card-based layout showing:
  - Poem title
  - Recipient name
  - Occasion with emoji
  - First 2-3 lines as preview
  - Creation date
- Empty state with:
  - Book icon (purple theme)
  - "No Poems Yet" message
  - "Create Your First Poem" CTA button
- Full poem view:
  - Elegant typography (serif or script-style font)
  - Recipient dedication at top
  - Structured verses/stanzas
  - Share and variation buttons
- Pull-to-refresh functionality

## Poem Types to Support
- Love Letters
- Birthday Wishes
- Thank You Notes
- Apology Letters
- Encouragement Messages
- Custom Occasion Poems

## Configuration
- shell: true (displays inside tab bar with navigation)
