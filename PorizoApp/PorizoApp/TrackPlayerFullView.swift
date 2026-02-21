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
    /// Called when render fails due provider policy and user wants to edit lyrics.
    var onEditLyricsRequested: (([String]) -> Void)? = nil
    /// Restrict available reroll types for specific flows (e.g., gift flow allows only lyric retries).
    var allowedRerollTypes: [RerollType] = RerollType.allCases
    /// Optional reroll limit for this flow.
    var rerollLimit: Int? = nil
    /// Number of rerolls already used in this flow.
    var rerollsUsed: Int = 0
    /// Called when a reroll completes successfully.
    var onRerollUsed: (() -> Void)? = nil

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
    @State private var lastRenderErrorMessage: String? = nil
    @State private var lastRenderErrorCode: String? = nil
    @State private var lastRenderErrorTerms: [String] = []
    @State private var lastRenderErrorCategory: String? = nil
    @State private var lastRenderSuggestedAction: String? = nil
    @State private var lastRenderCanAutoRewrite: Bool = false
    @State private var lastRenderProvider: String? = nil

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
                if let remaining = rerollsRemaining {
                    Text("Retries left: \(remaining)")
                    Divider()
                }

                if allowedRerollTypes.isEmpty {
                    Text("Retry unavailable")
                } else {
                    ForEach(allowedRerollTypes, id: \.rawValue) { rerollType in
                        Button {
                            performReroll(type: rerollType)
                        } label: {
                            Label(rerollMenuTitle(for: rerollType), systemImage: rerollType.iconName)
                        }
                        .disabled(!canPerformReroll || isRerolling)
                    }
                    if !canPerformReroll {
                        Text("Retry limit reached")
                    }
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

            if let rerollLimit {
                Text("Gift retries used: \(rerollsUsed)/\(rerollLimit)")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)
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
                    retryFullRender()
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

                if !lastRenderErrorTerms.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Flagged terms from provider")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                        Text(lastRenderErrorTerms.joined(separator: ", "))
                            .font(.caption)
                            .foregroundColor(DesignTokens.warning)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Gentle suggestions")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundColor(DesignTokens.textSecondary)
                            ForEach(renderPolicySuggestions(lastRenderErrorTerms), id: \.self) { suggestion in
                                Text("• \(suggestion)")
                                    .font(.caption)
                                    .foregroundColor(DesignTokens.textSecondary)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                }

                if shouldShowEditLyricsCTA(error),
                   let onEditLyricsRequested {
                    Button {
                        onEditLyricsRequested(lastRenderErrorTerms)
                    } label: {
                        HStack {
                            Image(systemName: "pencil")
                            Text("Edit Lyrics")
                        }
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(DesignTokens.warning)
                        .cornerRadius(20)
                    }
                }

                Button {
                    retryRender()
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

    private func retryRender() {
        print("[TrackPlayerFullView] retryRender() called — using /retry endpoint")
        renderStatus = .rendering
        progress = nil
        renderStepMessage = nil
        lastRenderErrorMessage = nil
        lastRenderErrorCode = nil
        lastRenderErrorTerms = []
        lastRenderErrorCategory = nil
        lastRenderSuggestedAction = nil
        lastRenderCanAutoRewrite = false
        lastRenderProvider = nil
        pollingFailureCount = 0
        pollingError = nil

        renderTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryPreview") {
                    try await self.apiClient.retryPreview(
                        trackId: self.trackId,
                        versionNum: self.versionNum
                    )
                }
                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.jobId = jobId
                    await pollForCompletion(jobId: jobId)
                } else {
                    _ = await checkTrackStatus()
                }
            } catch let APIClientError.httpError(statusCode, _) where statusCode == 404 {
                // No failed job found — fall back to fresh render
                print("[TrackPlayerFullView] retryRender got 404, falling back to startRender")
                guard !Task.isCancelled else { return }
                await MainActor.run { startRender() }
            } catch {
                print("[TrackPlayerFullView] retryRender failed: \(error.localizedDescription)")
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    renderStatus = .failed(friendlyMessage)
                }
            }
        }
    }

    private func startRender() {
        print("[TrackPlayerFullView] startRender() called")
        renderStatus = .rendering
        progress = nil
        renderStepMessage = nil
        lastRenderErrorMessage = nil
        lastRenderErrorCode = nil
        lastRenderErrorTerms = []
        lastRenderErrorCategory = nil
        lastRenderSuggestedAction = nil
        lastRenderCanAutoRewrite = false
        lastRenderProvider = nil
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
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    renderStatus = .failed(friendlyMessage)
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
                if version.status == "failed" {
                    await MainActor.run {
                        let failureCode = version.lastErrorCode ?? "RENDER_FAILED"
                        let hints = deriveRenderFailureHints(
                            code: failureCode,
                            message: version.lastErrorMessage ?? lastRenderErrorMessage
                        )
                        let friendlyMessage = userFacingRenderError(
                            version.lastErrorMessage ?? lastRenderErrorMessage,
                            code: failureCode
                        )
                        lastRenderErrorMessage = friendlyMessage
                        lastRenderErrorCode = failureCode
                        lastRenderErrorTerms = mergedPolicyTerms(
                            version.lastErrorTerms,
                            fromMessage: version.lastErrorMessage
                        )
                        lastRenderErrorCategory = version.lastErrorCategory ?? hints.category
                        lastRenderSuggestedAction = version.lastErrorSuggestedAction ?? hints.suggestedAction
                        lastRenderCanAutoRewrite = version.lastErrorCanAutoRewrite ?? hints.canAutoRewrite
                        lastRenderProvider = version.lastErrorProvider ?? hints.provider
                        renderStatus = .failed(friendlyMessage)
                    }
                    return true
                }

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

                case "failed", "dead_letter", "blocked":
                    await MainActor.run {
                        let policyTerms = mergedPolicyTerms(
                            status.errorTerms,
                            fromMessage: status.errorMessage
                        )
                        let failureCode = status.errorCode
                        let friendlyMessage = userFacingRenderError(
                            status.errorMessage,
                            code: failureCode
                        )
                        lastRenderErrorMessage = friendlyMessage
                        lastRenderErrorCode = failureCode
                        lastRenderErrorTerms = policyTerms
                        lastRenderErrorCategory = status.errorCategory
                        lastRenderSuggestedAction = status.suggestedAction
                        lastRenderCanAutoRewrite = status.canAutoRewrite ?? false
                        lastRenderProvider = status.provider
                        renderStatus = .failed(friendlyMessage)
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
                if version.status == "failed" {
                    await MainActor.run {
                        let failureCode = version.lastErrorCode ?? "RENDER_FAILED"
                        let hints = deriveRenderFailureHints(
                            code: failureCode,
                            message: version.lastErrorMessage ?? lastRenderErrorMessage
                        )
                        let friendlyMessage = userFacingRenderError(
                            version.lastErrorMessage ?? lastRenderErrorMessage,
                            code: failureCode
                        )
                        lastRenderErrorMessage = friendlyMessage
                        lastRenderErrorCode = failureCode
                        lastRenderErrorTerms = mergedPolicyTerms(
                            version.lastErrorTerms,
                            fromMessage: version.lastErrorMessage
                        )
                        lastRenderErrorCategory = version.lastErrorCategory ?? hints.category
                        lastRenderSuggestedAction = version.lastErrorSuggestedAction ?? hints.suggestedAction
                        lastRenderCanAutoRewrite = version.lastErrorCanAutoRewrite ?? hints.canAutoRewrite
                        lastRenderProvider = version.lastErrorProvider ?? hints.provider
                        renderStatus = .failed(friendlyMessage)
                    }
                    return true
                }

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
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    renderStatus = .failed(friendlyMessage)
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

    private func retryFullRender() {
        print("[TrackPlayerFullView] retryFullRender() called — using /retry endpoint")
        fullRenderStatus = .rendering
        renderStepMessage = nil
        pollingFailureCount = 0

        fullRenderTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryFullRender") {
                    try await self.apiClient.retryFullRender(
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
            } catch let APIClientError.httpError(statusCode, _) where statusCode == 404 {
                // No failed job found — fall back to fresh full render
                print("[TrackPlayerFullView] retryFullRender got 404, falling back to startFullRender")
                guard !Task.isCancelled else { return }
                await MainActor.run { startFullRender() }
            } catch {
                guard !Task.isCancelled else { return }
                if await resumeExistingFullRender() {
                    return
                }
                await MainActor.run {
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    fullRenderStatus = .failed(friendlyMessage)
                    fetchCredits()
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
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    fullRenderStatus = .failed(friendlyMessage)
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
                if version.status == "failed" {
                    await MainActor.run {
                        let failureCode = version.lastErrorCode ?? "RENDER_FAILED"
                        let hints = deriveRenderFailureHints(
                            code: failureCode,
                            message: version.lastErrorMessage ?? lastRenderErrorMessage
                        )
                        let friendlyMessage = userFacingRenderError(
                            version.lastErrorMessage ?? lastRenderErrorMessage,
                            code: failureCode
                        )
                        lastRenderErrorMessage = friendlyMessage
                        lastRenderErrorCode = failureCode
                        lastRenderErrorTerms = mergedPolicyTerms(
                            version.lastErrorTerms,
                            fromMessage: version.lastErrorMessage
                        )
                        lastRenderErrorCategory = version.lastErrorCategory ?? hints.category
                        lastRenderSuggestedAction = version.lastErrorSuggestedAction ?? hints.suggestedAction
                        lastRenderCanAutoRewrite = version.lastErrorCanAutoRewrite ?? hints.canAutoRewrite
                        lastRenderProvider = version.lastErrorProvider ?? hints.provider
                        fullRenderStatus = .failed(friendlyMessage)
                    }
                    return true
                }
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

                case "failed", "dead_letter", "blocked":
                    await MainActor.run {
                        let policyTerms = mergedPolicyTerms(
                            status.errorTerms,
                            fromMessage: status.errorMessage
                        )
                        let failureCode = status.errorCode
                        let friendlyMessage = userFacingRenderError(
                            status.errorMessage,
                            code: failureCode
                        )
                        lastRenderErrorMessage = friendlyMessage
                        lastRenderErrorCode = failureCode
                        lastRenderErrorTerms = policyTerms
                        lastRenderErrorCategory = status.errorCategory
                        lastRenderSuggestedAction = status.suggestedAction
                        lastRenderCanAutoRewrite = status.canAutoRewrite ?? false
                        lastRenderProvider = status.provider
                        fullRenderStatus = .failed(friendlyMessage)
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
            } else if let version = track.versions.first(where: { $0.versionNum == versionNum }),
                      version.status == "failed" {
                await MainActor.run {
                    let failureCode = version.lastErrorCode ?? "RENDER_FAILED"
                    let hints = deriveRenderFailureHints(
                        code: failureCode,
                        message: version.lastErrorMessage ?? lastRenderErrorMessage
                    )
                    let friendlyMessage = userFacingRenderError(
                        version.lastErrorMessage ?? lastRenderErrorMessage,
                        code: failureCode
                    )
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = failureCode
                    lastRenderErrorTerms = mergedPolicyTerms(
                        version.lastErrorTerms,
                        fromMessage: version.lastErrorMessage
                    )
                    lastRenderErrorCategory = version.lastErrorCategory ?? hints.category
                    lastRenderSuggestedAction = version.lastErrorSuggestedAction ?? hints.suggestedAction
                    lastRenderCanAutoRewrite = version.lastErrorCanAutoRewrite ?? hints.canAutoRewrite
                    lastRenderProvider = version.lastErrorProvider ?? hints.provider
                    fullRenderStatus = .failed(friendlyMessage)
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
                    let friendlyMessage = userFacingRenderError(error.localizedDescription, code: nil)
                    lastRenderErrorMessage = friendlyMessage
                    lastRenderErrorCode = nil
                    lastRenderErrorTerms = mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
                    lastRenderErrorCategory = nil
                    lastRenderSuggestedAction = nil
                    lastRenderCanAutoRewrite = false
                    lastRenderProvider = nil
                    fullRenderStatus = .failed(friendlyMessage)
                }
            }
            return false
        }
    }

    // MARK: - Render Step Messaging

    private func deriveRenderFailureHints(code: String?, message: String?) -> (category: String?, suggestedAction: String?, canAutoRewrite: Bool, provider: String?) {
        let normalizedCode = (code ?? "").uppercased()
        let lowercased = (message ?? "").lowercased()

        let inferredProvider: String? = {
            if normalizedCode.hasPrefix("E302_SUNO") || lowercased.contains("suno") { return "suno" }
            if normalizedCode.hasPrefix("E301_ELEVENLABS") || lowercased.contains("elevenlabs") { return "elevenlabs" }
            return nil
        }()

        if normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" ||
            lowercased.contains("content policy") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") {
            return ("policy_content", "rewrite_and_retry", true, inferredProvider)
        }

        if normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("bad_prompt") ||
            lowercased.contains("compose validation failed") {
            return ("policy_validation", "rewrite_and_retry", true, inferredProvider ?? "elevenlabs")
        }

        if normalizedCode == "E302_QUALITY_GATE_FAILED" || lowercased.contains("quality gate") {
            return ("quality_gate", "retry_with_adjusted_style", true, inferredProvider)
        }

        if normalizedCode == "E302_SUNO_INCOMPLETE_OUTPUT" ||
            lowercased.contains("no audio url in response") ||
            lowercased.contains("no audio data in response") ||
            lowercased.contains("incomplete audio result") {
            return ("infra_retryable", "retry", false, inferredProvider ?? "suno")
        }

        if normalizedCode == "PROVIDER_ERROR_429" || lowercased.contains("rate limit") {
            return ("provider_transient", "wait_and_retry", false, inferredProvider)
        }

        if lowercased.contains("timeout") || lowercased.contains("network") {
            return ("infra_retryable", "retry", false, inferredProvider)
        }

        return ("infra_terminal", "retry", false, inferredProvider)
    }

    private func userFacingRenderError(_ rawMessage: String?, code: String?) -> String {
        let message = (rawMessage ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let lowercased = message.lowercased()
        let normalizedCode = (code ?? "").uppercased()
        let derived = deriveRenderFailureHints(code: normalizedCode.isEmpty ? nil : normalizedCode, message: message)
        let effectiveCategory = lastRenderErrorCategory ?? derived.category
        let effectiveAction = lastRenderSuggestedAction ?? derived.suggestedAction
        let effectiveCanRewrite = lastRenderCanAutoRewrite || derived.canAutoRewrite

        if effectiveAction == "rewrite_and_retry" ||
            effectiveCategory == "policy_content" ||
            effectiveCategory == "policy_validation" ||
            effectiveCanRewrite {
            if !lastRenderErrorTerms.isEmpty {
                return "We found lyrics content the music provider rejected. Tap Edit Lyrics to revise the flagged lines, then try again."
            }
            return "The music provider rejected part of these lyrics. Tap Edit Lyrics to revise wording, then try again."
        }

        if normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" {
            if !lastRenderErrorTerms.isEmpty {
                return "Lyrics were blocked by provider policy. Tap Edit Lyrics to update the flagged terms and retry."
            }
            return "Lyrics were blocked by provider policy. Tap Edit Lyrics and remove artist names, brand names, explicit content, or age references."
        }

        if normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("bad_prompt") ||
            lowercased.contains("compose validation failed") {
            return "The music provider rejected this composition request. Edit lyrics/style wording and retry."
        }

        if lowercased.contains("no audio url in response") || lowercased.contains("no audio url") {
            return "Music provider returned an incomplete audio result. Tap Try Again."
        }

        if effectiveCategory == "provider_transient" {
            return "Music service is temporarily rate-limited. Please wait a minute and try again."
        }

        if effectiveCategory == "infra_retryable" || effectiveCategory == "infra_terminal" {
            return "Music generation failed due to a provider delivery issue. Tap Try Again."
        }

        if lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("sensitive_word_error") {
            return "Your lyrics were rejected for referencing an artist or producer tag. Edit the lyrics to remove named references, then try again."
        }

        if message.isEmpty {
            if normalizedCode == "E302_SUNO_ERROR" ||
                normalizedCode == "E302_SUNO_POLICY_ERROR" ||
                normalizedCode == "E302_PROVIDER_POLICY_ERROR" {
                return "Music generation failed due to lyrics policy. Please revise your lyrics and try again."
            }
            if normalizedCode == "PROVIDER_ERROR_429" {
                return "Music service is rate-limited right now. Please wait a minute and try again."
            }
            if normalizedCode == "RENDER_FAILED" {
                return "Render failed. Please try again."
            }
            return "Render failed. Please try again."
        }

        if message.hasPrefix("E302_SUNO_ERROR:") {
            return message.replacingOccurrences(of: "E302_SUNO_ERROR:", with: "").trimmingCharacters(in: .whitespaces)
        }

        if message.hasPrefix("E302_SUNO_POLICY_ERROR:") {
            return message.replacingOccurrences(of: "E302_SUNO_POLICY_ERROR:", with: "").trimmingCharacters(in: .whitespaces)
        }

        return message
    }

    private func shouldShowEditLyricsCTA(_ errorMessage: String) -> Bool {
        let derived = deriveRenderFailureHints(code: lastRenderErrorCode, message: errorMessage)
        let effectiveCategory = lastRenderErrorCategory ?? derived.category
        let effectiveAction = lastRenderSuggestedAction ?? derived.suggestedAction
        let effectiveCanRewrite = lastRenderCanAutoRewrite || derived.canAutoRewrite

        if effectiveAction == "rewrite_and_retry" ||
            effectiveCategory == "policy_content" ||
            effectiveCategory == "policy_validation" ||
            effectiveCanRewrite {
            return true
        }

        if effectiveCategory == "provider_transient" ||
            effectiveCategory == "infra_retryable" ||
            effectiveCategory == "infra_terminal" {
            return false
        }

        if let code = lastRenderErrorCode {
            if code == "E302_SUNO_POLICY_ERROR" ||
                code == "E302_PROVIDER_POLICY_ERROR" ||
                code == "E301_ELEVENLABS_VALIDATION" {
                return true
            }
            if code == "E302_SUNO_ERROR" {
                let lower = errorMessage.lowercased()
                return lower.contains("policy") ||
                    lower.contains("sensitive_word_error") ||
                    lower.contains("specific artists") ||
                    lower.contains("producer tag")
            }
            if code.hasPrefix("provider_error_") || code == "RENDER_FAILED" {
                return false
            }
        }

        if !lastRenderErrorTerms.isEmpty {
            return true
        }
        let lowercased = errorMessage.lowercased()
        return lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("sensitive_word_error") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("content policy") ||
            lowercased.contains("blocked word") ||
            lowercased.contains("disallowed") ||
            lowercased.contains("restricted")
    }

    private func mergedPolicyTerms(_ apiTerms: [String]?, fromMessage message: String?) -> [String] {
        var terms = Set<String>()

        for term in apiTerms ?? [] {
            for variant in normalizedPolicyTermVariants(term) {
                terms.insert(variant)
            }
        }
        for term in extractPolicyTerms(from: message) {
            for variant in normalizedPolicyTermVariants(term) {
                terms.insert(variant)
            }
        }

        return Array(terms).sorted()
    }

    private func extractPolicyTerms(from message: String?) -> [String] {
        guard let message, !message.isEmpty else { return [] }
        let fullRange = NSRange(message.startIndex..<message.endIndex, in: message)
        let patterns = [
            #"producer tag(?:\s+error)?(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"lyrics contain(?:s)?(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"(?:flagged|blocked|disallowed|restricted|banned|sensitive)\s+(?:word|words|term|terms|phrase|phrases)(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"sensitive[_\s-]?word[_\s-]?error(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"(?:specific artists?|artist references?)(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#
        ]
        var terms = Set<String>()
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let matches = regex.matches(in: message, options: [], range: fullRange)
            for match in matches {
                guard match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: message) else {
                    continue
                }
                for term in splitPolicyTermCandidates(String(message[range])) {
                    terms.insert(term)
                }
            }
        }

        if terms.isEmpty {
            let lowercased = message.lowercased()
            let hasPolicyContext = lowercased.contains("policy") ||
                lowercased.contains("producer tag") ||
                lowercased.contains("specific artists") ||
                lowercased.contains("sensitive_word_error") ||
                lowercased.contains("blocked") ||
                lowercased.contains("disallowed")
            if hasPolicyContext,
               let quotedRegex = try? NSRegularExpression(
                pattern: #"["“”'`]\s*([^"“”'`]{2,64})\s*["“”'`]"#,
                options: []
               ) {
                let matches = quotedRegex.matches(in: message, options: [], range: fullRange)
                for match in matches {
                    guard match.numberOfRanges > 1,
                          let range = Range(match.range(at: 1), in: message),
                          let normalized = normalizePolicyTerm(String(message[range])) else {
                        continue
                    }
                    terms.insert(normalized)
                }
            }
        }

        return Array(terms).sorted()
    }

    private func splitPolicyTermCandidates(_ chunk: String) -> [String] {
        var terms = Set<String>()
        let fullRange = NSRange(chunk.startIndex..<chunk.endIndex, in: chunk)
        if let quotedRegex = try? NSRegularExpression(
            pattern: #"["“”'`]\s*([^"“”'`]{1,64})\s*["“”'`]"#,
            options: []
        ) {
            let matches = quotedRegex.matches(in: chunk, options: [], range: fullRange)
            for match in matches {
                guard match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: chunk),
                      let normalized = normalizePolicyTerm(String(chunk[range])) else {
                    continue
                }
                terms.insert(normalized)
            }
        }

        var cleaned = chunk.replacingOccurrences(
            of: #"[\"“”'`\[\]\{\}]"#,
            with: " ",
            options: .regularExpression
        )
        cleaned = cleaned.replacingOccurrences(
            of: #"\s+\band\b\s+"#,
            with: ",",
            options: .regularExpression
        )
        cleaned = cleaned.replacingOccurrences(of: ";", with: ",")
        let parts = cleaned.split(separator: ",")
        for rawPart in parts {
            if let normalized = normalizePolicyTerm(String(rawPart)) {
                terms.insert(normalized)
            }
        }

        return Array(terms)
    }

    private func normalizePolicyTerm(_ rawTerm: String) -> String? {
        let genericTerms: Set<String> = [
            "artist", "artists", "producer", "producer tag", "policy", "lyrics policy",
            "sensitive word", "sensitive words", "blocked word", "blocked words",
            "restricted word", "restricted words", "disallowed word", "disallowed words",
            "term", "terms", "word", "words", "phrase", "phrases",
            "content", "lyrics", "failed", "error"
        ]

        var term = rawTerm
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        term = term.replacingOccurrences(
            of: #"^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$"#,
            with: "",
            options: .regularExpression
        )
        term = term.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        term = term.replacingOccurrences(
            of: #"^(the\s+)?(word|words|term|terms|phrase|phrases)\s+"#,
            with: "",
            options: .regularExpression
        )
        term = term.replacingOccurrences(
            of: #"\s+(word|words|term|terms|phrase|phrases)$"#,
            with: "",
            options: .regularExpression
        )
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !term.isEmpty, term.count <= 64 else { return nil }

        let compact = term.replacingOccurrences(
            of: "[^a-z0-9]",
            with: "",
            options: .regularExpression
        )
        guard compact.count >= 2, compact.count <= 48 else { return nil }
        guard !genericTerms.contains(term), !genericTerms.contains(compact) else { return nil }
        guard term.range(of: #"[a-z0-9]"#, options: .regularExpression) != nil else { return nil }
        return term
    }

    private func renderPolicySuggestions(_ terms: [String]) -> [String] {
        guard !terms.isEmpty else { return [] }

        var suggestions: [String] = [
            "Avoid artist or producer-style references; keep wording personal and occasion-focused."
        ]

        for term in terms.prefix(3) {
            let compact = term.replacingOccurrences(
                of: "[^a-z0-9]",
                with: "",
                options: .regularExpression
            )
            if let expanded = expandCompactNumberWord(compact) {
                suggestions.append("If this is age-related, rewrite \"\(term)\" as \"\(expanded.spaced) years old\".")
            } else if let numericValue = Int(compact), (1...125).contains(numericValue) {
                suggestions.append("If \"\(term)\" is an age, try \"\(numericValue) years old\".")
            } else {
                suggestions.append("Rewrite \"\(term)\" with a neutral phrase (for example, \"special day\").")
            }
        }

        var unique = Set<String>()
        return suggestions.filter { unique.insert($0).inserted }
    }

    private func normalizedPolicyTermVariants(_ rawTerm: String) -> [String] {
        let term = rawTerm
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !term.isEmpty else { return [] }

        var variants = Set([term])
        let spaced = term.replacingOccurrences(of: "-", with: " ")
        let hyphenated = term.replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
        variants.insert(spaced)
        variants.insert(hyphenated)
        let compact = term.replacingOccurrences(
            of: "[^a-z0-9]",
            with: "",
            options: .regularExpression
        )
        variants.insert(compact)
        if let expanded = expandCompactNumberWord(compact) {
            variants.insert(expanded.compact)
            variants.insert(expanded.spaced)
            variants.insert(expanded.spaced.replacingOccurrences(of: " ", with: "-"))
            variants.insert(expanded.numeric)
        }
        return Array(variants)
    }

    private func expandCompactNumberWord(_ value: String) -> (compact: String, spaced: String, numeric: String)? {
        let tens: [(String, Int)] = [
            ("twenty", 20),
            ("thirty", 30),
            ("forty", 40),
            ("fifty", 50),
            ("sixty", 60),
            ("seventy", 70),
            ("eighty", 80),
            ("ninety", 90)
        ]
        let ones: [(String, Int)] = [
            ("one", 1),
            ("two", 2),
            ("three", 3),
            ("four", 4),
            ("five", 5),
            ("six", 6),
            ("seven", 7),
            ("eight", 8),
            ("nine", 9)
        ]
        for (tensWord, tensValue) in tens {
            for (onesWord, onesValue) in ones {
                let compact = "\(tensWord)\(onesWord)"
                if value == compact {
                    return (compact, "\(tensWord) \(onesWord)", "\(tensValue + onesValue)")
                }
            }
        }
        return nil
    }

    private func renderMessage(for status: JobStatus, isFull: Bool = false) -> String? {
        if status.status == "completed" ||
            status.status == "failed" ||
            status.status == "dead_letter" ||
            status.status == "blocked" {
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
        guard allowedRerollTypes.contains(type) else { return }
        guard !isRerolling else { return }
        guard canPerformReroll else {
            ToastService.shared.info("Retry limit reached for this gift flow.")
            return
        }

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
                    onRerollUsed?()
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

    private var canPerformReroll: Bool {
        guard let rerollLimit else { return true }
        return rerollsUsed < rerollLimit
    }

    private var rerollsRemaining: Int? {
        guard let rerollLimit else { return nil }
        return max(rerollLimit - rerollsUsed, 0)
    }

    private func rerollMenuTitle(for type: RerollType) -> String {
        switch type {
        case .lyrics:
            return "New Lyrics"
        case .beat:
            return "New Beat"
        case .vocals:
            return "New Vocals"
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
