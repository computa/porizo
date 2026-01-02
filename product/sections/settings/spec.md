# Settings Section Specification

## Overview
User profile management, voice enrollment, and app configuration. The hub for managing your Porizō experience including your voice profile that makes songs sound like you.

## User Flows

### Primary Flow: Voice Enrollment
1. User taps "Voice Profile" row
2. Sheet presents enrollment flow:
   - Welcome screen with consent toggle
   - Recording prompts (6-10 spoken + 1-2 sung phrases)
   - Processing indicator while voice profile is created
   - Completion with quality score
3. Return to Settings with updated voice status

### Secondary Flow: Re-enroll Voice
1. User with existing profile taps "Voice Profile"
2. View current profile status and quality score
3. Option to "Re-record" for better quality
4. New enrollment replaces existing profile

### Secondary Flow: Manage Profile (Future)
1. User taps "Profile" row
2. View/edit display name
3. View/edit email
4. Manage password
5. Delete account option

### Secondary Flow: Notification Preferences (Future)
1. User taps "Notifications" row
2. Toggle push notifications on/off
3. Configure notification types:
   - Song ready alerts
   - Weekly inspiration
   - Special occasion reminders

### Secondary Flow: Get Help
1. User taps "Help Center"
2. Opens in-app browser or Safari
3. Browse FAQs and guides

### Secondary Flow: Contact Support
1. User taps "Contact Us"
2. Opens email compose with support@porizo.com
3. Pre-filled subject line

## UI Requirements

- Navigation title: "Settings"
- Grouped List layout with sections:

### Voice Section
- Voice Profile row with:
  - Waveform icon (accent color)
  - "Voice Profile" title
  - Status subtitle (Loading... / Active with quality % / Not enrolled)
  - Checkmark badge if enrolled
  - Chevron for navigation
- Section footer explaining voice profile purpose

### Account Section
- Profile row (Coming soon indicator)
- Notifications row (Coming soon indicator)

### Support Section
- Help Center link (external)
- Contact Us link (mailto)
- Privacy Policy link (external)
- Terms of Service link (external)

### App Info Section
- Version row showing app version and build number

## Voice Enrollment Sub-flow Requirements
- Full-screen sheet presentation
- Welcome screen:
  - Waveform icon
  - "Let's Set Up Your Voice" title
  - 2-minute time estimate
  - Consent toggle (required to proceed)
  - "Get Started" button
- Recording screen:
  - Progress indicator (Prompt X of Y)
  - Progress bar
  - Prompt text (spoken vs sung indicator)
  - Large record button (red when recording)
  - "Tap to record" / "Tap to stop" label
- Processing screen:
  - Spinner
  - "Creating your voice profile..."
  - Subtitle about expected time
- Completion screen:
  - Checkmark icon (green)
  - "Voice Profile Ready!" message
  - Quality score display
  - "Start Creating" CTA button

## Configuration
- shell: true (displays inside tab bar with navigation)
