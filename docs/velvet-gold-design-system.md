# Warm Canvas Design System

**Version:** 2.0
**Last Updated:** April 2026
**Philosophy:** "Opening the path for feelings to reach the ones you love" - warm, intimate, and inviting

**Supersedes:** Velvet & Gold v1.0 (January 2026, dark luxury theme)
**Origin:** YC-style design research (5-agent review) identified that the dark luxury aesthetic repelled the primary gifting audience. Warm Canvas was the recommended palette (Palette A) and is now the canonical design system.

---

## Color Palette

### Core Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#FBF7F2` | Warm parchment, primary canvas |
| `--surface` | `#FFFFFF` | Cards, elevated containers |
| `--surface-muted` | `#F5F0EA` | Subtle banners, separators, tertiary surfaces |
| `--surface-elevated` | `#FFFFFF` | Modals, overlays (with shadow) |
| `--input-background` | `#F8F4EF` | Input field backgrounds |

### Brand Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--coral` / `--primary` | `#E07850` | Terracotta coral - CTAs, accents, brand mark |
| `--coral-text` | `#C06030` | Contrast-safe coral for small body/link text (4.5:1 WCAG AA) |
| `--coral-glow` | `#E0785040` | Coral at 25% - glows, highlights, focus states |
| `--coral-soft` | `#E0785033` | Coral at 20% - subtle backgrounds |
| `--sage` | `#7B8F6B` | Sage green - AI accent, nature tones, secondary accent |
| `--amber` / `--rose-gold` | warm amber | Tertiary accent - secondary highlights |

### Chat Bubble Colors

| Token | Usage |
|-------|-------|
| `--coral-bubble` | User chat bubble background (soft coral) |
| `--sage-bubble` | AI chat bubble background (soft sage) |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#2C2420` | Warm near-black - headings, primary text |
| `--text-secondary` | `#6B6560` | Warm gray - subtitles, labels, metadata |
| `--text-tertiary` | `#9A9490` | Warm light gray - hints, placeholders, disabled |
| `--text-muted` | `#B5B0AA` | Lightest text - disabled states |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | green | Confirmations, completion badges |
| `--success-dark` | darker green | Text-safe success variant |
| `--warning` | orange | Caution states |
| `--error` | red | Errors, destructive actions |
| `--status-info` | blue | Informational badges |
| `--border` | warm light gray | Card borders, dividers |
| `--border-subtle` | lighter warm gray | Input borders, subtle separation |

---

## Typography

### Font Families

| Token | Font | Usage |
|-------|------|-------|
| `--font-display` | **Fraunces** (variable) | Headlines, emotional moments, brand |
| `--font-body` | **SF Pro** (system) | Body content, labels, buttons |

### Type Scale (iOS)

| Style | Font | Size | Weight | Usage |
|-------|------|------|--------|-------|
| Hero | Fraunces | 28pt | regular | Screen titles, hero text |
| Title | Fraunces | 22-24pt | regular | Section headers, emotional headings |
| Display | Fraunces | 14-20pt | regular-semibold | Card titles, decorative text |
| Body | SF Pro | 15-16pt | regular | Primary content, buttons |
| Label | SF Pro | 13-14pt | regular-medium | Labels, metadata |
| Caption | SF Pro | 11-12pt | regular | Timestamps, captions |
| Badge | SF Pro | 10pt | semibold | Status badges |

### Type Scale (Web)

| Style | Font | Size | Weight | Line Height | Usage |
|-------|------|------|--------|-------------|-------|
| Display | Fraunces | 42pt | 400 | 1.1 | Hero headlines |
| Title 1 | Fraunces | 36pt | 400 | 1.2 | Screen titles |
| Title 2 | Fraunces | 28pt | 400 | 1.2 | Section headers |
| Title 3 | Fraunces | 20pt | 400 | 1.3 | Card titles |
| Body | SF Pro / DM Sans | 17pt | 400 | 1.4 | Primary content |
| Body Small | SF Pro / DM Sans | 16pt | 400 | 1.4 | Buttons, inputs |
| Caption | SF Pro / DM Sans | 14pt | 400 | 1.5 | Secondary info |
| Micro | SF Pro / DM Sans | 12-13pt | 400/600 | 1.5 | Timestamps, legal |

### Text Colors by Hierarchy

```
Primary text:   #2C2420 (--text-primary)
Secondary text: #6B6560 (--text-secondary)
Tertiary text:  #9A9490 (--text-tertiary)
Link text:      #C06030 (--coral-text, WCAG AA)
```

---

## Spacing & Layout

### Base Unit
- **4px** base unit for all spacing calculations (multiples of 4)

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `spacing2` | 2pt | Text line spacing, tight gaps |
| `spacing4` | 4pt | Minimal spacing, icon margins |
| `spacing6` | 6pt | Inline label + badge gaps |
| `spacing8` | 8pt | Component internal padding (small) |
| `spacing12` | 12pt | Component internal padding (medium) |
| `spacing16` | 16pt | Item-to-item spacing, standard padding |
| `spacing20` | 20pt | Section padding, horizontal page padding |
| `spacing24` | 24pt | Large spacing between sections |
| `spacing28` | 28pt | Section-to-section spacing |
| `spacing32` | 32pt | Premium card internal padding |

### Screen Padding
- **20px** horizontal padding on all screens

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radiusSmall` | 4px | Small elements, badges, pills |
| `radiusXSmall` | 8px | Artwork thumbnails, small containers |
| `radiusMedium` | 12px | Buttons, standard cards |
| `radiusCTA` | 14px | CTA buttons, full-width action buttons |
| `radiusLarge` | 16px | Large cards, containers |
| `radiusOverlay` | 20px | Overlay cards, album art, NowPlaying |
| `radiusChip` | 22px | Chip buttons, occasion tags |
| `radiusPremium` | 24px | Premium cards (poem detail, featured) |
| `radiusPill` | 25px | Pill buttons (action bar) |
| `radiusCircle` | 999px | Full circle |

---

## Elevation System

Warm-tinted shadows with low opacity on light backgrounds.

| Level | Opacity | Radius | Y-Offset | Usage |
|-------|---------|--------|----------|-------|
| Level 0 | 0 | 0 | 0 | Flat elements, backgrounds |
| Level 1 | 0.06 | 4px | 2px | Small cards, list items |
| Level 2 | 0.10 | 8px | 4px | Standard cards, sections |
| Level 3 | 0.15 | 12px | 6px | Toasts, tooltips |
| Level 4 | 0.20 | 16px | 8px | Modals, dialogs |

Shadow color: `--text-primary` at the specified opacity.

### Accent Shadow (Coral Glow)
```css
box-shadow: 0 4px 12px rgba(224, 120, 80, 0.15);
```
Used on primary CTAs for a warm coral glow effect.

---

## Components

### Primary Button (Coral CTA)

```css
background: #E07850;
color: #FFFFFF;
height: 54px;
border-radius: 14px;
font: SF Pro 16px 600;
```

**States:**
- Default: `#E07850`
- Pressed: darken 5%
- Disabled: 50% opacity
- Glow: `0 4px 12px rgba(224, 120, 80, 0.12)`

### Secondary Button (Surface)

```css
background: #FFFFFF;
color: #2C2420;
border: 0.5px solid var(--border);
height: 54px;
border-radius: 14px;
```

### Chat Bubbles

**User Bubble:**
```css
background: var(--coral-bubble);
color: #2C2420;
border: 0.5px solid rgba(224, 120, 80, 0.15);
border-radius: 16px;
font: SF Pro 15px;
```

**AI Bubble:**
```css
background: var(--sage-bubble);
color: #2C2420;
border: 0.5px solid rgba(123, 143, 107, 0.15);
border-radius: 16px;
font: SF Pro 15px;
```

---

## Brand Mark

The **mic in coral circle** is the core brand element.

```css
/* Brand Mark Container */
background: #E07850;
width: 120px;
height: 120px;
border-radius: 60px;

/* Mic Icon */
icon: mic (white SVG);
size: 48px;
color: #FFFFFF;
```

**Usage:**
- Splash screen (centered, 120px)
- Create button (nav bar, coral filled)
- Loading states (animated pulse)
- App icon

---

## Icons

**Primary Icon Set:** SF Symbols (iOS) / Lucide (Web)

**Icon Sizes:**
- Navigation: 20px
- Status bar: 16-18px
- Feature icons: 24px
- Brand mark: 48px

---

## Animation Guidelines

### Transitions
- **Duration:** 200-300ms
- **Easing:** ease-out for entrances, ease-in for exits

### Coral Glow Pulse
```css
@keyframes coral-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(224, 120, 80, 0.25); }
  50% { box-shadow: 0 0 30px rgba(224, 120, 80, 0.35); }
}
```

### Button Press
```css
transform: scale(0.98);
transition: transform 100ms ease-out;
```

---

## Screen Templates

### Splash Screen
- Full screen `#FBF7F2` warm parchment
- Centered brand mark (mic in coral circle)
- "Porizo" in Fraunces below

### Landing/Hero Screen
- Headline in Fraunces 28pt
- Subhead in SF Pro 17pt `#6B6560`
- Coral accent elements
- Coral CTA button
- "Sign in" link in coral-text

### Creation Flow
- Conversation Garden: organic bubbles, sage AI / coral user
- The Pulse (wait): breathing coral rings on cream
- The Bloom (reveal): radial coral gradient, in-route transformation
- The Postcard (share): coral-to-amber gradient card

---

## Implementation Notes

### SwiftUI (DesignTokens.swift)
```swift
// Colors reference the asset catalog
static let background = Color("Colors/Background")
static let surface = Color("Colors/Surface")
static let gold = Color("Colors/Gold")       // coral accent (legacy name)
static let sage = Color("Colors/Sage")
static let textPrimary = Color("Colors/TextPrimary")

// Display font
static func displayFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
    .custom("Fraunces", size: size).weight(weight)
}

// Body font (system SF Pro with Dynamic Type)
static func bodyFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
    Font(UIFontMetrics(forTextStyle: .body).scaledFont(
        for: UIFont.systemFont(ofSize: size, weight: weight.uiFontWeight)
    ))
}
```

### CSS Variables
```css
:root {
    --background: #FBF7F2;
    --surface: #FFFFFF;
    --coral: #E07850;
    --coral-text: #C06030;
    --coral-glow: rgba(224, 120, 80, 0.25);
    --sage: #7B8F6B;
    --text-primary: #2C2420;
    --text-secondary: #6B6560;
    --border: #E8E2DC;
}
```

---

## Design Principles

1. **Warmth through light** - The light parchment background creates an intimate, inviting canvas
2. **Serif for emotion** - Fraunces (variable, high softness axis) adds organic warmth to headlines
3. **Coral for action** - Coral accent guides the eye to CTAs and brand moments
4. **Sage for guidance** - Sage green marks AI-driven elements (chat bubbles, suggestions)
5. **Warm, not sterile** - Warm whites (#FBF7F2) and warm grays, never pure/cold tones
6. **Trust through light** - Light mode increases trust and cognitive performance for emotional products
7. **The song is the product** - Design energy builds toward the reveal moment, not the creation machinery

---

## Migration from Velvet & Gold

| V1 (Velvet & Gold) | V2 (Warm Canvas) | Reason |
|---------------------|-------------------|--------|
| `#0A0A0A` dark bg | `#FBF7F2` warm parchment | Dark repelled gifting audience |
| `#D4A574` metallic gold | `#E07850` terracotta coral | Warmer, more approachable |
| Playfair Display | Fraunces (variable) | Higher softness axis, more organic |
| Inter / DM Sans body | SF Pro (system) | Native feel, Dynamic Type support |
| `#F5F5F0` warm white text | `#2C2420` warm dark text | Light bg requires dark text |
| Rose gold secondary | Sage green `#7B8F6B` | Nature tones, AI differentiation |
