// Onboarding Types

export interface OnboardingSlide {
  id: string
  headline: string
  subtext: string
  illustration: string
  accentColor: 'rose'
}

export interface OnboardingData {
  slides: OnboardingSlide[]
  skipLabel: string
  continueLabel: string
  getStartedLabel: string
}

export interface OnboardingProps {
  slides: OnboardingSlide[]
  skipLabel?: string
  continueLabel?: string
  getStartedLabel?: string
  onSkip?: () => void
  onComplete?: () => void
  onSlideChange?: (index: number) => void
}
