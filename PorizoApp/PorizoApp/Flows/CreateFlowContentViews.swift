//
//  CreateFlowContentViews.swift
//  PorizoApp
//
//  Composition views for the downstream create-flow states.
//

import SwiftUI

struct StoryConversationContentView: View {
    let engine: V2StoryEngine
    let apiWrapper: APIClientWrapper
    let creationNoun: String
    let onContinue: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        if engine.isComplete {
            StoryConfirmationView(
                engine: engine,
                creationNoun: creationNoun,
                onContinue: onContinue,
                onEdit: {
                    engine.enterReviewEditMode()
                },
                onClose: onDismiss
            )
        } else {
            AdaptiveConversationView(engine: engine, onClose: onDismiss)
                .environmentObject(apiWrapper)
        }
    }
}

struct CreatingTrackContentView: View {
    let apiClient: APIClient
    let context: StoryContext?
    let voiceMode: VoiceMode
    let onTrackCreated: (String, Int, Lyrics?) -> Void
    let onError: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        if let context {
            CreatingTrackView(
                apiClient: apiClient,
                storyContext: context,
                voiceMode: voiceMode,
                onTrackCreated: onTrackCreated,
                onError: onError,
                onCancel: onCancel
            )
        } else {
            Text("Error: No story context available")
                .foregroundColor(DesignTokens.error)
                .onAppear {
                    onError("Story context was not captured. Please try again.")
                }
        }
    }
}

struct LyricsReviewContentView: View {
    let apiClient: APIClient
    let trackId: String?
    let versionNum: Int?
    let storyId: String?
    let initialLyrics: Lyrics?
    let highlightTerms: [String]
    let onApproved: (String, Int) -> Void
    let onBack: () -> Void
    let onError: (String) -> Void

    var body: some View {
        if let trackId, let versionNum, let storyId {
            LyricsReviewView(
                apiClient: apiClient,
                trackId: trackId,
                versionNum: versionNum,
                storyId: storyId,
                initialLyrics: initialLyrics,
                highlightTerms: highlightTerms,
                onApproved: {
                    onApproved(trackId, versionNum)
                },
                onBack: onBack
            )
        } else {
            Text("Error: Missing story context for lyrics.")
                .foregroundColor(DesignTokens.error)
                .onAppear {
                    onError("Story context was not captured. Please try again.")
                }
        }
    }
}

struct TrackPlayerContentView: View {
    let apiClient: APIClient
    let trackId: String?
    let versionNum: Int?
    let allowedRerollTypes: [RerollType]
    let rerollLimit: Int?
    let rerollsUsed: Int
    let onDone: (String, Int) -> Void
    let onNewSong: () -> Void
    let onRerollComplete: (Int) -> Void
    let onEditLyricsRequested: ([String]) -> Void
    let onRerollUsed: () -> Void

    var body: some View {
        if let trackId, let versionNum {
            let _ = print("[CreateFlowView] Rendering TrackPlayerFullView with trackId=\(trackId), versionNum=\(versionNum)")
            TrackPlayerFullView(
                apiClient: apiClient,
                trackId: trackId,
                versionNum: versionNum,
                onDone: {
                    onDone(trackId, versionNum)
                },
                onNewSong: onNewSong,
                onRerollComplete: onRerollComplete,
                onEditLyricsRequested: onEditLyricsRequested,
                allowedRerollTypes: allowedRerollTypes,
                rerollLimit: rerollLimit,
                rerollsUsed: rerollsUsed,
                onRerollUsed: onRerollUsed
            )
        }
    }
}

struct PoemCreatingContentView: View {
    let apiClient: APIClient
    let storyId: String?
    let storyDraftVersion: Int
    let finalNotes: String?
    let onPoemReady: (Poem) -> Void
    let onNeedsDetails: ([StoryPoemGap], String?) -> Void
    let onError: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        if let storyId {
            PoemCreatingView(
                apiClient: apiClient,
                storyId: storyId,
                storyDraftVersion: storyDraftVersion,
                finalNotes: finalNotes,
                onPoemReady: onPoemReady,
                onNeedsDetails: onNeedsDetails,
                onError: onError,
                onCancel: onCancel
            )
        } else {
            Text("Error: Missing story session.")
                .foregroundColor(DesignTokens.error)
                .onAppear {
                    onError("Story session could not be found. Please try again.")
                }
        }
    }
}

struct PoemGapContentView: View {
    let question: String?
    let onSubmit: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        if let question {
            PoemGapQuestionView(
                question: question,
                onSubmit: onSubmit,
                onCancel: onCancel
            )
        }
    }
}

struct PoemPreviewContentView: View {
    let poem: Poem?
    let apiClient: APIClient
    let onRegenerate: () -> Void
    let onDone: (Poem) -> Void

    var body: some View {
        if let poem {
            PoemPreviewView(
                poem: poem,
                apiClient: apiClient,
                onRegenerate: onRegenerate,
                onDone: {
                    onDone(poem)
                }
            )
        }
    }
}
