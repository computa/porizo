// Splash Screen Types

export interface SplashScreenProps {
  brandName: string
  tagline?: string
  animationDuration: number
  onAnimationComplete?: () => void
}

export interface SplashData {
  brandName: string
  tagline: string
  animationDuration: number
  particleCount: number
  colors: {
    primary: string
    secondary: string
    background: string
  }
}
