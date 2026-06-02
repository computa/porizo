/**
 * Porizo Design Tokens for Remotion Videos
 * Mirrors the Velvet & Gold design system from the iOS app.
 */

export const colors = {
  background: '#0A0A0A',
  surface: '#161616',
  surfaceLight: '#1E1E1E',
  gold: '#D4A574',
  goldDark: '#8B7355',
  goldLight: '#E8C9A4',
  textPrimary: '#F5F5F0',
  textSecondary: '#8A8A8A',
  textTertiary: '#666666',
  success: '#7DD3A6',
  border: '#2A2A2A',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const fonts = {
  display: 'Georgia, "Playfair Display", serif',
  body: '-apple-system, "SF Pro", "Helvetica Neue", sans-serif',
} as const;

/** Video 1: Warm amber tones for nostalgia */
export const warmPalette = {
  bg: '#1A0F08',
  accent: '#D4A574',
  warmGlow: '#E8A860',
  softLight: '#FFF8F0',
  shadow: '#0D0805',
} as const;

/** Video 2: Urban night tones for energy */
export const urbanPalette = {
  bg: '#0A0A14',
  accent: '#D4A574',
  neon: '#7B9BFF',
  glow: '#FF6B8A',
  softLight: '#E8E8FF',
} as const;

/** Video 3: Golden hour warmth for nostalgia */
export const goldenPalette = {
  bg: '#140E06',
  accent: '#D4A574',
  sunlight: '#FFD699',
  warmShadow: '#3D2A14',
  softLight: '#FFF5E6',
} as const;

/** Video 1 Sunny: Warm peach & coral for bright romance */
export const sunnyWarmPalette = {
  bg: '#FFF8F0',
  accent: '#E07A4B',
  warmGlow: '#FFB88C',
  softLight: '#FFF0E6',
  text: '#2D1810',
  textSecondary: '#6B4E3D',
  overlay: '#FFFFFF',
} as const;

/** Video 2 Sunny: Sky blue & coral for flirty energy */
export const sunnyUrbanPalette = {
  bg: '#F0F6FF',
  accent: '#FF6B8A',
  neon: '#4A90D9',
  glow: '#FFB347',
  softLight: '#E8F4FF',
  text: '#1A2A3A',
  textSecondary: '#5A6E7F',
  overlay: '#FFFFFF',
} as const;

/** Video 3 Sunny: Golden sunshine for friendship warmth */
export const sunnyGoldenPalette = {
  bg: '#FFF5E6',
  accent: '#E8943A',
  sunlight: '#FFD166',
  warmShadow: '#FFF0D6',
  softLight: '#FFFAF2',
  text: '#2A1F0A',
  textSecondary: '#6B5B3E',
  overlay: '#FFFFFF',
} as const;

/** Standard video dimensions */
export const dimensions = {
  vertical: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

export const FPS = 30;
