# Porizo Web Design Memory

> Canonical reference for porizo.co design system.
> Last updated: 2026-04-16 (Variant B product showcase rollout)

## Brand Tone
- **Adjectives:** warm, premium, intimate, trustworthy, editorial
- **Avoid:** cold SaaS slickness, template-like abstractness, brochure-style
- **Feel:** a thoughtful gift, not a product demo

## Typography
- **Display:** Fraunces (variable font, opsz 9–144, weights 400/500/600)
  - Use `opsz 144` for large headlines, `opsz 72` for body-adjacent usage
- **Body:** DM Sans (400/500)
- **Letter-spacing:** `-0.02em` on display, default on body
- **Line-height:** `1.05` for headlines, `1.6` for body, `1.35` for large quotes

### Critical: Google Fonts URL
Each variable-axis font variant needs the FULL axis spec. `opsz,wght@9..144,400;500` is **invalid** (returns 400 HTML → ORB-blocked). Use:
```
opsz,wght@9..144,400;9..144,500;9..144,600
```

## Color
- **Warm parchment bg:** `#FBF7F2` (primary), `#F5EFE6` (bg-2), `#F0E8DB` (bg-3)
- **Surface:** `#FFFFFF`
- **Ink scale:** `#1A1410` (ink), `#3A302A` (ink-2), `#6B6560` (ink-3 — AA-safe body text)
- **Brand gold:** `#E07850` (base), `#E8926E` (light), `#B85A35` (deep)
- **Hairlines:** `rgba(26,20,16,0.08)` subtle, `rgba(26,20,16,0.14)` strong

### WCAG gotcha
The old `--muted` (`#9A9490`) fails AA at 2.81:1 on the warm bg. Use `--ink-3` (`#6B6560`, 5.39:1) for body text, subtitles, footer links, nav links. `--muted` is aliased to `--ink-3` now but prefer the new name.

## Spacing — 4pt Grid
`--s-1` (4), `--s-2` (8), `--s-3` (12), `--s-4` (16), `--s-5` (24), `--s-6` (32), `--s-7` (48), `--s-8` (64), `--s-9` (96), `--s-10` (128)

## Radius
`--r-xs` (6), `--r-sm` (10), `--r-md` (14), `--r-lg` (20), `--r-xl` (28), `--r-pill` (999)

## Motion
- **Ease:** `cubic-bezier(0.16, 1, 0.3, 1)` — strong ease-out settle
- **Durations:** 160ms (fast), 320ms (medium), 560ms (slow)
- **Scroll-reveal:** 800ms with y translate
- **Ticker cycle:** 10s loop, 4 dwell phases at 25% each
- **Always honor `prefers-reduced-motion: reduce`**

## Core Components
- `.nav` with `.nav__logo::before` (gold gradient dot), `.nav__cta` pill
- `.hero-b` 60/40 grid with `.ticker-wrap > .ticker-inner > .ticker-item` rotation
- `.phone` mockup (320×640, black with notch, inner `.phone__screen` with bg parchment)
- `.sample-chip` pills with `.active` black state + gold dot
- `.step-card` with icon tile + gold hover border
- `.testimonial--featured` with avatar gradient
- 4-column `.footer__inner` grid (brand + 3 link columns)

## Critical UX Rules
1. **Ticker logic:** the constant (outcome) stays; the variable (input) rotates. "Turn [event] into a song." — song is constant, event rotates.
2. **No dead CTA real estate:** App Store badge only. Coming-soon Android promises belong in footer, not hero.
3. **AA contrast:** never use `--muted` (#9A9490) on body copy. Use `--ink-3`.
4. **Sample switcher:** any interactive demo of songs must let users switch recipient/occasion — passive demos feel like ads.

## Routes
- `/` — home (Variant B hero)
- `/pricing`, `/about`, `/support`, `/blog` — secondary (shared nav/footer)
- `/legal/terms`, `/legal/privacy` — minimal shell, content-only
- `/download` — App Store redirect (external)

## Deploy
- **Platform:** Railway
- **Flow:** `git push origin version3` then `railway up --detach`
- **Verify live:** `curl https://porizo.co/` + AXI browser check
