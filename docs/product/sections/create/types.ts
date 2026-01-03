// =============================================================================
// Create Section Types
// =============================================================================

export type VoiceModeId = 'ai_voice' | 'your_voice'
export type TabId = 'simple' | 'advanced' | 'your_voice'
export type AdvancedTabId = 'description' | 'lyrics' | 'image'
export type OccasionId = 'birthday' | 'anniversary' | 'thank_you' | 'i_love_you' | 'wedding' | 'graduation' | 'celebration' | 'apology' | 'encouragement' | 'custom'

export interface Tab {
  id: TabId
  label: string
  badge: string | null
}

export interface MusicStyle {
  id: string
  name: string
  icon: string
  description: string
}

export interface Occasion {
  id: OccasionId
  name: string
  emoji: string
}

export interface VoiceMode {
  id: VoiceModeId
  name: string
  description: string
  requiresEnrollment: boolean
  isDefault: boolean
}

export interface AdvancedTab {
  id: AdvancedTabId
  label: string
}

export interface MoodChip {
  id: string
  label: string
}

export interface InputPlaceholders {
  recipientName: string
  memory: string
  nicknames: string
  whatMakesSpecial: string
  customLyrics: string
}

// =============================================================================
// Component Props
// =============================================================================

export interface CreateSectionProps {
  /** Available tabs for mode selection */
  tabs: Tab[]
  /** Music styles for horizontal scroll selector */
  musicStyles: MusicStyle[]
  /** Available occasions */
  occasions: Occasion[]
  /** Voice mode options */
  voiceModes: VoiceMode[]
  /** Advanced mode tabs */
  advancedTabs: AdvancedTab[]
  /** Mood selection chips */
  moodChips: MoodChip[]
  /** Placeholder text for inputs */
  inputPlaceholders: InputPlaceholders
  /** Whether user has voice profile enrolled */
  hasVoiceProfile?: boolean
  /** Current voice profile quality score */
  voiceQualityScore?: number
  /** Called when user submits song creation */
  onCreateSong?: (data: CreateSongData) => void
  /** Called when user wants to enroll voice */
  onEnrollVoice?: () => void
  /** Called when tab changes */
  onTabChange?: (tab: TabId) => void
}

export interface CreateSongData {
  recipientName: string
  occasion: OccasionId
  memory: string
  nicknames?: string
  whatMakesSpecial?: string
  musicStyle: string
  voiceMode: VoiceModeId
  customLyrics?: string
  moods?: string[]
  recipientImage?: string
}
