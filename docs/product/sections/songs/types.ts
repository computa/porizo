// =============================================================================
// Songs Section Types
// =============================================================================

export type SongStatus = 'draft' | 'lyrics_approved' | 'rendering' | 'preview_ready' | 'full_ready' | 'failed'
export type VoiceMode = 'ai_voice' | 'your_voice'

export interface Song {
  id: string
  title: string
  recipientName: string
  occasion: string
  musicStyle: string
  voiceMode: VoiceMode
  status: SongStatus
  createdAt: string
  previewUrl: string | null
  fullUrl: string | null
  durationSeconds: number | null
  lyricsPreview: string | null
  coverGradient: [string, string]
  renderProgress?: number
  errorMessage?: string
}

export interface EmptyState {
  icon: string
  headline: string
  subtext: string
  ctaLabel: string
  banner: {
    headline: string
    subtext: string
    gradient: [string, string]
  }
}

export interface StatusConfig {
  labels: Record<SongStatus, string>
  colors: Record<SongStatus, string>
}

// =============================================================================
// Component Props
// =============================================================================

export interface SongsListProps {
  /** List of songs to display */
  songs: Song[]
  /** Empty state configuration */
  emptyState: EmptyState
  /** Status display labels */
  statusLabels: Record<SongStatus, string>
  /** Status indicator colors */
  statusColors: Record<SongStatus, string>
  /** Currently playing song ID */
  playingSongId?: string | null
  /** Whether audio is currently playing */
  isPlaying?: boolean
  /** Called when user taps play button */
  onPlay?: (id: string) => void
  /** Called when user taps pause button */
  onPause?: () => void
  /** Called when user taps draft to continue */
  onResumeDraft?: (id: string) => void
  /** Called when user taps create new */
  onCreate?: () => void
  /** Called when user taps song card for details */
  onViewDetails?: (id: string) => void
  /** Called when user taps share */
  onShare?: (id: string) => void
  /** Called when user taps retry on failed song */
  onRetry?: (id: string) => void
}
