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
    var variationSourcePoem: Poem?
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    @State private var flowState: CreateFlowState = .typeSelection
    @State private var selectedType: CreationType?
    @State private var storyContext: StoryContext?
    @State private var poemStoryId: String?
    @State private var currentPoem: Poem?
    @State private var poemGaps: [StoryPoemGap] = []
    @State private var poemGapQuestion: String?
    @State private var selectedVoiceMode: VoiceMode = .aiVoice
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""
    @State private var resumeStorySession: V2Session?

    enum CreateFlowState {
        case typeSelection
        case storyWizard
        case voiceSelection
        case creatingTrack
        case lyricsReview
        case trackPlayer
        case poemCreating
        case poemGap
        case poemPreview
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
                        V2GuidedJourneyCoordinator(
                            apiClient: apiClient,
                            preselectedOccasion: preselectedOccasion,
                            resumeSession: resumeStorySession,
                            creationNoun: selectedType == .poem ? "poem" : "song",
                            onComplete: { context in
                                storyContext = context
                                poemStoryId = context.storyId
                                if selectedType == .poem {
                                    flowState = .poemCreating
                                } else {
                                    flowState = .voiceSelection
                                }
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
                                onError: { error in
                                    errorMessage = error
                                    showError = true
                                }
                            )
                        } else {
                            // StoryContext is nil - show error
                            Text("Error: No story context available")
                                .foregroundColor(DesignTokens.error)
                                .onAppear {
                                    errorMessage = "Story context was not captured. Please try again."
                                    showError = true
                                }
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

                    case .poemCreating:
                        if let storyId = poemStoryId {
                            PoemCreatingView(
                                apiClient: apiClient,
                                storyId: storyId,
                                onPoemReady: { poem in
                                    currentPoem = poem
                                    flowState = .poemPreview
                                },
                                onNeedsDetails: { gaps, question in
                                    poemGaps = gaps
                                    poemGapQuestion = question
                                    flowState = .poemGap
                                },
                                onError: { error in
                                    errorMessage = error
                                    showError = true
                                }
                            )
                        } else {
                            Text("Error: Missing story session.")
                                .foregroundColor(DesignTokens.error)
                                .onAppear {
                                    errorMessage = "Story session could not be found. Please try again."
                                    showError = true
                                }
                        }

                    case .poemGap:
                        if let question = poemGapQuestion, let storyId = poemStoryId {
                            PoemGapQuestionView(
                                question: question,
                                onSubmit: { detail in
                                    Task {
                                        do {
                                            _ = try await apiClient.addStoryDetails(storyId: storyId, detail: detail)
                                            await MainActor.run {
                                                poemGapQuestion = nil
                                                poemGaps = []
                                                flowState = .poemCreating
                                            }
                                        } catch {
                                            await MainActor.run {
                                                errorMessage = error.localizedDescription
                                                showError = true
                                            }
                                        }
                                    }
                                },
                                onCancel: {
                                    resetPoemState()
                                    storyContext = nil
                                    flowState = .typeSelection
                                }
                            )
                        }

                    case .poemPreview:
                        if let poem = currentPoem {
                            PoemPreviewView(
                                poem: poem,
                                onRegenerate: {
                                    flowState = .poemCreating
                                },
                                onDone: {
                                    resetPoemState()
                                    storyContext = nil
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
            .alert("Error", isPresented: $showError) {
                Button("Try Again") {
                    if selectedType == .poem {
                        flowState = .poemCreating
                    } else {
                        flowState = .voiceSelection
                    }
                }
                Button("Start Over") {
                    storyContext = nil
                    resetPoemState()
                    flowState = .typeSelection
                }
            } message: {
                Text(errorMessage)
            }
        }
        .onAppear(perform: initializeFlow)
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
                if let session = resumeStorySession {
                    Button {
                        selectedType = .song
                        flowState = .storyWizard
                    } label: {
                        HStack(spacing: 16) {
                            ZStack {
                                Circle()
                                    .fill(DesignTokens.roseMuted)
                                    .frame(width: 50, height: 50)

                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 22))
                                    .foregroundColor(DesignTokens.rose)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("Resume Your Story")
                                    .font(.headline)
                                    .foregroundColor(DesignTokens.textPrimary)
                                Text("Continue with \(session.recipientName)")
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
                    .accessibilityLabel("Resume your story")
                    .accessibilityHint("Continue the story you were working on.")
                }

                // Song option
                Button {
                    selectedType = .song
                    resumeStorySession = nil
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
                        .accessibilityHidden(true)

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
                            .accessibilityHidden(true)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .subtleShadow()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Personalized Song")
                .accessibilityHint("A custom song created just for them. Double tap to start.")

                // Poem option
                Button {
                    selectedType = .poem
                    resumeStorySession = nil
                    flowState = .storyWizard
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.roseMuted)
                                .frame(width: 60, height: 60)

                            Image(systemName: "text.book.closed")
                                .font(.system(size: 28))
                                .foregroundColor(DesignTokens.rose)
                        }
                        .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Custom Poem")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("Heartfelt words crafted for them")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundColor(DesignTokens.textSecondary)
                            .accessibilityHidden(true)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .subtleShadow()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Custom Poem")
                .accessibilityHint("Heartfelt words crafted for them. Double tap to start.")
            }
            .padding(.horizontal)

            Spacer()
        }
        .navigationTitle("Create")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func resetPoemState() {
        poemStoryId = nil
        currentPoem = nil
        poemGaps = []
        poemGapQuestion = nil
    }

    /// Determines the initial flow state based on resume parameters
    private func initializeFlow() {
        // Resume from draft track
        if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
            currentTrackId = trackId
            currentVersionNum = versionNum
            flowState = .lyricsReview
            return
        }

        // Create poem variation - pre-fill with source poem's context
        if let sourcePoem = variationSourcePoem {
            selectedType = .poem
            resumeStorySession = V2Session(
                recipientName: sourcePoem.recipientName,
                occasion: sourcePoem.occasion
            )
            flowState = .storyWizard
            return
        }

        // Preselected occasion from Explore tab
        if preselectedOccasion != nil {
            selectedType = .song
            flowState = .storyWizard
            return
        }

        // Check for stored incomplete session
        if resumeStorySession == nil,
           let stored = V2SessionStore.shared.load(),
           stored.storyId != nil,
           stored.isComplete == false {
            resumeStorySession = stored
        }
    }
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
