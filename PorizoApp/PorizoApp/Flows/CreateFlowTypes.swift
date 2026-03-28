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

// MARK: - Presentation Router

/// Single slot for sheets and fullScreenCovers (mutually exclusive).
enum ActiveSheet: Identifiable {
    case upgrade
    case customLyrics
    case voiceEnrollment
    case share(ShareSheetPayload)
    case editLyrics(EditingLyricsSection)
    case speechInput(SpeechInputContext)

    var id: String {
        switch self {
        case .upgrade:          return "upgrade"
        case .customLyrics:     return "customLyrics"
        case .voiceEnrollment:  return "voiceEnrollment"
        case .share:            return "share"
        case .editLyrics:       return "editLyrics"
        case .speechInput:      return "speechInput"
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
}

// MARK: - Card Tab

enum CardTab: String, CaseIterable {
    case elements = "Story Elements"
    case strength = "Story Strength"
}
