# Porizo Design System -- Velvet & Gold

Dark-mode-only luxurious aesthetic. Warm gold accents on deep velvet black. Colors sourced from v1.pen Penpot design file, implemented in `DesignTokens.swift`.

## Brand

- **Name:** Velvet & Gold
- **Aesthetic:** Luxurious dark theme with warm gold accents, rose gold secondary
- **Constraint:** Dark-mode only (enforced at `WindowGroup` level). No light-theme tokens exist.

## Color Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#0A0A0A` | Primary background, full-screen |
| `surface` | `#161616` | Cards, elevated containers |
| `surfaceMuted` | `#1A1A1A` | Banners, separators |
| `surfaceElevated` | `#1E1E1E` | Elevated surfaces |
| `inputBackground` | `#2E2E2E` | Input fields |
| `textPrimary` | `#F5F5F0` | Headings, primary text (warm white) |
| `textSecondary` | `#8A8A8A` | Labels, metadata |
| `textTertiary` | `#666666` | Hints, placeholders |
| `textMuted` | `#B3B3B3` | Disabled states |
| `gold` | `#D4A574` | Primary accent, CTAs, highlights |
| `goldDark` | `#8B7355` | Gradients, pressed states |
| `goldGlow` | `#D4A574` @ 25% | Glow effects |
| `goldSoft` | `#D4A574` @ 20% | Soft backgrounds |
| `focusRing` | `#D4A574` @ 50% | Focus indicators |
| `roseGold` | `#E8B4B8` | Secondary accent |
| `border` | `#2A2A2A` | Card borders, dividers |
| `borderSubtle` | `#333333` | Input borders |
| `borderLight` | `#E5E5E0` | Light separators |
| `success` | `#7DD3A6` | Success states |
| `warning` | `#FF8400` | Warning states |
| `error` | `#EF4444` | Error states |
| `statusSuccess` | `#4ADE80` | "Ready"/"Complete" badges |
| `statusInfo` | `#60A5FA` | "Lyrics Ready" badges |

## Typography

| Use Case | Font | Size | Weight | Token Call |
|----------|------|------|--------|------------|
| Screen title | Playfair Display | 28pt | regular | `displayFont(size: 28)` |
| Hero text | Playfair Display | 22-24pt | regular | `displayFont(size: 22)` |
| Section header | SF Pro | 16pt | semibold | `bodyFont(size: 16, weight: .semibold)` |
| Body | SF Pro | 15pt | regular | `bodyFont(size: 15)` |
| Metadata | SF Pro | 13pt | regular | `bodyFont(size: 13)` |
| CTA button | SF Pro | 16pt | semibold | `bodyFont(size: 16, weight: .semibold)` |
| Caption | SF Pro | 11-12pt | regular | `bodyFont(size: 11)` |
| Badge | SF Pro | 10pt | semibold | `bodyFont(size: 10, weight: .semibold)` |

Playfair Display (variable font, family name `"Playfair"`) for display/editorial. SF Pro (system) for all UI text. Both support Dynamic Type via `relativeTo:`.

## Spacing Scale

All multiples of 2. Standard page padding is `spacing20` (20pt).

| Token | Value | Usage |
|-------|-------|-------|
| `spacing2` | 2pt | Line spacing, tight gaps |
| `spacing4` | 4pt | Icon margins |
| `spacing6` | 6pt | Label + badge inline gaps |
| `spacing8` | 8pt | Small internal padding |
| `spacing12` | 12pt | Medium internal padding, list item spacing |
| `spacing16` | 16pt | Standard padding, item-to-item |
| `spacing20` | 20pt | Page horizontal padding |
| `spacing24` | 24pt | Section-to-section spacing |
| `spacing28` | 28pt | Large section spacing |
| `spacing32` | 32pt | Premium card internal padding |

## Corner Radii

| Token | Value | Usage |
|-------|-------|-------|
| `radiusSmall` | 4pt | Badges, pills |
| `radiusXSmall` | 8pt | Thumbnails, small containers |
| `radiusMedium` | 12pt | Buttons, standard cards |
| `radiusCTA` | 14pt | CTA buttons, full-width actions |
| `radiusLarge` | 16pt | Large cards, containers |
| `radiusOverlay` | 20pt | Album art, NowPlaying overlay |
| `radiusChip` | 22pt | Chip buttons, occasion tags |
| `radiusPremium` | 24pt | Poem detail, featured cards |
| `radiusPill` | 25pt | Action bar pill buttons |
| `radiusCircle` | 999pt | Full circle |

## Elevation

Dark-theme-optimized shadows using `Color.black` at varying opacity.

| Level | Opacity | Radius | Y Offset | Usage |
|-------|---------|--------|----------|-------|
| `level0` | 0 | 0 | 0 | Flat elements |
| `level1` | 0.20 | 4pt | 2pt | List items (`.subtleShadow()`) |
| `level2` | 0.30 | 8pt | 4pt | Cards (`.cardShadow()`) |
| `level3` | 0.40 | 12pt | 6pt | Toasts, tooltips (`.raisedShadow()`) |
| `level4` | 0.50 | 16pt | 8pt | Modals, dialogs |

Accent shadow: `.accentShadow()` -- gold @ 40% opacity, 12pt radius, 4pt Y. Gold glow for CTAs: `.goldGlow()` -- gold @ 40%, 12pt radius.

## Component Inventory

**Velvet family** (full-width, decorated):
`VelvetButton`, `VelvetCard`, `VelvetHeader`, `VelvetTextField`, `VelvetIconButton`

**Compact family** (dense, list-optimized):
`CompactCard`, `CompactChip`, `CompactChipScroll`, `CompactCardList`, `CompactSectionHeader`, `CompactSettingsRow`

**Inline cards** (creation flow):
`CreatingCard`, `LyricsCard`, `RenderingCard`, `PlayerCard`, `CollapsedCardSummary`

**Chat bubbles** (create flow):
`.userBubbleStyle()` -- gold bg, black text, 16pt radius
`.aiBubbleStyle()` -- `#1E1812` bg, warm stroke, 16pt radius

**Chips:**
`.boldChipStyle()` -- gold border, warm shadow, capsule shape

**Decorative:**
`.goldBorderOverlay()` -- gradient stroke (0.7/0.3/0.7 opacity), 38pt radius, 1.5pt width

**Utilities:**
`PromptBubble`, `PhaseTransitionDivider`, `SongProgressIndicator`

## Component Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `artworkSize` | 56pt | Song card thumbnails |
| `iconButtonSize` | 40pt | Standard icon buttons |
| `buttonHeightLarge` | 54pt | Large buttons |
| `buttonHeightMedium` | 44pt | Medium buttons, settings rows |
| `tabBarHeight` | 83pt | Tab bar |
| `headerHeight` | 56pt | Navigation header |

## Cross-Surface Brand Rules

| Surface | Gold | Display Font | UI Font | Background |
|---------|------|-------------|---------|------------|
| iOS app | `#D4A574` | Playfair Display | SF Pro | `#0A0A0A` |
| Web player | `#D4A574` | Playfair Display | DM Sans | `#0A0A0A` |
| Landing page | `#D4A574` | Playfair Display | DM Sans | `#0A0A0A` |

## Constraints

- Dark-mode only -- enforced at `WindowGroup` level with `.preferredColorScheme(.dark)`
- No light-theme tokens defined
- `prefers-reduced-motion` supported on web surfaces
- All custom fonts use `relativeTo:` for Dynamic Type accessibility
