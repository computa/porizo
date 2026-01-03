// =============================================================================
// Explore Section Types
// =============================================================================

export type RankBadge = 'gold' | 'silver' | 'bronze'

export interface SectionHeader {
  title: string
  subtitle: string
}

export interface FeaturedSong {
  id: string
  title: string
  creatorName: string
  occasion: string
  style: string
  playCount: number
  coverGradient: [string, string]
  durationSeconds: number
  featured?: boolean
}

export interface RankedSong extends FeaturedSong {
  rank: number
  rankBadge?: RankBadge
}

export interface Occasion {
  id: string
  name: string
  emoji: string
  color: string
  count: number
}

export interface Template {
  id: string
  title: string
  occasion: string
  style: string
  description: string
  coverGradient: [string, string]
  usageCount: number
}

export interface Sections {
  freshHits: SectionHeader
  topSongs: SectionHeader
  popular: SectionHeader
  templates: SectionHeader
}

// =============================================================================
// Component Props
// =============================================================================

export interface ExploreSectionProps {
  /** Section header content */
  sections: Sections
  /** Fresh hits songs list */
  freshHits: FeaturedSong[]
  /** Top ranked songs list */
  topSongs: RankedSong[]
  /** Available occasions */
  occasions: Occasion[]
  /** Template starting points */
  templates: Template[]
  /** Called when user taps "See All" for a section */
  onSeeAll?: (section: keyof Sections) => void
  /** Called when user taps to play a song preview */
  onPlayPreview?: (id: string) => void
  /** Called when user taps "Use Template" */
  onUseTemplate?: (id: string) => void
  /** Called when user taps occasion to browse */
  onSelectOccasion?: (id: string) => void
  /** Called when user taps "Create Similar" */
  onCreateSimilar?: (id: string) => void
}
