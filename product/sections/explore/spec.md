# Explore Section Specification

## Overview
A discovery hub for inspiration and quick-start creation. Users browse occasions, view templates, discover trending styles, and find creative prompts to jumpstart their personalized songs and poems.

## User Flows

### Primary Flow: Browse by Occasion
1. User taps Explore tab
2. View grid of occasion categories with emojis and colors
3. Tap occasion card to launch Create flow with that occasion pre-selected
4. Skip directly to story capture with context set

### Secondary Flow: Browse Inspiration Cards
1. User scrolls to "Need inspiration?" section
2. Horizontal scroll through themed inspiration cards
3. Tap card to see expanded idea with example prompts
4. "Create This" button launches Create flow with template

### Secondary Flow: Browse Templates (Future)
1. User taps "Templates" filter
2. View curated starting points for common scenarios:
   - "50th Birthday for Mom"
   - "First Anniversary"
   - "Thank You to Teacher"
3. Tap template to see preview and customize

### Secondary Flow: Trending Styles (Future)
1. User taps "Trending" section
2. View popular music styles and poem formats
3. Listen to style samples
4. Create with selected style

## UI Requirements

- Navigation title: "Explore"
- Header: "What's the occasion?" with subtitle
- 2-column grid of occasion cards:
  - Large emoji (36pt)
  - Occasion name
  - Colored background (occasion-specific)
  - Tap launches Create flow
- "Need inspiration?" horizontal scroll section:
  - Cards with icon, title, subtitle
  - Themed colors per card
  - Tap for expanded view or direct creation
- Sections for future features:
  - "Popular Templates" (placeholder)
  - "Trending Styles" (placeholder)
- Bottom padding for tab bar clearance

## Occasions to Display
- Birthday (pink)
- Anniversary (red)
- Thank You (orange)
- I Love You (red)
- Wedding (purple)
- Graduation (blue)
- Celebration (yellow)
- Apology (purple)
- Encouragement (green)
- Custom (gray)

## Inspiration Card Examples
- "Surprise your partner" — An unexpected love song
- "Thank a mentor" — Show your gratitude
- "Celebrate a friend" — For their special day
- "Comfort someone" — Words of encouragement
- "Say sorry" — A heartfelt apology

## Configuration
- shell: true (displays inside tab bar with navigation)
