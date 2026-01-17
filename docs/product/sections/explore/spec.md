# Explore Section Specification

## Overview
A discovery hub showcasing trending creations, popular templates, and inspiration. Features horizontal scroll sections (Fresh Hits, Top Songs, Popular), ranked lists, and clean card-based browsing. Light UI with rose accents.

## User Flows

### Primary Flow: Browse Featured Content
1. User taps Explore tab
2. Views curated sections:
   - "Fresh Hits" — Latest community creations
   - "Top Songs" — Most played/shared
   - "Popular Occasions" — Trending occasions
3. Horizontal scroll through each section
4. Tap card to preview or use as template

### Secondary Flow: Use Template
1. User taps a song card
2. Preview modal shows:
   - Song details (occasion, style, recipient type)
   - Sample lyrics snippet
   - "Use This Template" button
3. Tapping "Use This Template" opens Create flow pre-filled

### Secondary Flow: Browse by Category
1. User scrolls to "Browse by Occasion" section
2. Grid of occasion cards with emoji and count
3. Tap occasion to see all songs in that category
4. Filter and sort options

### Secondary Flow: Listen to Sample
1. User taps play on featured song
2. 15-30 second preview plays
3. "Create Similar" CTA appears

## UI Requirements

### Global Layout (Light Mode)
- Background: white
- Section backgrounds: white
- Card backgrounds: white with stone-200 border
- Accent colors: rose-500, rose-300
- Text: stone-900 (primary), stone-500 (secondary)

### Section Headers
- "Fresh Hits", "Top Songs", "Popular" etc.
- "See All" link on right
- Subtle divider below header

### Horizontal Scroll Sections
- Card width: ~200pt
- Card height: ~250pt
- Snap to card edges
- Peek next card (show partial card)

### Song Cards (Horizontal Scroll)
- Rounded corners (12pt)
- Cover art area (gradient placeholder or AI-generated)
- Song title (16pt semibold)
- Creator/template type (14pt, zinc-400)
- Occasion badge (small pill)
- Play count or "Featured" badge

### Ranked Lists (Top Songs)
- Numbered ranks (1, 2, 3...) with large typography
- Horizontal card list
- Rank number on left side of card
- Subtle ranking indicators (gold for #1, silver for #2, etc.)

### Large Thumbnail Cards (Alternative Layout)
- Full-width cards for featured content
- Large cover image (16:9 ratio)
- Title and description below
- "Listen" and "Create Similar" buttons

### Empty/Loading States
- Skeleton loaders matching card shapes
- Shimmer animation
- "Discovering music..." placeholder text

### Filter Pills (Category View)
- Horizontal scroll of filter options
- "All", "Birthday", "Anniversary", etc.
- Selected state: rose background
- Unselected: stone-100

## Sections to Display
1. **Fresh Hits** — Newest creations (horizontal scroll)
2. **Top Songs** — Ranked list with numbers (horizontal scroll)
3. **Popular Occasions** — Grid of occasion cards
4. **Templates** — Pre-made starting points (horizontal scroll)
5. **Trending Styles** — Music genres gaining popularity

## Configuration
- shell: true (displays inside tab bar with navigation)
