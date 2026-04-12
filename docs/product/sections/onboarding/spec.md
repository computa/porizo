# Onboarding Specification

## Overview
Three-page slide wizard introducing Porizo's value proposition to new users. Features animated illustrations, engaging copy, and a smooth flow that ends with account creation or sign-in options. Shown only on first app launch.

## User Flows
- User sees slide 1 after splash screen completes
- User can swipe left/right between slides OR tap "Continue" button
- Page indicator dots show current position (3 dots)
- On final slide, "Get Started" button leads to auth options
- Skip option available throughout (goes directly to auth)

## UI Requirements

### Global Layout
- Full-screen light background (white)
- Centered illustration area (top 60% of screen)
- Text content below illustration
- "Continue" / "Get Started" button at bottom
- Page dots indicator above button
- "Skip" link in top-right corner

### Slide 1: Welcome
- Headline: "Create Songs That Sound Like You"
- Subtext: "Turn your special moments into personalized songs with AI-powered music generation"
- Illustration: Floating musical notes, waveform visualization, or singer silhouette with particles

### Slide 2: How It Works
- Headline: "Tell Us Your Story"
- Subtext: "Share who the song is for, the occasion, and your favorite memories. Our AI crafts lyrics just for them."
- Illustration: Speech bubbles, question marks transforming into music notes, or chat interface mockup

### Slide 3: Make It Personal
- Headline: "Your Voice, Your Way"
- Subtext: "Use AI vocals or optionally add your own voice to make songs even more personal"
- Illustration: Star rating, microphone icon with "Optional" badge, sound waves

## Visual Elements
- Light backgrounds (white)
- Coral accent colors on illustrations
- Large, readable typography (system rounded)
- Smooth slide transitions
- Animated illustrations (subtle movement)

## Configuration
- shell: false
