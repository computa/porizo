//
//  CreateFlowTypes.swift
//  PorizoApp
//
//  Shared types for the unified creation flow, extracted to module scope
//  so they can be referenced by inline cards, tests, and other views
//  without qualifying through UnifiedCreateFlowView.
//

import SwiftUI

// MARK: - Phase Model

/// Coarse phase for top-level routing (persisted for resume)
enum UnifiedPhase {
    case typeSelection // Song vs Poem picker
    case setup         // Resume/variation bootstrap only
    case chat          // Main phase -- inline cards accumulate here
    // Poem phases (unchanged, still full-screen)
    case poemCreating
    case poemGap
    case poemPreview
}

/// Song lifecycle within .chat phase (drives inline card visibility + resume)
enum SongProgress: String, Codable {
    case conversing       // Story chat active
    case confirmed        // Story confirmed, voice selection pending
    case voiceSelected    // Voice chosen, track creation pending/active
    case trackCreated     // Track + lyrics exist, lyrics review active
    case lyricsApproved   // Legacy preview render active
    case previewReady     // Legacy-only preview rendered, player showing
    case fullRenderActive // Full render in progress
    case fullRenderReady  // Full song rendered
}

// MARK: - Warm Canvas Flow (Four Moments)

/// Top-level moment in the Warm Canvas redesign flow.
/// Tell stays mounted; Wait/Reveal/Share overlay on top.
enum WarmCanvasMoment: Equatable {
    case tell(TellSubPhase)
    case wait
    case reveal
    case share
}

/// Sub-phases within the Tell moment.
enum TellSubPhase: Equatable {
    case nameEntry       // Inline name prompt before conversation starts
    case conversing      // V2StoryEngine chat active
    case poemGapQuestion // Poem generation requested one more detail
    case confirmed       // Story confirmed, voice selection pending
    case voiceSelected   // Voice chosen, track creation in progress
    case trackCreated    // Lyrics review active
}

// MARK: - Warm Canvas Error Overlays

/// Error states rendered as full-screen overlays in WarmCanvasFlowView.
/// Each case maps to a FlowErrorViews view with recovery callbacks.
enum WarmCanvasError: Equatable {
    case connectionError                     // TellConnectionErrorView
    case moderationError                     // TellModerationErrorView
    case waitTimeout                         // WaitTimeoutErrorView
    case waitFailure(recipientName: String)  // WaitFailureErrorView
    case revealPartial                       // RevealPartialErrorView
    case shareFailure                        // ShareFailureView
    case noCredits                           // NoCreditsView
}

// MARK: - Presentation Router

/// Single slot for sheets and fullScreenCovers (mutually exclusive).
enum ActiveSheet: Identifiable {
    case upgrade
    case customLyrics
    case voiceEnrollment
    case share(ShareSheetPayload)
    case editLyrics(EditingLyricsSection)
    case speechInput(SpeechInputContext)
    case lyricsReview

    var id: String {
        switch self {
        case .upgrade:          return "upgrade"
        case .customLyrics:     return "customLyrics"
        case .voiceEnrollment:  return "voiceEnrollment"
        case .share:            return "share"
        case .editLyrics:       return "editLyrics"
        case .speechInput:      return "speechInput"
        case .lyricsReview:     return "lyricsReview"
        }
    }
}

/// Single slot for alerts and confirmation dialogs (mutually exclusive,
/// but can coexist with an active sheet).
enum ActiveAlert: Identifiable {
    case error(String)
    case genreRequired
    case doneWarning(DoneWarningKind)
    case discardLyricsEdits
    case staleResume

    var id: String {
        switch self {
        case .error:              return "error"
        case .genreRequired:      return "genreRequired"
        case .doneWarning:        return "doneWarning"
        case .discardLyricsEdits: return "discardLyricsEdits"
        case .staleResume:        return "staleResume"
        }
    }
}

// MARK: - Supporting Types

struct EditingLyricsSection: Identifiable {
    let id: Int
}

enum DoneWarningKind: String, Identifiable {
    case previewOnly
    case fullRenderInProgress
    var id: String { rawValue }
}

struct ShareSheetPayload: Identifiable {
    let id = UUID()
    let controller: ShareController
    let trackId: String
    let versionNum: Int
    let trackTitle: String
    let recipientName: String
    var shareUrl: String? = nil
    var claimPin: String? = nil
}

// MARK: - Card Tab

enum CardTab: String, CaseIterable {
    case elements = "Story Elements"
    case strength = "Story Strength"
}
