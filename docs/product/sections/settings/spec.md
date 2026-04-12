# Settings Section Specification

## Overview
Profile management, subscription handling, and app configuration. Voice enrollment is now **optional** — positioned as a premium enhancement rather than a required step. Warm Canvas light UI with coral accents and clear visual hierarchy.

## User Flows

### Primary Flow: Browse Settings
1. User taps Settings tab
2. Views grouped sections:
   - Account (Profile, Email)
   - Your Voice (Optional enrollment)
   - Subscription (Plan management)
   - Support (Help, Contact)
   - App Info

### Secondary Flow: Voice Enrollment (Optional)
1. User taps "Your Voice" section
2. If not enrolled:
   - Promotional card explaining voice feature
   - "Your songs can sound like YOU singing!"
   - "NEW" badge highlighting the feature
   - "Set Up Voice" button
3. Enrollment flow (sheet):
   - Welcome with consent
   - Recording prompts (6-10 spoken + 1-2 sung)
   - Processing
   - Completion with quality score
4. If enrolled:
   - Voice profile status card
   - Quality score display
   - "Re-record" option
   - "Delete Voice Profile" option

### Secondary Flow: Manage Subscription
1. User taps "Subscription" row
2. Views current plan details:
   - Plan name and price
   - Credits remaining
   - Renewal date
3. Options:
   - "Upgrade" button (if on free tier)
   - "Manage" link (opens system subscription management)

### Secondary Flow: Edit Profile
1. User taps "Profile" row
2. Edit display name
3. View/change email
4. Account deletion option

### Secondary Flow: Get Help
1. User taps "Help Center"
2. Opens FAQ/guides in browser or in-app

### Secondary Flow: Contact Support
1. User taps "Contact Us"
2. Opens email compose with pre-filled support address

## UI Requirements

### Global Layout (Light Mode)
- Background: white
- Section backgrounds: white
- Accent: rose-500
- Text: stone-900 (primary), stone-500 (secondary)

### Grouped List Sections
- Section headers: uppercase, stone-500, small font
- Row backgrounds: white
- Dividers: stone-200
- Chevron indicators for navigation rows

### Account Section
- **Profile row**: User icon, name, email preview, chevron
- **Sign Out**: Red text, no chevron

### Your Voice Section (Optional Feature)
- Promotional card if not enrolled:
  - Rose gradient border
  - "NEW" badge
  - Microphone icon
  - "Make songs sound like you"
  - "Set Up Voice" button
- If enrolled:
  - "Voice Profile" row with:
    - Waveform icon (rose)
    - "Active" status with quality score
    - Checkmark badge
    - Chevron for details

### Subscription Section
- Plan card showing:
  - Plan name (Free / Premium / Pro)
  - Credits: "X songs remaining"
  - Features list
  - "Upgrade" or "Manage" button
- Visual distinction for premium tiers (rose border)

### Support Section
- Help Center row (external link icon)
- Contact Us row (mail icon)
- Privacy Policy row
- Terms of Service row

### App Info Section
- Version row: "Version X.X.X (Build XXX)"
- Debug info (only in debug builds)

### Voice Enrollment Flow (Sheet)
- Full-screen sheet presentation
- **Welcome screen**:
  - Large microphone icon with particles
  - "Your Voice, Your Songs" headline
  - Benefit explanation
  - Consent toggle (required)
  - "Get Started" button (rose gradient)
- **Recording screen**:
  - Progress: "Prompt X of Y"
  - Progress bar
  - Prompt text with "Say:" or "Sing:" prefix
  - Large record button (red when recording)
  - Recording level indicator
- **Processing screen**:
  - Animated waveform
  - "Creating your voice profile..."
  - Progress indicator
- **Completion screen**:
  - Green checkmark with celebration effect
  - "Voice Profile Ready!"
  - Quality score (percentage)
  - "Start Creating" button

## Configuration
- shell: true (displays inside tab bar with navigation)
