# Velvet & Gold Design System

**Version:** 1.0
**Last Updated:** January 2026
**Philosophy:** "Your voice, their song" - a luxury gift-crafting atelier experience

---

## Color Palette

### Core Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#0A0A0A` | Deep velvet black, primary canvas |
| `--surface` | `#161616` | Elevated cards, inputs, secondary surfaces |
| `--surface-muted` | `#1C1C1C` | Subtle separators, tertiary surfaces |

### Brand Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` / `--gold` | `#D4A574` | Warm gold - CTAs, accents, brand mark |
| `--primary-soft` / `--gold-glow` | `#D4A57433` | Gold at 20% - glows, highlights, focus states |
| `--secondary` / `--rose-gold` | `#E8B4B8` | Rose gold - secondary accents |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--foreground` | `#F5F5F0` | Warm white (not pure) - primary text |
| `--muted-foreground` | `#8A8A8A` | Muted text - secondary labels |
| `--text-muted` | `#666666` | Tertiary text - timestamps, hints |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#7DD3A6` | Soft green - confirmations |
| `--error` | `#E57373` | Warm red - errors, destructive |
| `--border` | `#2A2A2A` | Subtle borders |

---

## Typography

### Font Families

| Token | Font | Usage |
|-------|------|-------|
| `--font-display` | Playfair Display | Headlines, emotional moments, brand |
| `--font-primary` | SF Pro Display / Inter | Titles, labels, buttons |
| `--font-secondary` | SF Pro Text / Inter | Body content, descriptions |

### Type Scale

| Style | Font | Size | Weight | Line Height | Usage |
|-------|------|------|--------|-------------|-------|
| Display | Playfair Display | 42pt | 400 | 1.1 | Hero headlines |
| Title 1 | Playfair Display | 36pt | 400 | 1.2 | Screen titles |
| Title 2 | Playfair Display | 28pt | 400 | 1.2 | Section headers |
| Title 3 | Playfair Display | 20pt | 400 | 1.3 | Card titles, nav headers |
| Body | Inter | 17pt | 400 | 1.4 | Primary content |
| Body Small | Inter | 16pt | 400 | 1.4 | Buttons, inputs |
| Caption | Inter | 14pt | 400 | 1.5 | Secondary info, labels |
| Micro | Inter | 12-13pt | 400/600 | 1.5 | Timestamps, legal text |

### Text Colors by Hierarchy

```
Primary text:   #F5F5F0 (--foreground)
Secondary text: #8A8A8A (--muted-foreground)
Tertiary text:  #666666 (--text-muted)
Link text:      #D4A574 (--gold)
```

---

## Spacing & Layout

### Base Unit
- **8px** base unit for all spacing calculations

### Screen Padding
- **24px** horizontal padding on all screens

### Component Spacing

| Context | Value |
|---------|-------|
| Section gap | 32-40px |
| Card padding | 20-24px |
| Component gap | 12-16px |
| Button padding | 10px vertical, 16px horizontal |
| Input padding | 8px vertical, 16px horizontal |

### Layout Patterns

```
Screen structure:
├── Status Bar (47px)
├── Header (56px)
└── Content (fill, padding: 24px)
    ├── Title Section
    ├── Spacer (flexible)
    └── Actions
```

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-button` | 28px | Pill buttons (full radius) |
| `--radius-card` | 16px | Cards, modals |
| `--radius-input` | 12px | Inputs, social buttons |
| `--radius-chip` | 8px | Tags, chips, small elements |

---

## Components

### Primary Button (Gold CTA)

```css
background: #D4A574;
color: #0A0A0A;
height: 56px;
border-radius: 28px;
font: Inter 16px 600;
```

**States:**
- Default: `#D4A574`
- Pressed: `#C49464` (darken 5%)
- Disabled: `#D4A57450` (50% opacity)

### Secondary Button (Surface)

```css
background: #161616;
color: #F5F5F0;
border: 1px solid #2A2A2A;
height: 56px;
border-radius: 12px;
```

### Back Button

```css
background: #161616;
width: 44px;
height: 44px;
border-radius: 22px;
icon: arrow-left, 20px, #FFFFFF;
```

### Input Field

```css
background: transparent;
color: #F5F5F0;
font: Inter 32px 300;
caret-color: #D4A574;
```

### Numpad Key

```css
background: #2A2A2A;
height: 52px;
border-radius: 8px;
color: #FFFFFF;
font: Inter 24px 400;
```

---

## Brand Mark

The **mic in rose-gold circle** is the core brand element.

```css
/* Brand Mark Container */
background: #D4A574;
width: 120px;
height: 120px;
border-radius: 60px;

/* Mic Icon */
icon: lucide/mic;
size: 48px;
color: #FFFFFF;
```

**Usage:**
- Splash screen (centered, 120px)
- Create button (nav bar, 56px)
- Loading states (animated pulse)
- App icon

---

## Shadows & Effects

### Gold Glow (Focus/Active States)

```css
box-shadow: 0 0 20px #D4A57440;
```

### Card Shadow

```css
box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
```

### Overlay

```css
background: #00000099; /* 60% black */
```

---

## Icons

**Primary Icon Set:** Lucide

**Common Icons:**
- `mic` - Voice/recording
- `arrow-left` - Back navigation
- `phone` - Phone auth
- `check-circle` - Success state
- `x` - Close/clear
- `chevron-down` - Dropdowns

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

### Gold Glow Pulse
```css
@keyframes gold-pulse {
  0%, 100% { box-shadow: 0 0 20px #D4A57440; }
  50% { box-shadow: 0 0 30px #D4A57460; }
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
- Full screen `#0A0A0A`
- Centered brand mark (mic in gold circle)
- "porizo" in Playfair Display below

### Landing/Hero Screen
- Headline in Playfair Display 42pt
- Subhead in Inter 17pt `#8A8A8A`
- Gold waveform illustration
- Gold CTA button
- "Sign in" link in gold

### Auth Flow Screens
- Header with Playfair Display 20pt
- Content centered vertically
- Gold confirm/action buttons
- Surface-colored numpad

---

## Implementation Notes

### SwiftUI Color Extension
```swift
extension Color {
    static let background = Color(hex: "0A0A0A")
    static let surface = Color(hex: "161616")
    static let gold = Color(hex: "D4A574")
    static let roseGold = Color(hex: "E8B4B8")
    static let warmWhite = Color(hex: "F5F5F0")
    static let mutedText = Color(hex: "8A8A8A")
}
```

### CSS Variables
```css
:root {
    --background: #0A0A0A;
    --surface: #161616;
    --gold: #D4A574;
    --gold-glow: #D4A57440;
    --rose-gold: #E8B4B8;
    --foreground: #F5F5F0;
    --muted: #8A8A8A;
    --border: #2A2A2A;
}
```

---

## Design Principles

1. **Luxury through restraint** - Use gold sparingly for maximum impact
2. **Serif for emotion** - Playfair Display for headlines creates warmth
3. **Deep velvet foundation** - The dark background makes gold elements glow
4. **Warm, not cold** - Use warm whites (#F5F5F0) not pure white (#FFFFFF)
5. **Purposeful accents** - Every gold element should guide the user's eye to important actions
