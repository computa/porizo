//
//  CreateFlowView.swift
//  PorizoApp
//
//  Create flow matching v1.pen "07a-e - Create Flow" design.
//  Velvet & Gold design system with progress dots and centered questions.
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
    @State private var currentStoryId: String?
    @State private var initialLyrics: Lyrics?
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""
    @State private var resumeStorySession: V2Session?
    private let flowStore = CreateFlowStore.shared

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
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header (v1.pen design)
                if showsHeader {
                    createFlowHeader
                }

                // Content
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
                                onTrackCreated: { trackId, versionNum, lyrics in
                                    currentTrackId = trackId
                                    currentVersionNum = versionNum
                                    currentStoryId = context.storyId
                                    initialLyrics = lyrics
                                    flowState = .lyricsReview
                                },
                                onError: { error in
                                    errorMessage = error
                                    showError = true
                                }
                            )
                        } else {
                            Text("Error: No story context available")
                                .foregroundColor(DesignTokens.error)
                                .onAppear {
                                    errorMessage = "Story context was not captured. Please try again."
                                    showError = true
                                }
                        }

                    case .lyricsReview:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum, let storyId = currentStoryId {
                            LyricsReviewView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                storyId: storyId,
                                initialLyrics: initialLyrics,
                                onApproved: {
                                    flowState = .trackPlayer
                                },
                                onBack: {
                                    flowState = .storyWizard
                                }
                            )
                        } else {
                            Text("Error: Missing story context for lyrics.")
                                .foregroundColor(DesignTokens.error)
                                .onAppear {
                                    errorMessage = "Story context was not captured. Please try again."
                                    showError = true
                                }
                        }

                    case .trackPlayer:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum {
                            TrackPlayerView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                onDone: {
                                    flowStore.clear()
                                    onComplete(trackId, versionNum)
                                },
                                onNewSong: {
                                    flowStore.clear()
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
                                    flowStore.clear()
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
                                    flowStore.clear()
                                }
                            )
                        }
                    }
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
                flowStore.clear()
            }
        } message: {
            Text(errorMessage)
        }
        .onAppear(perform: initializeFlow)
        .onChange(of: flowState) { _, _ in
            persistResumeState()
        }
        .onChange(of: currentTrackId) { _, _ in
            persistResumeState()
        }
        .onChange(of: currentVersionNum) { _, _ in
            persistResumeState()
        }
        .onChange(of: poemStoryId) { _, _ in
            persistResumeState()
        }
    }

    // MARK: - Show Header Logic

    private var showsHeader: Bool {
        switch flowState {
        case .typeSelection:
            return true
        case .storyWizard, .voiceSelection, .creatingTrack, .lyricsReview, .trackPlayer:
            return false // These views have their own headers
        case .poemCreating, .poemGap, .poemPreview:
            return false
        }
    }

    // MARK: - Header (v1.pen design)

    private var createFlowHeader: some View {
        HStack {
            // Close button (v1.pen: 44x44 circle, #161616 fill)
            Button {
                flowStore.clear()
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

            Spacer()

            // Progress dots (v1.pen: 5 dots, gold for current, gray for pending)
            progressDots(current: 0, total: 5)

            Spacer()

            // Spacer to balance layout
            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    private func progressDots(current: Int, total: Int) -> some View {
        HStack(spacing: 8) {
            ForEach(0..<total, id: \.self) { index in
                Circle()
                    .fill(index <= current ? DesignTokens.gold : Color(hex: "#333333"))
                    .frame(width: 8, height: 8)
            }
        }
    }

    // MARK: - Type Selection (v1.pen style)

    private var typeSelectionView: some View {
        VStack(spacing: 0) {
            Spacer()
                .frame(height: 40)

            // Question (v1.pen: Playfair Display 36pt, center)
            Text("What would you\nlike to create?")
                .font(DesignTokens.displayFont(size: 36))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 24)

            Spacer()
                .frame(height: 48)

            // Options
            VStack(spacing: 16) {
                // Resume session option (if available)
                if let session = resumeStorySession {
                    createOptionCard(
                        icon: "arrow.clockwise",
                        title: "Resume Your Story",
                        subtitle: "Continue with \(session.recipientName)",
                        isSelected: false
                    ) {
                        selectedType = .song
                        flowState = .storyWizard
                    }
                }

                // Song option
                createOptionCard(
                    icon: "music.note",
                    title: "Personalized Song",
                    subtitle: "A custom song created just for them",
                    isSelected: false
                ) {
                    selectedType = .song
                    resumeStorySession = nil
                    flowState = .storyWizard
                }

                // Poem option
                createOptionCard(
                    icon: "text.book.closed",
                    title: "Custom Poem",
                    subtitle: "Heartfelt words crafted for them",
                    isSelected: false
                ) {
                    selectedType = .poem
                    resumeStorySession = nil
                    flowState = .storyWizard
                }
            }
            .padding(.horizontal, 24)

            Spacer()
        }
    }

    // MARK: - Option Card (v1.pen style)

    private func createOptionCard(
        icon: String,
        title: String,
        subtitle: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                // Icon circle
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: icon)
                        .font(.system(size: 24))
                        .foregroundColor(DesignTokens.gold)
                }
                .accessibilityHidden(true)

                // Text content
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text(subtitle)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .background(DesignTokens.surface)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? DesignTokens.gold : DesignTokens.borderSubtle, lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(subtitle)
    }

    // MARK: - Helper Functions

    private func resetPoemState() {
        poemStoryId = nil
        currentPoem = nil
        poemGaps = []
        poemGapQuestion = nil
        flowStore.clear()
    }

    private func initializeFlow() {
        // Resume from draft track
        if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
            currentTrackId = trackId
            currentVersionNum = versionNum
            currentStoryId = flowStore.load()?.storyId
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

        // Resume from persisted create flow (track/poem)
        if let persisted = flowStore.load() {
            switch persisted.kind {
            case .song:
                if let trackId = persisted.trackId, let versionNum = persisted.versionNum {
                    selectedType = .song
                    currentTrackId = trackId
                    currentVersionNum = versionNum
                    currentStoryId = persisted.storyId
                    flowState = .lyricsReview
                }
            case .poem:
                if let storyId = persisted.storyId {
                    selectedType = .poem
                    poemStoryId = storyId
                    flowState = .poemCreating
                }
            }
        }
    }

    private func persistResumeState() {
        switch flowState {
        case .lyricsReview, .trackPlayer, .creatingTrack, .voiceSelection:
            let storyId = storyContext?.storyId ?? currentStoryId
            if let trackId = currentTrackId, let versionNum = currentVersionNum {
                let state = CreateFlowResumeState(
                    kind: .song,
                    step: "\(flowState)",
                    storyId: storyId,
                    trackId: trackId,
                    versionNum: versionNum,
                    updatedAt: Date()
                )
                flowStore.save(state)
            }
        case .poemCreating, .poemGap, .poemPreview:
            if let storyId = poemStoryId {
                let state = CreateFlowResumeState(
                    kind: .poem,
                    step: "\(flowState)",
                    storyId: storyId,
                    trackId: nil,
                    versionNum: nil,
                    updatedAt: Date()
                )
                flowStore.save(state)
            }
        case .typeSelection, .storyWizard:
            break
        }
    }
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
