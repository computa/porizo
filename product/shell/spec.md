# Porizō iOS Shell Specification

## Overview
Native iOS app with tab bar navigation featuring a prominent center "Create" action button. The shell provides quick access to all core features while emphasizing creation as the primary user action.

## Navigation Structure

### Tab Bar (5 tabs)
| Position | Tab | SF Symbol | Purpose |
|----------|-----|-----------|---------|
| 1 | Songs | `music.note.list` | Library of created songs |
| 2 | Poems | `text.book.closed` | Library of created poems |
| 3 | **Create** | `plus.circle.fill` | Primary creation action (prominent) |
| 4 | Explore | `safari` | Discover occasions, templates, inspiration |
| 5 | Settings | `gearshape` | Profile, voice enrollment, preferences |

### Create Button (Center Tab)
- Visually prominent — larger than other tabs
- Accent color fill (not outline)
- Opens creation flow as modal or full-screen

### Navigation Stacks
Each tab has its own navigation stack:
- **Songs** → Song detail → Playback → Share
- **Poems** → Poem detail → Share
- **Create** → Occasion select → Story wizard → Preview → Confirm
- **Explore** → Category → Template detail → Use template
- **Settings** → Voice enrollment → Profile → Help

## Default State
- App opens to **Create** tab
- First-time users see onboarding overlay

## Voice Enrollment
- Accessible from **Settings** tab
- Also prompted contextually when user tries to create a voice-cloned song without enrollment

## Responsive Behavior
- **iPhone** — Standard tab bar at bottom
- **iPad** — Tab bar or sidebar (adaptive)
- **Landscape** — Tab bar remains at bottom

## Design Notes
- Tab bar uses system blur/vibrancy
- Active tab uses accent color
- Create button extends slightly above tab bar line
- Dark mode supported with automatic color adaptation
