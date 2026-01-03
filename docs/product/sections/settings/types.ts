// =============================================================================
// Settings Section Types
// =============================================================================

export type VoiceProfileStatus = 'not_enrolled' | 'enrolling' | 'processing' | 'active'
export type RowType = 'navigation' | 'destructive' | 'external' | 'email' | 'info'
export type SubscriptionTier = 'free' | 'premium' | 'unlimited'

export interface User {
  id: string
  displayName: string
  email: string
  avatarUrl: string | null
  createdAt: string
}

export interface VoiceFeature {
  title: string
  badge: string
  promoCard: {
    headline: string
    subtext: string
    ctaLabel: string
    gradient: [string, string]
  }
}

export interface VoiceProfileState {
  status: VoiceProfileStatus
  qualityScore?: number | null
  message?: string
  progress?: number
  currentPrompt?: number
  totalPrompts?: number
  showPromoCard?: boolean
}

export interface VoiceProfile {
  id: string
  userId: string
  status: VoiceProfileStatus
  qualityScore: number
  createdAt: string
  phrasesRecorded: number
  sungPhrasesRecorded: number
}

export interface SubscriptionTierInfo {
  id: SubscriptionTier
  name: string
  price: number
  creditsIncluded: number
  previewsPerDay: number
  features: string[]
  recommended?: boolean
}

export interface CurrentSubscription {
  tier: SubscriptionTier
  name: string
  creditsRemaining: number
  dailyPreviewsUsed: number
  dailyPreviewsLimit: number
  renewalDate: string | null
}

export interface SettingsRow {
  id: string
  label: string
  icon: string
  type: RowType
  value?: string
}

export interface SettingsSection {
  id: string
  title: string
  badge?: string
  rows: SettingsRow[]
}

export interface SupportLinks {
  helpCenter: string
  contactEmail: string
  privacyPolicy: string
  termsOfService: string
}

// =============================================================================
// Component Props
// =============================================================================

export interface SettingsSectionProps {
  /** Current user info */
  currentUser: User
  /** Voice feature promotion */
  voiceFeature: VoiceFeature
  /** Current voice profile (null if not enrolled) */
  voiceProfile: VoiceProfile | null
  /** Voice profile display state */
  voiceProfileState: VoiceProfileState
  /** Current subscription info */
  currentSubscription: CurrentSubscription
  /** Available subscription tiers */
  subscriptionTiers: SubscriptionTierInfo[]
  /** Settings sections and rows */
  sections: SettingsSection[]
  /** Support and external links */
  supportLinks: SupportLinks
  /** Called when user taps profile row */
  onEditProfile?: () => void
  /** Called when user taps sign out */
  onSignOut?: () => void
  /** Called when user taps voice enrollment */
  onEnrollVoice?: () => void
  /** Called when user taps re-record voice */
  onReEnrollVoice?: () => void
  /** Called when user taps manage subscription */
  onManageSubscription?: () => void
  /** Called when user taps upgrade */
  onUpgrade?: (tier: SubscriptionTier) => void
  /** Called when user taps external link */
  onOpenLink?: (url: string) => void
  /** Called when user taps contact support */
  onContactSupport?: () => void
}
