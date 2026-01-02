# Songs Section Specification

## Overview
The user's personal library of created songs. Displays all tracks with status indicators, playback controls for completed songs, and the ability to resume drafts or view song details.

## User Flows

### Primary Flow: Browse Songs
1. User taps Songs tab
2. View list of all created songs sorted by most recent
3. Pull to refresh to update list

### Secondary Flow: Play Completed Song
1. User taps play button on a completed song (preview_ready or full_ready status)
2. Audio loads and begins playback
3. Tap again to pause
4. Playback continues while browsing (until leaving tab or tapping different song)

### Secondary Flow: Resume Draft
1. User taps on a draft song (draft or lyrics_approved status)
2. App opens Create flow at appropriate step (Lyrics Review)
3. User continues creation process

## UI Requirements

- Navigation title: "My Songs"
- List view with song rows containing:
  - Play/pause button (44pt tap target) for completed songs
  - Status icon for non-playable songs
  - Song title (headline font, single line)
  - Occasion badge + status text
  - Chevron indicator for tappable drafts
- Empty state with icon, message, and "Create Song" CTA button
- Pull-to-refresh functionality
- Loading indicator when fetching audio
- Status colors:
  - Green: preview_ready, full_ready
  - Orange: rendering, processing
  - Red: failed
  - Secondary: draft, lyrics_approved

## Song Statuses Displayed
- Preview Ready
- Complete
- Rendering...
- Failed
- Lyrics Approved
- Draft

## Configuration
- shell: true (displays inside tab bar with navigation)
