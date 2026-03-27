//
//  SongInlineCardsView.swift
//  PorizoApp
//
//  Extracted from UnifiedCreateFlowView — the scrollable inline cards
//  region inside chatPhase. Contains: type chips, occasion picker,
//  pre-session prompt, song options, chat messages, confirmation card,
//  voice selection, creating/lyrics/rendering/player cards.
//
//  Owns @State for expandedPhases and userHasScrolledUp (parent never
//  reads these). Contains the ScrollViewReader, scroll-driving onChange
//  modifiers, and the DragGesture for scroll back-off detection.
//

import SwiftUI

// MARK: - Callbacks Bundle

struct SongInlineCardsCallbacks {
    let onTypeSelected: (CreateFlowKind) -> Void
    let onOccasionSelected: (Occasion) -> Void
    let onSongOptionsContinue: () -> Void
    let onSongOptionsOwnLyrics: () -> Void
    let onSongOptionsInstrumental: () -> Void
    let onSuggestionChipTapped: (String) -> Void
    let onConfirmEditMode: () -> Void
    let onVoiceSelected: (VoiceMode, VoiceGender?) -> Void
    let onMyVoiceRequested: () -> Void
    let onLyricsApproved: () -> Void
    let onRegenerateLyrics: () -> Void
    let onEditLyricsSection: (Int) -> Void
    let onRenderRetry: () -> Void
    let onEditLyricsFromRender: ([String]) -> Void
    let onGetFullSong: () -> Void
    let onShare: () -> Void
    let onReroll: () -> Void
    let onDone: () -> Void
}

// MARK: - View

struct SongInlineCardsView: View {

    // Display state (let — parent values, child renders)
    let selectedType: CreateFlowKind?
    let songProgress: SongProgress
    let storyEngine: V2StoryEngine
    let showOccasionPicker: Bool
    let showSongOptionsCard: Bool
    let preSessionPrompt: String?
    let lyricsController: LyricsReviewController?
    let createdLyrics: Lyrics?
    let trackCreationController: TrackCreationController
    let renderController: RenderController
    let playbackController: PlaybackController
    let trackTitle: String
    let recipientName: String
    let coverImageUrl: String?
    let isRerolling: Bool
    let allowsLegacyPreviewContinuation: Bool
    let isStartingFullRender: Bool
    let shareController: ShareController?
    let currentTrackId: String?
    let currentVersionNum: Int?
    let styleName: String
    let renderPolicyTerms: [String]
    let myVoiceEnabled: Bool
    let didStartConversation: Bool
    let storyId: String?

    // Callbacks
    let callbacks: SongInlineCardsCallbacks

    // Owned state (never leaves this view)
    @State private var expandedPhases: Set<String> = []
    @State private var userHasScrolledUp = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 4) {
                    // 0a. Type selection (before type is chosen)
                    if selectedType == nil && didStartConversation && storyId == nil {
                        TypeSelectionChips(
                            onSelectSong: { callbacks.onTypeSelected(.song) },
                            onSelectPoem: { callbacks.onTypeSelected(.poem) }
                        )
                        .id("type-chips")
                    }

                    if showOccasionPicker && selectedType != nil && storyId == nil {
                        OccasionPickerCard(
                            onSelect: { occasion in
                                callbacks.onOccasionSelected(occasion)
                            }
                        )
                        .id("occasion-picker")
                    }

                    // 0b. Pre-session story question (after type chosen, before session)
                    if let prompt = preSessionPrompt, selectedType != nil, storyId == nil {
                        chatBubbleFromText(prompt)
                            .id("pre-session-prompt")
                    }

                    // Song options card (before session starts)
                    if showSongOptionsCard && selectedType == .song && storyId == nil {
                        SongOptionsCard(
                            onContinue: { callbacks.onSongOptionsContinue() },
                            onOwnLyrics: { callbacks.onSongOptionsOwnLyrics() },
                            onInstrumental: { callbacks.onSongOptionsInstrumental() }
                        )
                        .id("song-options")
                    }

                    // 1. Chat messages
                    ForEach(storyEngine.messages) { msg in
                        chatBubble(msg)
                            .id(msg.id)
                    }

                    // 2. Loading indicator
                    if storyEngine.isLoading {
                        loadingIndicator
                    }

                    // 3. Confirmation card (story complete, not yet created)
                    if storyEngine.isComplete && songProgress == .conversing {
                        ConfirmationCardView(
                            recipientName: recipientName,
                            narrative: storyEngine.draft.displayNarrative,
                            onEnterEditMode: { callbacks.onConfirmEditMode() }
                        )
                        .id("confirmation")
                    }

                    // -- Transition: Confirmation -> Voice --
                    if songProgress == .confirmed {
                        PhaseTransitionDivider(icon: "mic.fill", label: "Voice")
                    }

                    // 4. Voice selection chips
                    if songProgress == .confirmed {
                        VoiceSelectionChips(
                            onSelect: { mode, gender in
                                callbacks.onVoiceSelected(mode, gender)
                            },
                            onMyVoice: {
                                callbacks.onMyVoiceRequested()
                            },
                            showMyVoice: myVoiceEnabled
                        )
                        .id("voice-chips")
                    }

                    // 5. Track creation progress
                    if songProgress == .voiceSelected {
                        InlineCreatingCard(
                            progress: trackCreationController.progress,
                            statusMessage: trackCreationController.isCreating
                                ? trackCreationController.statusMessage
                                : "Setting up your song..."
                        )
                        .id("creating")
                    }

                    // -- Transition: Creating -> Lyrics --
                    if lyricsController?.lyrics ?? createdLyrics != nil {
                        PhaseTransitionDivider(icon: "music.note.list")
                    }

                    // 6. Lyrics card — collapses to summary once user moves past lyrics review
                    if let lyrics = lyricsController?.lyrics ?? createdLyrics {
                        let lyricsCompleted = songProgress != .trackCreated
                        let lyricsExpanded = expandedPhases.contains("lyrics")

                        if lyricsCompleted && !lyricsExpanded {
                            CollapsedCardSummary(
                                icon: "music.note.list",
                                label: "Lyrics",
                                detail: "\(lyrics.sections.count) sections approved",
                                onToggle: { expandedPhases.insert("lyrics") }
                            )
                            .padding(.horizontal, 4)
                            .id("lyrics")
                        } else {
                            InlineLyricsCard(
                                lyrics: lyrics,
                                controller: lyricsController,
                                isInteractive: songProgress == .trackCreated,
                                style: styleName,
                                highlightTerms: renderPolicyTerms,
                                onApproved: { callbacks.onLyricsApproved() },
                                onRegenerateLyrics: { callbacks.onRegenerateLyrics() },
                                onEditSection: { index in
                                    callbacks.onEditLyricsSection(index)
                                }
                            )
                            .id("lyrics")

                            // Show collapse button when expanded and past lyrics phase
                            if lyricsCompleted && lyricsExpanded {
                                Button {
                                    expandedPhases.remove("lyrics")
                                } label: {
                                    Text("Collapse")
                                        .font(DesignTokens.bodyFont(size: 12))
                                        .foregroundStyle(DesignTokens.textTertiary)
                                }
                                .padding(.top, 4)
                            }
                        }
                    }

                    // -- Transition: Lyrics -> Rendering --
                    if renderController.isRendering || isFailed(renderController) {
                        PhaseTransitionDivider(icon: "waveform", label: "Rendering")
                    }

                    // 7. Rendering progress or failure
                    if renderController.isRendering || isFailed(renderController) {
                        InlineRenderingCard(
                            renderController: renderController,
                            isFullRender: songProgress == .fullRenderActive,
                            onRetry: { callbacks.onRenderRetry() },
                            onEditLyrics: { terms in
                                callbacks.onEditLyricsFromRender(terms)
                            }
                        )
                        .id("rendering")
                    }

                    // -- Transition: Rendering -> Player --
                    if shouldShowPlayerCard {
                        PhaseTransitionDivider(icon: "play.circle.fill", topPadding: 24, bottomPadding: 12)
                    }

                    // 8. Player card (preview or full)
                    if shouldShowPlayerCard {
                        InlinePlayerCard(
                            playbackController: playbackController,
                            trackTitle: trackTitle,
                            recipientName: recipientName,
                            displayMode: playerDisplayMode,
                            coverImageUrl: coverImageUrl,
                            isRerolling: isRerolling,
                            onGetFullSong: { callbacks.onGetFullSong() },
                            onShare: { callbacks.onShare() },
                            onReroll: { callbacks.onReroll() },
                            onDone: { callbacks.onDone() }
                        )
                        .id("player")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 200)
            }
            .onChange(of: storyEngine.messages.count) { _, _ in
                guard !userHasScrolledUp else { return }
                if let lastMsg = storyEngine.messages.last {
                    withAnimation {
                        proxy.scrollTo(lastMsg.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: songProgress) { _, newValue in
                // Reset back-off on major transitions — user wants to see new content
                userHasScrolledUp = false

                let scrollTarget: String? = switch newValue {
                case .confirmed: "voice-chips"
                case .voiceSelected: "creating"
                case .trackCreated: "lyrics"
                case .lyricsApproved, .fullRenderActive: "rendering"
                case .previewReady, .fullRenderReady: "player"
                default: nil
                }
                if let target = scrollTarget {
                    withAnimation {
                        proxy.scrollTo(target, anchor: .top)
                    }
                }
            }
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        // User dragging down (scrolling up to read history)
                        if value.translation.height > 20 {
                            userHasScrolledUp = true
                        }
                        // User dragging up to bottom — reset back-off
                        if value.translation.height < -40 {
                            userHasScrolledUp = false
                        }
                    }
            )
        }
    }

    // MARK: - Player Computed Properties

    private var playerDisplayMode: InlinePlayerCard.PlayerDisplayMode {
        if songProgress == .previewReady {
            return .preview
        } else if isStartingFullRender || songProgress == .fullRenderActive {
            return .fullRenderInProgress
        } else if songProgress == .fullRenderReady {
            return .fullSong
        } else {
            return .preview
        }
    }

    private var shouldShowPlayerCard: Bool {
        switch songProgress {
        case .previewReady, .fullRenderReady:
            return true
        case .fullRenderActive:
            return allowsLegacyPreviewContinuation
        default:
            return false
        }
    }

    // MARK: - Helpers

    private func isFailed(_ controller: RenderController) -> Bool {
        if case .failed = controller.renderPhase { return true }
        if case .failed = controller.fullRenderPhase { return true }
        return false
    }

    /// Renders text as an AI-style bubble for pre-session content.
    private func chatBubbleFromText(_ text: String) -> some View {
        Text(text)
            .aiBubbleStyle()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }

    // MARK: - Chat Bubble

    private func chatBubble(_ msg: V2Message) -> some View {
        VStack(alignment: msg.role == .user ? .trailing : .leading, spacing: 4) {
            HStack {
                if msg.role == .user { Spacer(minLength: 60) }

                if msg.role == .user {
                    Text(msg.content).userBubbleStyle()
                } else {
                    Text(msg.content).aiBubbleStyle()
                }

                if msg.role == .ai { Spacer(minLength: 50) }
            }

            // Suggestion chips (if AI message has them)
            if msg.role == .ai, let suggestions = msg.suggestions, !suggestions.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button {
                                callbacks.onSuggestionChipTapped(suggestion)
                            } label: {
                                Text(suggestion)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .boldChipStyle()
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: msg.role == .user ? .trailing : .leading)
        .padding(.vertical, 4)
    }

    // MARK: - Loading Indicator

    private var loadingIndicator: some View {
        TypingIndicator()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }
}
