//
//  CreateFlowView.swift
//  PorizoApp
//
//  Create flow for songs and poems with step-by-step wizard.
//  Extracted from MainTabView for better modularity.
//

import SwiftUI

// MARK: - Create Flow View

struct CreateFlowView: View {
    let apiClient: APIClient
    var preselectedOccasion: Occasion?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    @State private var flowState: CreateFlowState = .typeSelection
    @State private var selectedType: CreationType?
    @State private var storyContext: StoryContext?
    @State private var selectedVoiceMode: VoiceMode = .aiVoice
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    enum CreateFlowState {
        case typeSelection
        case storyWizard
        case voiceSelection
        case creatingTrack
        case lyricsReview
        case trackPlayer
    }

    enum CreationType {
        case song
        case poem
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                Group {
                    switch flowState {
                    case .typeSelection:
                        typeSelectionView

                    case .storyWizard:
                        NewStoryWizardView(
                            apiClient: apiClient,
                            onComplete: { context in
                                storyContext = context
                                flowState = .voiceSelection
                            },
                            onCancel: {
                                flowState = .typeSelection
                            }
                        )

                    case .voiceSelection:
                        VoiceModeSelectionView(
                            apiClient: apiClient,
                            onSelect: { mode in
                                selectedVoiceMode = mode
                                flowState = .creatingTrack
                            },
                            onBack: {
                                flowState = .storyWizard
                            }
                        )

                    case .creatingTrack:
                        if let context = storyContext {
                            CreatingTrackView(
                                apiClient: apiClient,
                                storyContext: context,
                                voiceMode: selectedVoiceMode,
                                onTrackCreated: { trackId, versionNum in
                                    currentTrackId = trackId
                                    currentVersionNum = versionNum
                                    flowState = .lyricsReview
                                },
                                onError: { _ in
                                    // Handle error
                                    flowState = .typeSelection
                                }
                            )
                        }

                    case .lyricsReview:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum {
                            LyricsReviewView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                onApproved: {
                                    flowState = .trackPlayer
                                },
                                onBack: {
                                    flowState = .storyWizard
                                }
                            )
                        }

                    case .trackPlayer:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum {
                            TrackPlayerView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                onDone: {
                                    onComplete(trackId, versionNum)
                                },
                                onNewSong: {
                                    flowState = .typeSelection
                                }
                            )
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if flowState == .typeSelection {
                        Button("Cancel") {
                            onCancel()
                        }
                        .foregroundColor(DesignTokens.rose)
                    }
                }
            }
        }
        .onAppear {
            // Handle resume flow from draft
            if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
                currentTrackId = trackId
                currentVersionNum = versionNum
                flowState = .lyricsReview
            }
            // Handle preselected occasion from Explore
            else if preselectedOccasion != nil {
                selectedType = .song
                flowState = .storyWizard
            }
        }
    }

    private var typeSelectionView: some View {
        VStack(spacing: 32) {
            // Header
            VStack(spacing: 8) {
                Text("What would you like to create?")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)
                Text("Express your feelings through music or words")
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.top, 40)

            // Options
            VStack(spacing: 16) {
                // Song option
                Button {
                    selectedType = .song
                    flowState = .storyWizard
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.roseMuted)
                                .frame(width: 60, height: 60)

                            Image(systemName: "music.note")
                                .font(.system(size: 28))
                                .foregroundColor(DesignTokens.rose)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Personalized Song")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("A custom song created just for them")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .subtleShadow()
                }
                .buttonStyle(.plain)

                // Poem option
                Button {
                    // TODO: Implement poem flow
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.backgroundSubtle)
                                .frame(width: 60, height: 60)

                            Image(systemName: "text.book.closed")
                                .font(.system(size: 28))
                                .foregroundColor(DesignTokens.textTertiary)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Custom Poem")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("Heartfelt words crafted for them")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Text("Coming Soon")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(DesignTokens.backgroundSubtle)
                            .cornerRadius(8)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .elevation(.level0)
                    .opacity(0.6)
                }
                .buttonStyle(.plain)
                .disabled(true)
            }
            .padding(.horizontal)

            Spacer()
        }
        .navigationTitle("Create")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
