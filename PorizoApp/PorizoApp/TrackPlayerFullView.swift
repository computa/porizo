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

// MARK: - Polling Configuration

private enum TrackPlayerPollingConfig {
    /// Exponential backoff intervals: 1s, 2s, 5s, 10s, 30s (max)
    static let backoffIntervalsNs: [UInt64] = [
        1_000_000_000,   // 1s
        2_000_000_000,   // 2s
        5_000_000_000,   // 5s
        10_000_000_000,  // 10s
        30_000_000_000   // 30s (max)
    ]

    /// Maximum duration for preview render polling (5 minutes)
    static let previewMaxDurationNs: UInt64 = 5 * 60 * 1_000_000_000

    /// Maximum duration for full render polling (6 minutes)
    static let fullRenderMaxDurationNs: UInt64 = 6 * 60 * 1_000_000_000

    /// Interval threshold for backoff calculation (10 seconds in ns)
    static let backoffThresholdNs: UInt64 = 10_000_000_000

    /// Calculate the appropriate backoff interval index based on elapsed time
    static func backoffIndex(elapsed: UInt64) -> Int {
        min(Int(elapsed / backoffThresholdNs), backoffIntervalsNs.count - 1)
    }
}

// MARK: - Now Playing View

struct TrackPlayerFullView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let onDone: () -> Void
    let onNewSong: () -> Void
    /// Called when reroll creates a new version - navigate to that version
    var onRerollComplete: ((Int) -> Void)?

    // Track metadata
    @State private var trackTitle: String = "Your Song"
    @State private var recipientName: String = ""
    @State private var occasion: String = ""

    // Render state
    @State private var renderStatus: RenderStatus = .idle
    @State private var jobId: String?
    @State private var previewUrl: String?
    @State private var progress: Int? = nil
    @State private var renderStepMessage: String? = nil

    // Full render state
    @State private var fullRenderStatus: FullRenderStatus = .notStarted
    @State private var fullUrl: String?
    @State private var creditsLoadState: CreditsLoadState = .loading
    @State private var showingCreditConfirmation = false
    @State private var fullRenderJobId: String?

    // Cover image URLs (loaded from track/version)
    @State private var coverImageUrl: String?
    @State private var coverImageSmallUrl: String?
    @State private var coverImageLargeUrl: String?

    // Reroll state
    @State private var isRerolling = false
    @State private var rerollTask: Task<Void, Never>?

    // Credits fetch task
    @State private var creditsTask: Task<Void, Never>?

    // Playback state
    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var playbackProgress: Double = 0
    @State private var playbackTime: Double = 0
    @State private var duration: Double = 0

    // Lyrics state
    @State private var lyrics: [LyricLine] = []
    @State private var currentLyricIndex: Int = 0
    @State private var isLyricsExpanded: Bool = true

    // Error state
    @State private var showingError = false
    @State private var errorMessage = ""

    // Share state
    @State private var showingShareSheet = false

    // Observer tokens for proper cleanup
    @State private var playbackEndObserver: NSObjectProtocol?
    @State private var timeObserverToken: Any?
    @State private var playerItemStatusObserver: NSKeyValueObservation?

    // Playback failure retry state
    @State private var playbackError: String?
    @State private var lastRetryTime: Date?
    @State private var retryAttemptCount: Int = 0
    private let minRetryIntervalSeconds: Double = 2.0

    // Task references for proper cancellation
    @State private var renderTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?
    @State private var fullRenderTask: Task<Void, Never>?

    // Polling error tracking
    @State private var pollingFailureCount = 0
    @State private var pollingError: String?
    private let maxPollingFailures = 3

    enum RenderStatus {
        case idle
        case rendering
        case completed
        case failed(String)
    }

    enum FullRenderStatus {
        case notStarted
        case rendering
        case completed
        case failed(String)
    }

    enum CreditsLoadState {
        case loading
        case loaded(Int)
        case error(String)

        var balance: Int {
            if case .loaded(let value) = self { return value }
            return 0
        }

        var isLoaded: Bool {
            if case .loaded = self { return true }
            return false
        }
    }

    // Simple lyric line model
    struct LyricLine: Identifiable {
        let id = UUID()
        let text: String
        let startTime: Double? // seconds
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            if case .completed = renderStatus {
                // Full player UI when render is complete
                playerContent
            } else {
                // Render status overlay while rendering
                renderStatusOverlay
            }
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .alert("Get Full Song", isPresented: $showingCreditConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Use 1 Credit") {
                startFullRender()
            }
        } message: {
            Text("This will use 1 credit. You have \(creditsLoadState.balance) credits.\n\nYou'll get the full 60-second song with higher quality audio.")
        }
        .sheet(isPresented: $showingShareSheet) {
            ShareSheetView(
                apiClient: apiClient,
                trackId: trackId,
                versionNum: versionNum,
                trackTitle: trackTitle,
                recipientName: recipientName
            )
        }
        .onAppear {
            print("[TrackPlayerFullView] onAppear - starting render for trackId=\(trackId), versionNum=\(versionNum)")
            startRender()
            fetchCredits()
            resetRetryState()
        }
        .onDisappear {
            renderTask?.cancel()
            pollingTask?.cancel()
            fullRenderTask?.cancel()
            rerollTask?.cancel()
            creditsTask?.cancel()
            stopPlayback()
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
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

            Spacer()

            // "Now Playing" label
            Text("Now Playing")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)

            Spacer()

            // Menu button (ellipsis)
            Menu {
                Button {
                    performReroll(type: .lyrics)
                } label: {
                    Label("New Lyrics", systemImage: "text.quote")
                }

                Button {
                    performReroll(type: .beat)
                } label: {
                    Label("New Beat", systemImage: "waveform")
                }

                Button {
                    performReroll(type: .vocals)
                } label: {
                    Label("New Vocals", systemImage: "music.mic")
                }

                Divider()

                Button {
                    onNewSong()
                } label: {
                    Label("Create New Song", systemImage: "plus")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
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
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            let subtitle = formatSubtitle()
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundColor(DesignTokens.textTertiary)
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
                        .fill(Color(hex: "#2A2A2A"))
                        .frame(height: 4)

                    // Fill
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold)
                        .frame(width: geometry.size.width * playbackProgress, height: 4)
                }
            }
            .frame(height: 4)

            // Time labels
            HStack {
                Text(formatTime(playbackTime))
                    .font(.system(size: 12))
                    .foregroundColor(DesignTokens.textTertiary)

                Spacer()

                Text(duration > 0 ? formatTime(duration) : "--:--")
                    .font(.system(size: 12))
                    .foregroundColor(DesignTokens.textTertiary)
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
                    .foregroundColor(DesignTokens.textTertiary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Previous
            Button { } label: {
                Image(systemName: "backward.fill")
                    .font(.system(size: 28))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Play/Pause (64pt gold circle)
            Button {
                #if os(iOS)
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
                #endif
                togglePlayback()
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28))
                    .foregroundColor(DesignTokens.background)
                    .frame(width: 64, height: 64)
                    .background(DesignTokens.gold)
                    .clipShape(Circle())
            }
            .accessibilityLabel(isPlaying ? "Pause" : "Play")

            Spacer()

            // Next
            Button { } label: {
                Image(systemName: "forward.fill")
                    .font(.system(size: 28))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            // Repeat
            Button { } label: {
                Image(systemName: "repeat")
                    .font(.system(size: 20))
                    .foregroundColor(DesignTokens.textTertiary)
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
                        .foregroundColor(DesignTokens.textPrimary)

                    Spacer()

                    Image(systemName: isLyricsExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }

            // Content (when expanded)
            if isLyricsExpanded {
                VStack(spacing: 8) {
                    if lyrics.isEmpty {
                        Text("Lyrics will appear here...")
                            .font(.system(size: 16))
                            .foregroundColor(DesignTokens.textTertiary)
                            .italic()
                    } else {
                        ForEach(Array(lyrics.enumerated()), id: \.element.id) { index, line in
                            Text(line.text)
                                .font(.system(size: 16))
                                .foregroundColor(index == currentLyricIndex ? DesignTokens.gold : DesignTokens.textTertiary)
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
            if let error = playbackError {
                playbackErrorView(error: error)
            }

            // Full Render button
            fullRenderButton

            // Rerolling indicator
            if isRerolling {
                HStack {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                        .scaleEffect(0.8)
                    Text("Creating new version...")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(DesignTokens.gold.opacity(0.15))
                .cornerRadius(12)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private var fullRenderButton: some View {
        switch fullRenderStatus {
        case .notStarted:
            Button {
                switch creditsLoadState {
                case .loaded(let balance) where balance > 0:
                    showingCreditConfirmation = true
                case .loaded:
                    errorMessage = "You need credits to get the full song. Get more credits in Settings."
                    showingError = true
                case .error:
                    fetchCredits()
                case .loading:
                    break
                }
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "music.note.list")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Get Full Song")
                            .font(.headline)
                        creditsStatusText
                    }
                    Spacer()
                }
                .foregroundColor(.white)
                .padding()
                .background(creditsLoadState.balance > 0 ? DesignTokens.gold : DesignTokens.textTertiary)
                .cornerRadius(12)
            }
            .disabled(!creditsLoadState.isLoaded || creditsLoadState.balance == 0)

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
            .foregroundColor(.white)
            .padding()
            .background(DesignTokens.gold.opacity(0.7))
            .cornerRadius(12)

        case .completed:
            HStack {
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                Text("Full Song Ready!")
                Spacer()
            }
            .font(.headline)
            .foregroundColor(.white)
            .padding()
            .background(DesignTokens.success)
            .cornerRadius(12)

        case .failed(let error):
            VStack(spacing: 8) {
                HStack {
                    Spacer()
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("Full render failed")
                    Spacer()
                }
                .font(.headline)
                .foregroundColor(.white)

                Text(error)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))

                Button("Try Again") {
                    startFullRender()
                }
                .font(.subheadline)
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.2))
                .cornerRadius(8)
            }
            .padding()
            .background(DesignTokens.warning)
            .cornerRadius(12)
        }
    }

    @ViewBuilder
    private var creditsStatusText: some View {
        switch creditsLoadState {
        case .loading:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.6)
                    .tint(.white)
                Text("Loading credits...")
            }
            .font(.caption)
            .opacity(0.9)
        case .loaded(let balance):
            Text("\(balance) credits available")
                .font(.caption)
                .opacity(0.9)
        case .error:
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.triangle")
                Text("Tap to retry")
            }
            .font(.caption)
            .opacity(0.9)
        }
    }

    private func playbackErrorView(error: String) -> some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.white)
                Text("Playback Error")
                    .font(.headline)
                    .foregroundColor(.white)
            }

            Text(error)
                .font(.caption)
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)

            Button {
                retryPlayback()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Retry")
                }
                .font(.subheadline.bold())
                .foregroundColor(DesignTokens.warning)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .background(Color.white)
                .cornerRadius(8)
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(DesignTokens.warning)
        .cornerRadius(12)
    }

    // MARK: - Bottom Toolbar

    private var bottomToolbar: some View {
        HStack {
            Spacer()

            // Share
            Button {
                #if os(iOS)
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
                #endif
                showingShareSheet = true
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 22))
                    .foregroundColor(DesignTokens.textPrimary)
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
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }

                Spacer()

                Text("Creating Song")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.textTertiary)

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
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.surface)
                    .cornerRadius(12)
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
        switch renderStatus {
        case .idle, .rendering:
            VStack(spacing: 24) {
                // Animated progress circle
                ZStack {
                    Circle()
                        .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 8)
                        .frame(width: 160, height: 160)

                    Circle()
                        .trim(from: 0, to: CGFloat(progress ?? 0) / 100)
                        .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 160, height: 160)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.5), value: progress)

                    Image(systemName: "waveform")
                        .font(.system(size: 50))
                        .foregroundColor(DesignTokens.gold)
                }

                Text("Creating Your Song...")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                if let actualProgress = progress {
                    Text("\(actualProgress)%")
                        .font(.system(size: 36, weight: .light, design: .monospaced))
                        .foregroundColor(DesignTokens.gold)
                } else {
                    Text("Processing...")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(DesignTokens.gold)
                }

                if let renderStepMessage {
                    Text(renderStepMessage)
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("This may take a minute")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(progress != nil ? "Creating your song, \(progress!) percent complete" : "Creating your song, processing")

        case .completed:
            // This should transition to player content automatically
            EmptyView()

        case .failed(let error):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(DesignTokens.warning)

                Text("Something went wrong")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Text(error)
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    startRender()
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Try Again")
                    }
                    .font(.headline)
                    .foregroundColor(DesignTokens.gold)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.gold.opacity(0.15))
                    .cornerRadius(20)
                }
            }
        }
    }

    // MARK: - Render Actions

    private func startRender() {
        print("[TrackPlayerFullView] startRender() called")
        renderStatus = .rendering
        progress = nil
        renderStepMessage = nil
        pollingFailureCount = 0
        pollingError = nil

        renderTask = Task {
            do {
                print("[TrackPlayerFullView] Checking for existing render...")
                if await resumeExistingRender() {
                    print("[TrackPlayerFullView] Resumed existing render")
                    return
                }
                print("[TrackPlayerFullView] No existing render, calling renderPreview API...")
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderPreview") {
                    try await self.apiClient.renderPreview(
                        trackId: self.trackId,
                        versionNum: self.versionNum
                    )
                }
                print("[TrackPlayerFullView] renderPreview response: jobId=\(response.jobId ?? "nil")")

                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.jobId = jobId
                    await pollForCompletion(jobId: jobId)
                } else {
                    _ = await checkTrackStatus()
                }

            } catch {
                print("[TrackPlayerFullView] renderPreview failed: \(error.localizedDescription)")
                guard !Task.isCancelled else { return }
                if await resumeExistingRender() {
                    return
                }
                await MainActor.run {
                    renderStatus = .failed(error.localizedDescription)
                }
            }
        }
    }

    private func resumeExistingRender() async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resumeExistingRender") { [self] in
                try await apiClient.getTrack(trackId: trackId)
            }

            await MainActor.run {
                self.trackTitle = response.track.title
                self.recipientName = response.track.recipientName ?? ""
                self.occasion = response.track.occasion ?? ""
                // Load cover URLs from track
                self.coverImageUrl = response.track.coverImageUrl
                self.coverImageSmallUrl = response.track.coverImageSmallUrl
                self.coverImageLargeUrl = response.track.coverImageLargeUrl
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                // Load lyrics if available
                if let lyricsJson = version.lyricsJson {
                    await MainActor.run {
                        self.lyrics = parseLyrics(from: lyricsJson)
                    }
                }

                // Load cover URLs from version if track doesn't have them
                if version.coverImageUrl != nil || version.coverImageSmallUrl != nil || version.coverImageLargeUrl != nil {
                    await MainActor.run {
                        self.coverImageUrl = version.coverImageUrl ?? self.coverImageUrl
                        self.coverImageSmallUrl = version.coverImageSmallUrl ?? self.coverImageSmallUrl
                        self.coverImageLargeUrl = version.coverImageLargeUrl ?? self.coverImageLargeUrl
                    }
                }

                if let url = version.previewUrl ?? version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    await MainActor.run {
                        self.previewUrl = transformedUrl
                        self.progress = 100
                        self.renderStatus = .completed
                        setupPlayer(url: transformedUrl)
                        fetchCredits()
                    }
                    return true
                }
                if let existingJobId = version.previewJobId {
                    self.jobId = existingJobId
                    await pollForCompletion(jobId: existingJobId)
                    return true
                }
            }
        } catch {
            print("[NowPlayingView] Resume existing render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func parseLyrics(from lyricsData: Lyrics?) -> [LyricLine] {
        guard let lyrics = lyricsData else { return [] }

        var lines: [LyricLine] = []

        // Extract lines from each section
        for section in lyrics.sections {
            for line in section.lines {
                // Skip empty lines
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    lines.append(LyricLine(text: trimmed, startTime: nil))
                }
            }
        }

        return lines
    }

    private func pollForCompletion(jobId: String) async {
        var elapsed: UInt64 = 0

        while elapsed < TrackPlayerPollingConfig.previewMaxDurationNs {
            guard !Task.isCancelled else { return }

            let intervalIndex = TrackPlayerPollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = TrackPlayerPollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "pollJobStatus") {
                    try await self.apiClient.getJobStatus(jobId: jobId)
                }

                await MainActor.run {
                    self.progress = status.progress
                    self.renderStepMessage = renderMessage(for: status)
                    self.pollingFailureCount = 0
                }

                switch status.status {
                case "completed":
                    _ = await checkTrackStatus()
                    return

                case "failed":
                    await MainActor.run {
                        renderStatus = .failed(status.errorMessage ?? "Render failed")
                    }
                    return

                default:
                    continue
                }

            } catch {
                guard !Task.isCancelled else { return }

                await MainActor.run {
                    pollingFailureCount += 1
                }

                if pollingFailureCount >= maxPollingFailures {
                    if await checkTrackStatus(setFailureOnMissing: false) {
                        return
                    }

                    await MainActor.run {
                        pollingError = "Unable to check status. Please check your connection."
                        renderStatus = .failed("Connection error after \(maxPollingFailures) attempts")
                    }
                    return
                }

                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            }
        }

        guard !Task.isCancelled else { return }
        if await checkTrackStatus(setFailureOnMissing: false) {
            return
        }
        await MainActor.run {
            renderStatus = .failed("Render timed out. Please try again.")
        }
    }

    private func checkTrackStatus(setFailureOnMissing: Bool = true) async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkTrackStatus") {
                try await self.apiClient.getTrack(trackId: self.trackId)
            }

            await MainActor.run {
                self.trackTitle = response.track.title
                self.recipientName = response.track.recipientName ?? ""
                self.occasion = response.track.occasion ?? ""
                // Load cover URLs from track
                self.coverImageUrl = response.track.coverImageUrl
                self.coverImageSmallUrl = response.track.coverImageSmallUrl
                self.coverImageLargeUrl = response.track.coverImageLargeUrl
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                // Load lyrics
                if let lyricsJson = version.lyricsJson {
                    await MainActor.run {
                        self.lyrics = parseLyrics(from: lyricsJson)
                    }
                }

                // Load cover URLs from version if available
                if version.coverImageUrl != nil || version.coverImageSmallUrl != nil || version.coverImageLargeUrl != nil {
                    await MainActor.run {
                        self.coverImageUrl = version.coverImageUrl ?? self.coverImageUrl
                        self.coverImageSmallUrl = version.coverImageSmallUrl ?? self.coverImageSmallUrl
                        self.coverImageLargeUrl = version.coverImageLargeUrl ?? self.coverImageLargeUrl
                    }
                }

                if let url = version.previewUrl ?? version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    await MainActor.run {
                        self.previewUrl = transformedUrl
                        self.progress = 100
                        self.renderStatus = .completed
                        setupPlayer(url: transformedUrl)
                        fetchCredits()
                    }
                    return true
                } else {
                    if setFailureOnMissing {
                        await MainActor.run {
                            renderStatus = .failed("Preview not ready yet")
                        }
                    }
                    return false
                }
            } else {
                if setFailureOnMissing {
                    await MainActor.run {
                        renderStatus = .failed("Preview not ready yet")
                    }
                }
                return false
            }

        } catch {
            if setFailureOnMissing {
                await MainActor.run {
                    renderStatus = .failed(error.localizedDescription)
                }
            }
            return false
        }
    }

    // MARK: - Full Render

    private func fetchCredits() {
        creditsTask?.cancel()
        creditsLoadState = .loading

        creditsTask = Task { [self] in
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadCredits") {
                    try await apiClient.getEntitlements()
                }

                guard !Task.isCancelled else { return }

                await MainActor.run {
                    creditsLoadState = .loaded(response.entitlements?.creditsBalance ?? 0)
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    creditsLoadState = .error("Couldn't load credits")
                }
            }
        }
    }

    private func startFullRender() {
        fullRenderStatus = .rendering
        renderStepMessage = nil
        pollingFailureCount = 0

        fullRenderTask = Task {
            do {
                if await resumeExistingFullRender() {
                    return
                }
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderFull") {
                    try await self.apiClient.renderFull(
                        trackId: self.trackId,
                        versionNum: self.versionNum
                    )
                }

                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    fullRenderJobId = jobId
                    await pollForFullRenderCompletion(jobId: jobId)
                } else {
                    _ = await checkFullRenderStatus()
                }

            } catch {
                guard !Task.isCancelled else { return }
                if await resumeExistingFullRender() {
                    return
                }
                await MainActor.run {
                    fullRenderStatus = .failed(error.localizedDescription)
                    fetchCredits()
                }
            }
        }
    }

    private func resumeExistingFullRender() async -> Bool {
        do {
            let track = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resumeFullRender") { [self] in
                try await apiClient.getTrack(trackId: trackId)
            }
            if let version = track.versions.first(where: { $0.versionNum == versionNum }) {
                if let url = version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    await MainActor.run {
                        fullUrl = transformedUrl
                        fullRenderStatus = .completed
                        stopPlayback()
                        setupPlayer(url: transformedUrl)
                        fetchCredits()
                    }
                    return true
                }
                if let existingJobId = version.fullJobId {
                    fullRenderJobId = existingJobId
                    await pollForFullRenderCompletion(jobId: existingJobId)
                    return true
                }
            }
        } catch {
            print("[NowPlayingView] Resume existing full render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func pollForFullRenderCompletion(jobId: String) async {
        var elapsed: UInt64 = 0

        while elapsed < TrackPlayerPollingConfig.fullRenderMaxDurationNs {
            guard !Task.isCancelled else { return }

            let intervalIndex = TrackPlayerPollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = TrackPlayerPollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "pollFullRenderStatus") {
                    try await self.apiClient.getJobStatus(jobId: jobId)
                }

                await MainActor.run {
                    self.renderStepMessage = renderMessage(for: status, isFull: true)
                }

                switch status.status {
                case "completed":
                    _ = await checkFullRenderStatus()
                    return

                case "failed":
                    await MainActor.run {
                        fullRenderStatus = .failed(status.errorMessage ?? "Full render failed")
                        fetchCredits()
                    }
                    return

                default:
                    continue
                }

            } catch {
                guard !Task.isCancelled else { return }

                await MainActor.run {
                    pollingFailureCount += 1
                }

                if pollingFailureCount >= maxPollingFailures {
                    await MainActor.run {
                        fullRenderStatus = .failed("Connection error. Check your network and try again.")
                        fetchCredits()
                    }
                    return
                }

                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            }
        }

        guard !Task.isCancelled else { return }
        if await checkFullRenderStatus(setFailureOnMissing: false) {
            return
        }
        await MainActor.run {
            fullRenderStatus = .failed("Full render timed out. Please try again.")
        }
    }

    private func checkFullRenderStatus(setFailureOnMissing: Bool = true) async -> Bool {
        do {
            let track = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkFullRenderStatus") {
                try await self.apiClient.getTrack(trackId: self.trackId)
            }

            if let version = track.versions.first(where: { $0.versionNum == versionNum }),
               let url = version.fullUrl {
                let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                await MainActor.run {
                    fullUrl = transformedUrl
                    fullRenderStatus = .completed
                    stopPlayback()
                    setupPlayer(url: transformedUrl)
                    fetchCredits()
                    // Track full render completion for review prompting
                    ReviewManager.shared.recordFullRenderComplete()
                }
                return true
            } else {
                if setFailureOnMissing {
                    await MainActor.run {
                        fullRenderStatus = .failed("Full render not ready")
                    }
                }
                return false
            }

        } catch {
            if setFailureOnMissing {
                await MainActor.run {
                    fullRenderStatus = .failed(error.localizedDescription)
                }
            }
            return false
        }
    }

    // MARK: - Render Step Messaging

    private func renderMessage(for status: JobStatus, isFull: Bool = false) -> String? {
        if status.status == "completed" || status.status == "failed" {
            return nil
        }
        let step = status.step ?? ""
        if step.contains("instrumental") && status.status == "queued" {
            return "Waiting on the music provider..."
        }
        switch step {
        case "moderation":
            return "Checking content safety..."
        case "lyrics":
            return "Writing lyrics..."
        case "music_plan":
            return "Planning the music..."
        case "instrumental", "instrumental_full":
            return isFull ? "Generating the full instrumental..." : "Generating the instrumental..."
        case "guide_vocal", "guide_vocal_full":
            return isFull ? "Preparing the full guide vocal..." : "Preparing the guide vocal..."
        case "voice_convert", "voice_convert_sections":
            return "Shaping the vocal performance..."
        case "mix":
            return "Mixing vocals and instrumental..."
        case "watermark":
            return "Finalizing your song..."
        case "ready":
            return "Final touches..."
        default:
            return "Processing..."
        }
    }

    // MARK: - Reroll

    private func performReroll(type: RerollType) {
        guard !isRerolling else { return }

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        isRerolling = true
        stopPlayback()

        rerollTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "reroll") {
                    try await self.apiClient.reroll(
                        trackId: self.trackId,
                        versionNum: self.versionNum,
                        rerollType: type
                    )
                }

                guard !Task.isCancelled else { return }

                await MainActor.run {
                    isRerolling = false
                    if let onRerollComplete = onRerollComplete {
                        ToastService.shared.success("New version created!")
                        onRerollComplete(response.newVersionNum)
                    } else {
                        ToastService.shared.success("Version \(response.newVersionNum) created! Check My Songs")
                    }
                }

            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    isRerolling = false
                    ToastService.shared.error("Reroll failed. Please try again.")
                }
            }
        }
    }

    // MARK: - Playback

    private func setupPlayer(url: String) {
        print("[Audio] setupPlayer called with URL: \(url)")

        if !ensureAudioSessionActive() {
            print("[Audio] WARNING: Could not configure audio session, playback may fail")
        }

        guard let audioUrl = URL(string: url) else {
            print("[Audio] ERROR: Invalid URL string")
            ToastService.shared.error("Invalid audio URL")
            return
        }

        let playerItem = AVPlayerItem(url: audioUrl)
        player = AVPlayer(playerItem: playerItem)
        playbackTime = 0
        playbackProgress = 0
        duration = 0
        configureNowPlaying()
        updateNowPlayingMetadata()

        playerItemStatusObserver?.invalidate()
        playerItemStatusObserver = playerItem.observe(\.status, options: [.initial, .new]) { [self] item, _ in
            switch item.status {
            case .readyToPlay:
                let itemDuration = item.duration.seconds
                if itemDuration.isFinite && itemDuration > 0 {
                    Task { @MainActor in
                        self.duration = itemDuration
                        NowPlayingManager.shared.updateMetadata(
                            NowPlayingMetadata(title: self.trackTitle, artist: self.nowPlayingArtist),
                            duration: itemDuration
                        )
                        self.resetRetryState()
                    }
                }
            case .failed:
                let userMessage: String
                if let error = item.error as NSError? {
                    print("[Audio] PlayerItem FAILED: \(error.localizedDescription)")
                    if error.domain == NSURLErrorDomain {
                        switch error.code {
                        case NSURLErrorNotConnectedToInternet:
                            userMessage = "No internet connection. Check your network and try again."
                        case NSURLErrorTimedOut:
                            userMessage = "Connection timed out. Try again."
                        default:
                            userMessage = "Network error (\(error.code)). Try again."
                        }
                    } else {
                        userMessage = "Unable to play audio (Error \(error.code))."
                    }
                } else {
                    userMessage = "Unable to play this audio."
                }

                Task { @MainActor in
                    self.isPlaying = false
                    self.playbackError = userMessage
                }
            case .unknown:
                break
            @unknown default:
                break
            }
        }

        Task {
            do {
                let loadedDuration = try await playerItem.asset.load(.duration)
                let durationSeconds = loadedDuration.seconds
                if durationSeconds.isFinite && durationSeconds > 0 {
                    await MainActor.run {
                        self.duration = durationSeconds
                    }
                }
            } catch {
                print("Could not load duration: \(error.localizedDescription)")
            }
        }

        timeObserverToken = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [self] time in
            let timeSeconds = time.seconds
            guard timeSeconds.isFinite else { return }
            playbackTime = timeSeconds
            if duration > 0 {
                playbackProgress = min(1, timeSeconds / duration)
            }

            // Update current lyric based on time
            updateCurrentLyric(at: timeSeconds)

            Task { @MainActor in
                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: isPlaying,
                    elapsed: timeSeconds,
                    duration: duration > 0 ? duration : nil
                )
            }
        }

        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [self] _ in
            isPlaying = false
            playbackProgress = 0
            playbackTime = 0
            currentLyricIndex = 0
            player?.seek(to: .zero)
            Task { @MainActor in
                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: false,
                    elapsed: 0,
                    duration: duration > 0 ? duration : nil
                )
                // Track successful play for review prompting (emotional high point)
                ReviewManager.shared.recordSuccessfulPlay()
            }
        }
    }

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
            let progress = duration > 0 ? time / duration : 0
            currentLyricIndex = min(Int(progress * Double(lyrics.count)), lyrics.count - 1)
        }
    }

    private func retryPlayback() {
        if let lastRetry = lastRetryTime {
            let elapsed = Date().timeIntervalSince(lastRetry)
            let requiredInterval = min(minRetryIntervalSeconds * pow(2.0, Double(retryAttemptCount)), 16.0)
            if elapsed < requiredInterval {
                let waitTime = Int(ceil(requiredInterval - elapsed))
                if let existingError = playbackError, !existingError.contains("wait") {
                    playbackError = "\(existingError) (wait \(waitTime)s)"
                }
                return
            }
        }

        lastRetryTime = Date()
        retryAttemptCount += 1
        playbackError = nil

        let urlToRetry = fullUrl ?? previewUrl
        guard let url = urlToRetry else {
            playbackError = "No audio URL available"
            return
        }

        setupPlayer(url: url)
    }

    private func resetRetryState() {
        retryAttemptCount = 0
        lastRetryTime = nil
    }

    private func togglePlayback() {
        guard let player = player else {
            ToastService.shared.error("Player not initialized")
            return
        }

        if isPlaying {
            player.pause()
            NowPlayingManager.shared.updatePlaybackState(isPlaying: false, elapsed: playbackTime, duration: duration > 0 ? duration : nil)
        } else {
            if !ensureAudioSessionActive() {
                ToastService.shared.error("Could not activate audio")
                return
            }

            if let currentItem = player.currentItem {
                if let error = currentItem.error {
                    ToastService.shared.error("Cannot play: \(error.localizedDescription)")
                    return
                }
            }

            player.play()
            NowPlayingManager.shared.updatePlaybackState(isPlaying: true, elapsed: playbackTime, duration: duration > 0 ? duration : nil)
        }

        isPlaying.toggle()
    }

    private func configureNowPlaying() {
        NowPlayingManager.shared.configureRemoteCommands(
            onPlay: { [weak player] in
                player?.play()
                Task { @MainActor in
                    self.isPlaying = true
                }
            },
            onPause: { [weak player] in
                player?.pause()
                Task { @MainActor in
                    self.isPlaying = false
                }
            },
            onToggle: { [weak player] in
                guard let player else { return }
                if player.rate == 0 {
                    player.play()
                    Task { @MainActor in
                        self.isPlaying = true
                    }
                } else {
                    player.pause()
                    Task { @MainActor in
                        self.isPlaying = false
                    }
                }
            },
            onSeek: { [weak player] time in
                let cmTime = CMTime(seconds: time, preferredTimescale: 600)
                player?.seek(to: cmTime)
            }
        )
    }

    private func updateNowPlayingMetadata() {
        let metadata = NowPlayingMetadata(title: trackTitle, artist: nowPlayingArtist)
        NowPlayingManager.shared.updateMetadata(metadata, duration: duration > 0 ? duration : nil)
    }

    private var nowPlayingArtist: String? {
        let trimmed = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Porizo" : trimmed
    }

    private func stopPlayback() {
        if let token = timeObserverToken, let currentPlayer = player {
            currentPlayer.removeTimeObserver(token)
            timeObserverToken = nil
        }
        playerItemStatusObserver?.invalidate()
        playerItemStatusObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        playbackTime = 0
        playbackProgress = 0
        duration = 0
        NowPlayingManager.shared.updatePlaybackState(isPlaying: false, elapsed: 0, duration: nil)
        if let observer = playbackEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackEndObserver = nil
        }
    }

    private func ensureAudioSessionActive() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            if session.category != .playback {
                try session.setCategory(.playback, mode: .default, options: [])
            }
            try session.setActive(true)
            return true
        } catch {
            print("[Audio] Failed to configure audio session: \(error)")
            return false
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
