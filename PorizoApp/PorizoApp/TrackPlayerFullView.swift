//
//  TrackPlayerFullView.swift
//  PorizoApp
//
//  Full track player screen matching v1.pen "19 - Now Playing" design.
//  Self-contained player with render polling, audio playback, and v1.pen UI.
//  Velvet & Gold design system.
//

import SwiftUI
import AVFoundation

// MARK: - Now Playing View

struct TrackPlayerFullView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let onDone: () -> Void
    let onNewSong: () -> Void
    /// Called when render fails due provider policy and user wants to edit lyrics.
    var onEditLyricsRequested: (([String]) -> Void)? = nil

    // MARK: - Controllers

    @State private var playbackController = PlaybackController()
    @State private var renderController: RenderController

    // MARK: - Track Metadata

    @State private var trackTitle: String = "Your Song"
    @State private var recipientName: String = ""
    @State private var occasion: String = ""
    @State private var shareUrl: String? = nil
    @State private var claimPin: String? = nil

    // Cover image URLs (loaded from track/version via render callbacks)
    @State private var coverImageUrl: String?
    @State private var coverImageSmallUrl: String?
    @State private var coverImageLargeUrl: String?

    // Audio URLs for playback retry
    @State private var previewUrl: String?
    @State private var fullUrl: String?

    // MARK: - Lyrics & UI State

    @State private var lyrics: [RenderController.LyricLine] = []
    @State private var currentLyricIndex: Int = 0
    @State private var isLyricsExpanded: Bool = true

    // Error state
    @State private var showingError = false
    @State private var errorMessage = ""

    // Share state
    @State private var showingShareSheet = false
    @State private var shareController: ShareController?

    // Haptic triggers
    @State private var hapticLightTrigger = false
    @State private var hapticImpactTrigger = false

    // MARK: - Init

    init(
        apiClient: APIClient,
        trackId: String,
        versionNum: Int,
        onDone: @escaping () -> Void,
        onNewSong: @escaping () -> Void,
        onEditLyricsRequested: (([String]) -> Void)? = nil
    ) {
        self.apiClient = apiClient
        self.trackId = trackId
        self.versionNum = versionNum
        self.onDone = onDone
        self.onNewSong = onNewSong
        self.onEditLyricsRequested = onEditLyricsRequested
        self._renderController = State(initialValue: RenderController(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            if case .completed = renderController.renderPhase {
                // Full player UI when render is complete
                playerContent
            } else {
                // Render status overlay while rendering
                renderStatusOverlay
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: hapticLightTrigger)
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticImpactTrigger)
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .sheet(isPresented: $showingShareSheet) {
            SharePostcardView(
                recipientName: recipientName.isEmpty ? "Recipient" : recipientName,
                occasion: occasion.isEmpty ? nil : occasion,
                shareURL: shareUrl,
                claimPIN: claimPin,
                onSend: {
                    guard let urlString = shareUrl,
                          let claimPin,
                          !claimPin.isEmpty else { return }
                    let message = ShareMessageContent.activityMessage(
                        shareURL: urlString,
                        claimPin: claimPin,
                        recipientName: recipientName,
                        occasion: occasion
                    )
                    let activityVC = UIActivityViewController(activityItems: [message], applicationActivities: nil)
                    activityVC.completionWithItemsHandler = { _, completed, _, _ in
                        guard completed else { return }
                        Task { @MainActor in
                            ReviewManager.shared.recordSuccessfulShare()
                        }
                    }
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let root = windowScene.windows.first?.rootViewController {
                        var topVC = root
                        while let presented = topVC.presentedViewController { topVC = presented }
                        activityVC.popoverPresentationController?.sourceView = topVC.view
                        topVC.present(activityVC, animated: true)
                    }
                },
                onSaveToPhotos: {},
                onCopyLink: {
                    if let url = shareUrl {
                        UIPasteboard.general.string = url
                        ToastService.shared.show("Link copied!", type: .success)
                    }
                },
                onSkip: { showingShareSheet = false }
            )
            .task {
                // Fetch share data if not already loaded
                if shareUrl == nil {
                    if let resp = try? await apiClient.getTrack(trackId: trackId) {
                    let track = resp.track
                        shareUrl = track.shareUrl
                        claimPin = track.claimPin
                    }
                }
            }
        }
        .onAppear {
            print("[TrackPlayerFullView] onAppear - starting render for trackId=\(trackId), versionNum=\(versionNum)")
            wireControllerCallbacks()
            renderController.startPreviewRender(trackId: trackId, versionNum: versionNum)
        }
        .onDisappear {
            renderController.cancelAll()
            playbackController.cleanup()
        }
    }

    // MARK: - Controller Wiring

    private func wireControllerCallbacks() {
        // Playback controller metadata
        playbackController.trackTitle = trackTitle
        playbackController.artistName = recipientName

        playbackController.onPlaybackFinished = {
            currentLyricIndex = 0
            // Track successful play for review prompting (emotional high point)
            ReviewManager.shared.recordSuccessfulPlay()
        }

        playbackController.onTimeUpdate = { time in
            updateCurrentLyric(at: time)
        }

        // Render controller: preview completion
        renderController.onPreviewComplete = { result in
            trackTitle = result.trackTitle
            recipientName = result.recipientName
            occasion = result.occasion
            lyrics = result.lyrics
            coverImageUrl = result.coverImageUrl
            coverImageSmallUrl = result.coverImageSmallUrl
            coverImageLargeUrl = result.coverImageLargeUrl
            previewUrl = result.audioURL

            // Update playback controller metadata
            playbackController.trackTitle = result.trackTitle
            playbackController.artistName = result.recipientName

            // Start playback
            playbackController.setupPlayer(url: result.audioURL)
        }

        // Render controller: full render completion
        renderController.onFullRenderComplete = { result in
            fullUrl = result.audioURL
            lyrics = result.lyrics
            coverImageUrl = result.coverImageUrl
            coverImageSmallUrl = result.coverImageSmallUrl
            coverImageLargeUrl = result.coverImageLargeUrl

            // Switch to full audio
            playbackController.switchAudio(url: result.audioURL)
        }
    }

    // MARK: - Player Content (v1.pen "19 - Now Playing")

    private var playerContent: some View {
        VStack(spacing: 0) {
            // Header
            nowPlayingHeader

            // Scrollable content
            ScrollView {
                VStack(spacing: 0) {
                    // Artwork Section
                    artworkSection

                    // Song Info
                    songInfoSection

                    // Progress Bar
                    progressSection

                    // Playback Controls
                    playbackControls

                    // Lyrics Section
                    lyricsSection

                    // Full Render / Reroll buttons
                    actionButtons
                }
            }

            Spacer(minLength: 0)

            // Bottom Toolbar
            bottomToolbar

            // Safe area spacer
            Color.clear.frame(height: 34)
        }
    }

    // MARK: - Header (v1.pen: 56pt height)

    private var nowPlayingHeader: some View {
        HStack {
            // Collapse button (chevron-down)
            Button {
                onDone()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close player")

            Spacer()

            // "Now Playing" label
            Text("Now Playing")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)

            Spacer()

            // New Song button
            Button {
                onNewSong()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Create New Song")
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    // MARK: - Artwork Section (v1.pen: 280x280, centered)

    private var artworkSection: some View {
        VStack {
            // Album art - uses remote cover or gradient fallback
            SongCoverView(
                occasion: occasion.isEmpty ? nil : occasion,
                smallUrl: coverImageSmallUrl,
                largeUrl: coverImageLargeUrl ?? coverImageUrl,
                size: 280
            )
            .shadow(color: Color.black.opacity(0.4), radius: 32, x: 0, y: 8)
        }
        .padding(.vertical, 24)
        .padding(.horizontal, 56)
    }

    // MARK: - Song Info Section (v1.pen: title 22pt, subtitle 15pt)

    private var songInfoSection: some View {
        VStack(spacing: 4) {
            Text(trackTitle)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            let subtitle = formatSubtitle()
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 24)
    }

    private func formatSubtitle() -> String {
        var parts: [String] = []
        if !recipientName.isEmpty {
            parts.append("For \(recipientName)")
        }
        if !occasion.isEmpty {
            parts.append(formatSectionName(occasion))
        }
        return parts.joined(separator: " \u{2022} ")
    }

    // MARK: - Progress Section (v1.pen: 4pt bar, gold fill)

    private var progressSection: some View {
        VStack(spacing: 8) {
            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.border)
                        .frame(height: 4)

                    // Fill
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold)
                        .frame(width: geometry.size.width * playbackController.playbackProgress, height: 4)
                }
            }
            .frame(height: 4)

            // Time labels
            HStack {
                Text(formatTime(playbackController.currentTime))
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)

                Spacer()

                Text(playbackController.duration > 0 ? formatTime(playbackController.duration) : "--:--")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 24)
    }

    // MARK: - Playback Controls (v1.pen: 5-button row)

    private var playbackControls: some View {
        HStack {
            // Shuffle
            Button { } label: {
                Image(systemName: "shuffle")
                    .font(.system(size: 20))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Previous
            Button { } label: {
                Image(systemName: "backward.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Play/Pause (64pt gold circle)
            Button {
                hapticLightTrigger.toggle()
                playbackController.togglePlayPause()
            } label: {
                Image(systemName: playbackController.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(DesignTokens.background)
                    .frame(width: 64, height: 64)
                    .background(DesignTokens.gold)
                    .clipShape(Circle())
            }
            .accessibilityLabel(playbackController.isPlaying ? "Pause" : "Play")

            Spacer()

            // Next
            Button { } label: {
                Image(systemName: "forward.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Repeat
            Button { } label: {
                Image(systemName: "repeat")
                    .font(.system(size: 20))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .frame(width: 44, height: 44)
            }
        }
        .frame(height: 64)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    // MARK: - Lyrics Section (v1.pen: expandable)

    private var lyricsSection: some View {
        VStack(spacing: 12) {
            // Header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isLyricsExpanded.toggle()
                }
            } label: {
                HStack {
                    Text("Lyrics")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    Image(systemName: isLyricsExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
            }

            // Content (when expanded)
            if isLyricsExpanded {
                VStack(spacing: 8) {
                    if lyrics.isEmpty {
                        Text("Lyrics will appear here...")
                            .font(.system(size: 16))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .italic()
                    } else {
                        ForEach(Array(lyrics.enumerated()), id: \.element.id) { index, line in
                            Text(line.text)
                                .font(.system(size: 16))
                                .foregroundStyle(index == currentLyricIndex ? DesignTokens.gold : DesignTokens.textTertiary)
                                .multilineTextAlignment(.center)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(16)
        .padding(.horizontal, 8)
    }

    // MARK: - Action Buttons (Full Render, Reroll)

    private var actionButtons: some View {
        VStack(spacing: 16) {
            // Playback error indicator
            if let error = playbackController.playbackError {
                playbackErrorView(error: error)
            }

            // Full Render button
            fullRenderButton
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private var fullRenderButton: some View {
        switch renderController.fullRenderPhase {
        case .notStarted:
            Button {
                renderController.startFullRender(trackId: trackId, versionNum: versionNum)
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "music.note.list")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Create Full Song")
                            .font(.headline)
                        Text("Included in this song generation")
                            .font(.caption)
                            .opacity(0.9)
                    }
                    Spacer()
                }
                .foregroundStyle(.white)
                .padding()
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 12))
            }

        case .rendering:
            HStack {
                Spacer()
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .scaleEffect(0.8)
                Text("Creating full song...")
                    .font(.headline)
                Spacer()
            }
            .foregroundStyle(.white)
            .padding()
            .background(DesignTokens.gold.opacity(0.7))
            .clipShape(.rect(cornerRadius: 12))

        case .completed:
            HStack {
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                Text("Full Song Ready!")
                Spacer()
            }
            .font(.headline)
            .foregroundStyle(.white)
            .padding()
            .background(DesignTokens.success)
            .clipShape(.rect(cornerRadius: 12))

        case .failed(let error):
            VStack(spacing: 8) {
                HStack {
                    Spacer()
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("Full render failed")
                    Spacer()
                }
                .font(.headline)
                .foregroundStyle(.white)

                Text(error)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))

                Button("Try Again") {
                    renderController.retryFullRender(trackId: trackId, versionNum: versionNum)
                }
                .font(.subheadline)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.2))
                .clipShape(.rect(cornerRadius: 8))
            }
            .padding()
            .background(DesignTokens.warning)
            .clipShape(.rect(cornerRadius: 12))
        }
    }

    private func playbackErrorView(error: String) -> some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.white)
                Text("Playback Error")
                    .font(.headline)
                    .foregroundStyle(.white)
            }

            Text(error)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.8))
                .multilineTextAlignment(.center)

            Button {
                playbackController.retryPlayback()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Retry")
                }
                .font(.subheadline.bold())
                .foregroundStyle(DesignTokens.warning)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(Color.white)
                .clipShape(.rect(cornerRadius: 8))
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(DesignTokens.warning)
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Bottom Toolbar

    private var bottomToolbar: some View {
        HStack {
            Spacer()

            // Share
            Button {
                hapticLightTrigger.toggle()
                showingShareSheet = true
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Share")

            Spacer()
        }
        .frame(height: 56)
        .padding(.horizontal, 48)
    }

    // MARK: - Render Status Overlay

    private var renderStatusOverlay: some View {
        VStack(spacing: 0) {
            // Header for render view
            HStack {
                Button {
                    onDone()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }

                Spacer()

                Text("Creating Song")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textTertiary)

                Spacer()

                Color.clear.frame(width: 44, height: 44)
            }
            .padding(.horizontal, 16)
            .frame(height: 56)

            Spacer()

            // Status content
            renderStatusContent

            Spacer()

            // Done button at bottom
            Button {
                onDone()
            } label: {
                Text("Done")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.surface)
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                    )
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 34)
        }
    }

    @ViewBuilder
    private var renderStatusContent: some View {
        switch renderController.renderPhase {
        case .idle, .rendering:
            VStack(spacing: 24) {
                // Animated progress circle
                ZStack {
                    Circle()
                        .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 8)
                        .frame(width: 160, height: 160)

                    Circle()
                        .trim(from: 0, to: CGFloat(renderController.progress ?? 0) / 100)
                        .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 160, height: 160)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.5), value: renderController.progress)

                    Image(systemName: "waveform")
                        .font(.system(size: 50))
                        .foregroundStyle(DesignTokens.gold)
                }

                Text("Creating Your Song...")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                if let actualProgress = renderController.progress {
                    Text("\(actualProgress)%")
                        .font(.system(size: 36, weight: .light, design: .monospaced))
                        .foregroundStyle(DesignTokens.gold)
                } else {
                    Text("Processing...")
                        .font(.system(size: 24, weight: .light))
                        .foregroundStyle(DesignTokens.gold)
                }

                if let statusMessage = renderController.statusMessage {
                    Text(statusMessage)
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("This may take a minute")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(renderController.progress != nil ? "Creating your song, \(renderController.progress!) percent complete" : "Creating your song, processing")

        case .completed:
            // This should transition to player content automatically
            EmptyView()

        case .failed(let error):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 60))
                    .foregroundStyle(DesignTokens.warning)

                Text("Something went wrong")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                if !renderController.errorDetail.terms.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Flagged terms from provider")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.textSecondary)
                        Text(renderController.errorDetail.terms.joined(separator: ", "))
                            .font(.caption)
                            .foregroundStyle(DesignTokens.warning)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Gentle suggestions")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundStyle(DesignTokens.textSecondary)
                            ForEach(renderController.policySuggestions(), id: \.self) { suggestion in
                                Text("\u{2022} \(suggestion)")
                                    .font(.caption)
                                    .foregroundStyle(DesignTokens.textSecondary)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                }

                if renderController.shouldShowEditLyricsCTA(),
                   let onEditLyricsRequested {
                    Button {
                        onEditLyricsRequested(renderController.errorDetail.terms)
                    } label: {
                        HStack {
                            Image(systemName: "pencil")
                            Text("Edit Lyrics")
                        }
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(DesignTokens.warning)
                        .clipShape(.rect(cornerRadius: 20))
                    }
                }

                Button {
                    renderController.retryPreviewRender(trackId: trackId, versionNum: versionNum)
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Try Again")
                    }
                    .font(.headline)
                    .foregroundStyle(DesignTokens.gold)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.gold.opacity(0.15))
                    .clipShape(.rect(cornerRadius: 20))
                }
            }
        }
    }

    // MARK: - Lyrics Tracking

    private func updateCurrentLyric(at time: Double) {
        // Simple lyric tracking - find the lyric that should be current
        for (index, line) in lyrics.enumerated() {
            if let startTime = line.startTime, startTime > time {
                currentLyricIndex = max(0, index - 1)
                return
            }
        }
        // If no timing info, just show first lyric or cycle through
        if lyrics.isEmpty { return }
        if lyrics.first?.startTime == nil {
            // Estimate based on duration
            let progress = playbackController.duration > 0 ? time / playbackController.duration : 0
            currentLyricIndex = min(Int(progress * Double(lyrics.count)), lyrics.count - 1)
        }
    }
}

#Preview {
    TrackPlayerFullView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        trackId: "test-track-id",
        versionNum: 1,
        onDone: { },
        onNewSong: { }
    )
}
