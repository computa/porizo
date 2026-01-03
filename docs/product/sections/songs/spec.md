# Songs Section Specification

## Overview
The user's personal library of created songs with modern dark UI. Features card-based layout, playback controls, status indicators, and a promotional banner for empty states. Designed with horizontal sections and visual hierarchy.

## User Flows

### Primary Flow: Browse Songs
1. User taps Songs tab
2. Views library organized by status/recency
3. Completed songs show play button
4. Drafts show "Continue" action
5. Pull to refresh

### Secondary Flow: Play Song
1. User taps play button on completed song card
2. Audio loads with loading spinner
3. Playback begins with mini-player controls
4. Tap again to pause
5. Playback continues while browsing

### Secondary Flow: Resume Draft
1. User taps draft song card
2. App opens Create flow at Lyrics Review
3. User continues creation process

### Secondary Flow: Song Details (Future)
1. User taps song card (not play button)
2. Full-screen detail view opens
3. See lyrics, recipient, creation date
4. Options: Share, Create Variation, Delete

## UI Requirements

### Global Layout (Dark Mode)
- Background: zinc-950
- Card backgrounds: zinc-900
- Accent colors: violet-500, blue-500
- Text: zinc-100 (primary), zinc-400 (secondary)

### Empty State
- Full-screen centered layout
- Large music note icon (zinc-600)
- "No Songs Yet" headline
- "Create your first personalized song!" subtext
- Promotional banner card above empty message:
  - Gradient background (violet → blue)
  - "Create Your First Song" CTA
  - Brief value proposition

### Song List View
- Section headers: "Recent", "Completed", "In Progress"
- Card-based layout (not list rows)
- Card contents:
  - Large thumbnail/cover art area (gradient placeholder if none)
  - Song title (headline weight)
  - Recipient name
  - Occasion badge (pill)
  - Status indicator
  - Play button overlay (completed songs)

### Song Card States
- **Completed (preview_ready, full_ready)**:
  - Play button overlay (white circle with play icon)
  - Green status dot
  - "Ready to play" or duration label

- **Rendering/Processing**:
  - Orange pulsing status dot
  - Progress indicator
  - "Creating..." label

- **Draft**:
  - Dashed border
  - "Continue" button
  - Gray status

- **Failed**:
  - Red status indicator
  - "Retry" option

### Playback Controls (Mini-Player)
- Appears at bottom when playing
- Song title, play/pause, progress bar
- Tap to expand to full player

### Navigation
- "My Songs" title
- Plus button (top right) to create new
- Back button returns to previous tab

## Configuration
- shell: true (displays inside tab bar with navigation)
