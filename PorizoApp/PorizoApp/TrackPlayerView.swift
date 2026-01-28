//
//  TrackPlayerView.swift
//  PorizoApp
//
//  Renders and plays the generated song.
//  Velvet & Gold design system.
//

import SwiftUI
import AVFoundation

// DesignTokens are now in DesignTokens.swift

// MARK: - Polling Configuration
// Consolidated polling intervals for preview and full render job polling
private enum PollingConfig {
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

struct TrackPlayerView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let onDone: () -> Void
    let onNewSong: () -> Void
    /// Called when reroll creates a new version - navigate to that version
    var onRerollComplete: ((Int) -> Void)?

    // Render state
    @State private var renderStatus: RenderStatus = .idle
    @State private var jobId: String?
    @State private var previewUrl: String?
    /// Actual progress from server (nil = unknown, show "Processing...")
    @State private var progress: Int? = nil
    @State private var renderStepMessage: String? = nil

    // Full render state
    @State private var fullRenderStatus: FullRenderStatus = .notStarted
    @State private var fullUrl: String?
    @State private var creditsLoadState: CreditsLoadState = .loading
    @State private var showingCreditConfirmation = false
    @State private var fullRenderJobId: String?

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

    // Error state
    @State private var showingError = false
    @State private var errorMessage = ""

    // Share state
    @State private var showingShareSheet = false
    @State private var trackTitle: String = "Your Song"
    @State private var recipientName: String = ""

    // Timer for progress updates
    @State private var progressTimer: Timer?

    // Observer tokens for proper cleanup (prevents memory leak)
    @State private var playbackEndObserver: NSObjectProtocol?
    @State private var timeObserverToken: Any?
    @State private var playerItemStatusObserver: NSKeyValueObservation?

    // H11: Playback failure retry state
    @State private var playbackError: String?
    @State private var lastRetryTime: Date?
    @State private var retryAttemptCount: Int = 0
    private let minRetryIntervalSeconds: Double = 2.0  // Minimum time between retries

    // Stream diagnostics (TestFlight validation)
    @State private var isStreamCheckRunning = false
    @State private var streamCheckMessage: String?
    @State private var showingStreamCheck = false

    // Task references for proper cancellation
    @State private var renderTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?
    @State private var fullRenderTask: Task<Void, Never>?

    // Polling error tracking - surface connection issues to user
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

    /// Credits load state - distinguishes error from actual 0 balance
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

    var body: some View {
        NavigationView {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 32) {
                    Spacer()

                    // Status indicator
                    statusView

                    // Player controls (when ready)
                    if case .completed = renderStatus, previewUrl != nil {
                        playerControls
                    }

                    Spacer()

                    // Bottom actions
                    bottomActions
                }
                .padding()
            }
            .navigationTitle("Your Song")
            .navigationBarTitleDisplayMode(.inline)
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
            .alert("Stream Check", isPresented: $showingStreamCheck) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(streamCheckMessage ?? "No details available.")
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
                startRender()
                fetchCredits()
                // Reset retry state on view re-entry to avoid stale backoff
                resetRetryState()
            }
            .onDisappear {
                // Cancel any running tasks
                renderTask?.cancel()
                pollingTask?.cancel()
                fullRenderTask?.cancel()
                rerollTask?.cancel()
                creditsTask?.cancel()
                stopPlayback()
                progressTimer?.invalidate()
            }
        }
    }

    // MARK: - Status View

    @ViewBuilder
    private var statusView: some View {
        switch renderStatus {
        case .idle, .rendering:
            VStack(spacing: 24) {
                // Animated waveform
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

                // Show real progress when available, "Processing..." otherwise
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
            .accessibilityValue(progress != nil ? "\(progress!)%" : "Processing")

        case .completed:
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(DesignTokens.success)

                Text("Your Song is Ready!")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(DesignTokens.textPrimary)
            }

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

    // MARK: - Player Controls

    private var playerControls: some View {
        VStack(spacing: 24) {
            // H11: Playback error with retry button
            if let error = playbackError {
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

                    if AppConfig.enableStreamDiagnostics {
                        Button {
                            runStreamCheck()
                        } label: {
                            HStack {
                                Image(systemName: "waveform.path.ecg")
                                Text(isStreamCheckRunning ? "Checking..." : "Check Stream")
                            }
                            .font(.caption.bold())
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(Color.white.opacity(0.2))
                            .cornerRadius(8)
                        }
                        .disabled(isStreamCheckRunning)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(DesignTokens.warning)
                .cornerRadius(12)
            }

            // Progress bar
            VStack(spacing: 8) {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Rectangle()
                            .fill(DesignTokens.borderSubtle)
                            .frame(height: 4)
                            .cornerRadius(2)

                        Rectangle()
                            .fill(DesignTokens.gold)
                            .frame(width: geometry.size.width * playbackProgress, height: 4)
                            .cornerRadius(2)
                    }
                }
                .frame(height: 4)

                HStack {
                    Text(formatTime(playbackTime))
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)

                    Spacer()

                    Text(duration > 0 ? formatTime(duration) : "--:--")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            // Play/Pause button
            Button {
                #if os(iOS)
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
                #endif
                togglePlayback()
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 72))
                    .foregroundColor(DesignTokens.gold)
            }
            .accessibilityLabel(isPlaying ? "Pause" : "Play")
            .accessibilityHint(isPlaying ? "Double tap to pause playback" : "Double tap to play your song")
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Bottom Actions

    private var bottomActions: some View {
        VStack(spacing: 16) {
            // Full Render button (only when preview is complete)
            if case .completed = renderStatus {
                fullRenderButton
            }

            // Reroll menu (only when preview is complete and not already rerolling)
            if case .completed = renderStatus, !isRerolling {
                rerollMenuButton
            }

            // Rerolling indicator
            if isRerolling {
                HStack {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                        .scaleEffect(0.8)
                        .accessibilityLabel("Creating new version")
                    Text("Creating new version...")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(DesignTokens.gold.opacity(0.15))
                .cornerRadius(12)
                .accessibilityElement(children: .combine)
            }

            // Create another song button
            if case .completed = renderStatus, case .completed = fullRenderStatus {
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .medium)
                    generator.impactOccurred()
                    onNewSong()
                } label: {
                    HStack {
                        Spacer()
                        Image(systemName: "plus.circle.fill")
                        Text("Create Another Song")
                        Spacer()
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding()
                    .background(DesignTokens.gold)
                    .cornerRadius(12)
                }
            }

            // Share button (only when full render is complete)
            if case .completed = renderStatus, case .completed = fullRenderStatus {
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .light)
                    generator.impactOccurred()
                    showingShareSheet = true
                } label: {
                    HStack {
                        Spacer()
                        Image(systemName: "gift.fill")
                        Text("Share with \(recipientName.isEmpty ? "Recipient" : recipientName)")
                        Spacer()
                    }
                    .font(.headline)
                    .foregroundColor(DesignTokens.gold)
                    .padding()
                    .background(DesignTokens.gold.opacity(0.15))
                    .cornerRadius(12)
                }
            }

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
        }
    }

    // MARK: - Reroll Menu

    private var rerollMenuButton: some View {
        Menu {
            ForEach(RerollType.allCases, id: \.rawValue) { rerollType in
                Button {
                    performReroll(type: rerollType)
                } label: {
                    Label(rerollType.description, systemImage: rerollType.iconName)
                }
            }
        } label: {
            HStack {
                Spacer()
                Image(systemName: "arrow.triangle.2.circlepath")
                Text("Try Different Version")
                Spacer()
            }
            .font(.subheadline)
            .foregroundColor(DesignTokens.gold)
            .padding()
            .background(DesignTokens.gold.opacity(0.15))
            .cornerRadius(12)
        }
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
                    fetchCredits()  // Retry on tap
                case .loading:
                    break  // Wait for load
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
                    .accessibilityLabel("Creating full song")
                Text("Creating full song...")
                    .font(.headline)
                Spacer()
            }
            .foregroundColor(.white)
            .padding()
            .background(DesignTokens.gold.opacity(0.7))
            .cornerRadius(12)
            .accessibilityElement(children: .combine)

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

    /// Credits status text - shows balance, loading, or error with retry hint
    @ViewBuilder
    private var creditsStatusText: some View {
        switch creditsLoadState {
        case .loading:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.6)
                    .tint(.white)
                    .accessibilityLabel("Loading credits")
                Text("Loading credits...")
            }
            .font(.caption)
            .opacity(0.9)
            .accessibilityElement(children: .combine)
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

    // MARK: - Actions

    private func startRender() {
        renderStatus = .rendering
        progress = nil  // Unknown progress until server reports
        renderStepMessage = nil
        pollingFailureCount = 0  // Reset for retry attempts
        pollingError = nil

        renderTask = Task {
            do {
                // Resume existing render if possible
                if await resumeExistingRender() {
                    return
                }
                // Start the render
                let response = try await apiClient.renderPreview(
                    trackId: trackId,
                    versionNum: versionNum
                )

                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.jobId = jobId
                    await pollForCompletion(jobId: jobId)
                } else {
                    // Already completed?
                    _ = await checkTrackStatus()
                }

            } catch {
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
            let response = try await apiClient.getTrack(trackId: trackId)

            // Store track info for share sheet
            await MainActor.run {
                self.trackTitle = response.track.title
                self.recipientName = response.track.recipientName ?? ""
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if let url = version.previewUrl ?? version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    await MainActor.run {
                        self.previewUrl = transformedUrl
                        self.progress = 100
                        self.renderStatus = .completed
                        setupPlayer(url: transformedUrl)
                        fetchCredits()  // Refresh balance after render
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
            // Log the error but continue - this is expected on first load when no existing render exists
            print("[TrackPlayerView] Resume existing render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func pollForCompletion(jobId: String) async {
        // H10: Exponential backoff for job polling (see PollingConfig)
        var elapsed: UInt64 = 0

        while elapsed < PollingConfig.previewMaxDurationNs {
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            // Select appropriate backoff interval based on elapsed time
            let intervalIndex = PollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = PollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            // Check again after sleep
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

                await MainActor.run {
                    // Only show real progress from server, not fake estimates
                    self.progress = status.progress
                    self.renderStepMessage = renderMessage(for: status)
                    // Reset failure count on successful poll
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
                    // Still processing
                    continue
                }

            } catch {
                guard !Task.isCancelled else { return }

                // Track consecutive polling failures
                await MainActor.run {
                    pollingFailureCount += 1
                }

                // Surface error to user after max failures
                if pollingFailureCount >= maxPollingFailures {
                    // Before giving up, check if the track actually completed
                    // (job status API may fail while track completed successfully)
                    if await checkTrackStatus(setFailureOnMissing: false) {
                        return  // Track was ready! Don't show error.
                    }

                    await MainActor.run {
                        pollingError = "Unable to check status. Please check your connection."
                        renderStatus = .failed("Connection error after \(maxPollingFailures) attempts")
                    }
                    return
                }

                // Wait before retry (2 second backoff for error recovery)
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            }
        }

        // Timeout (only show if not cancelled)
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
            let response = try await apiClient.getTrack(trackId: trackId)

            // Store track info for share sheet
            await MainActor.run {
                self.trackTitle = response.track.title
                self.recipientName = response.track.recipientName ?? ""
            }

            // Find the version
            if let version = response.versions.first(where: { $0.versionNum == versionNum }),
               let url = version.previewUrl ?? version.fullUrl {
                // Transform localhost URL to actual server IP
                let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                await MainActor.run {
                    self.previewUrl = transformedUrl
                    self.progress = 100
                    self.renderStatus = .completed
                    setupPlayer(url: transformedUrl)
                    fetchCredits()  // Refresh balance after render
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

        } catch {
            if setFailureOnMissing {
                await MainActor.run {
                    renderStatus = .failed(error.localizedDescription)
                }
            }
            return false
        }
    }

    // MARK: - Credits & Full Render

    private func fetchCredits() {
        creditsTask?.cancel()
        creditsLoadState = .loading

        creditsTask = Task {
            do {
                let response = try await apiClient.getEntitlements()

                guard !Task.isCancelled else { return }

                await MainActor.run {
                    creditsLoadState = .loaded(response.entitlements?.creditsBalance ?? 0)
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                // Show error state - don't mislead user with 0
                await MainActor.run {
                    creditsLoadState = .error("Couldn't load credits")
                }
            }
        }
    }

    private func startFullRender() {
        fullRenderStatus = .rendering
        renderStepMessage = nil
        pollingFailureCount = 0  // Reset for retry attempts

        fullRenderTask = Task {
            do {
                if await resumeExistingFullRender() {
                    return
                }
                let response = try await apiClient.renderFull(
                    trackId: trackId,
                    versionNum: versionNum
                )

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
                    // Refresh credits in case they weren't consumed
                    fetchCredits()
                }
            }
        }
    }

    private func resumeExistingFullRender() async -> Bool {
        do {
            let track = try await apiClient.getTrack(trackId: trackId)
            if let version = track.versions.first(where: { $0.versionNum == versionNum }) {
                if let url = version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    await MainActor.run {
                        fullUrl = transformedUrl
                        fullRenderStatus = .completed
                        stopPlayback()
                        setupPlayer(url: transformedUrl)
                        fetchCredits()  // Refresh balance after full render
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
            // Log the error but continue - this is expected on first full render
            print("[TrackPlayerView] Resume existing full render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func pollForFullRenderCompletion(jobId: String) async {
        // H10: Exponential backoff for job polling (see PollingConfig)
        var elapsed: UInt64 = 0

        while elapsed < PollingConfig.fullRenderMaxDurationNs {
            guard !Task.isCancelled else { return }

            // Select appropriate backoff interval based on elapsed time
            let intervalIndex = PollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = PollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

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
                        fetchCredits()  // Refresh credits (may have been refunded)
                    }
                    return

                default:
                    continue
                }

            } catch {
                guard !Task.isCancelled else { return }

                // Track consecutive polling failures (same pattern as preview polling)
                await MainActor.run {
                    pollingFailureCount += 1
                }

                // Surface error after max failures
                if pollingFailureCount >= maxPollingFailures {
                    await MainActor.run {
                        fullRenderStatus = .failed("Connection error. Check your network and try again.")
                        fetchCredits()  // Refresh credits in case they weren't consumed
                    }
                    return
                }

                // Wait before retry
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
            let track = try await apiClient.getTrack(trackId: trackId)

            if let version = track.versions.first(where: { $0.versionNum == versionNum }),
               let url = version.fullUrl {
                let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                await MainActor.run {
                    fullUrl = transformedUrl
                    fullRenderStatus = .completed
                    // Update player to use full version
                    stopPlayback()
                    setupPlayer(url: transformedUrl)
                    fetchCredits()  // Refresh balance after full render
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
            return "Waiting on the music provider…"
        }
        switch step {
        case "moderation":
            return "Checking content safety…"
        case "lyrics":
            return "Writing lyrics…"
        case "music_plan":
            return "Planning the music…"
        case "instrumental", "instrumental_full":
            return isFull ? "Generating the full instrumental…" : "Generating the instrumental…"
        case "guide_vocal", "guide_vocal_full":
            return isFull ? "Preparing the full guide vocal…" : "Preparing the guide vocal…"
        case "voice_convert", "voice_convert_sections":
            return "Shaping the vocal performance…"
        case "mix":
            return "Mixing vocals and instrumental…"
        case "watermark":
            return "Finalizing your song…"
        case "ready":
            return "Final touches…"
        default:
            return "Processing…"
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
                let response = try await apiClient.reroll(
                    trackId: trackId,
                    versionNum: versionNum,
                    rerollType: type
                )

                guard !Task.isCancelled else { return }

                await MainActor.run {
                    isRerolling = false
                    // Navigate to the new version
                    if let onRerollComplete = onRerollComplete {
                        ToastService.shared.success("New version created!")
                        onRerollComplete(response.newVersionNum)
                    } else {
                        // If no callback provided, just show success toast
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

        // CRITICAL: Configure audio session BEFORE creating AVPlayerItem
        // AVPlayerItem begins HTTP loading immediately on init - if audio session
        // isn't ready, the load fails with -11849 "Operation Stopped"
        if !ensureAudioSessionActive() {
            print("[Audio] WARNING: Could not configure audio session, playback may fail")
        }

        guard let audioUrl = URL(string: url) else {
            print("[Audio] ERROR: Invalid URL string")
            ToastService.shared.error("Invalid audio URL")
            return
        }
        print("[Audio] Parsed URL - scheme: \(audioUrl.scheme ?? "nil"), host: \(audioUrl.host ?? "nil"), path: \(audioUrl.path)")

        let playerItem = AVPlayerItem(url: audioUrl)
        player = AVPlayer(playerItem: playerItem)
        playbackTime = 0
        playbackProgress = 0
        duration = 0
        configureNowPlaying()
        updateNowPlayingMetadata()
        playerItemStatusObserver?.invalidate()
        playerItemStatusObserver = playerItem.observe(\.status, options: [.initial, .new]) { item, _ in
            print("[Audio] PlayerItem status changed: \(item.status.rawValue) (0=unknown, 1=ready, 2=failed)")
            switch item.status {
            case .readyToPlay:
                let itemDuration = item.duration.seconds
                print("[Audio] PlayerItem ready to play, duration: \(itemDuration)s")
                if itemDuration.isFinite && itemDuration > 0 {
                    Task { @MainActor in
                        self.duration = itemDuration
                        NowPlayingManager.shared.updateMetadata(
                            NowPlayingMetadata(title: self.trackTitle, artist: self.nowPlayingArtist),
                            duration: itemDuration
                        )
                        // Reset retry backoff on successful load
                        self.resetRetryState()
                    }
                }
            case .failed:
                // Map specific error codes to user-friendly messages
                let userMessage: String
                var shouldAttemptRecovery = false

                if let error = item.error as NSError? {
                    print("[Audio] PlayerItem FAILED: \(error.localizedDescription)")
                    print("[Audio] Error domain: \(error.domain), code: \(error.code)")
                    print("[Audio] Error userInfo: \(error.userInfo)")

                    // Check for media services reset error (-11849)
                    // This often occurs when audio session wasn't ready or was interrupted
                    if error.domain == AVFoundationErrorDomain && error.code == -11849 {
                        print("[Audio] Detected media services reset error - will attempt recovery")
                        shouldAttemptRecovery = true
                    }

                    // Also check underlying error for CoreMedia issues
                    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
                        print("[Audio] Underlying error: \(underlying.domain) code \(underlying.code)")
                        // -12873 is often media pipeline not ready
                        if underlying.code == -12873 {
                            shouldAttemptRecovery = true
                        }
                    }

                    // Map network errors to helpful messages
                    if error.domain == NSURLErrorDomain {
                        switch error.code {
                        case NSURLErrorNotConnectedToInternet:
                            userMessage = "No internet connection. Check your network and try again."
                        case NSURLErrorTimedOut:
                            userMessage = "Connection timed out. Try again."
                        case NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost:
                            userMessage = "Cannot reach server. Check your connection."
                        case NSURLErrorNetworkConnectionLost:
                            userMessage = "Connection lost. Try again."
                        case NSURLErrorResourceUnavailable, NSURLErrorFileDoesNotExist:
                            userMessage = "Audio file not found. Try regenerating the song."
                        case NSURLErrorHTTPTooManyRedirects:
                            userMessage = "Server error. Please try again later."
                        case NSURLErrorBadServerResponse:
                            // HTTP 4xx/5xx errors
                            userMessage = "Server returned an error. Please try again later."
                        case NSURLErrorUserAuthenticationRequired:
                            userMessage = "Authentication required. Please sign in again."
                        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
                            userMessage = "Secure connection failed. Check your network."
                        default:
                            userMessage = "Network error (\(error.code)). Try again."
                        }
                    } else if error.domain == AVFoundationErrorDomain {
                        // AVFoundation-specific errors
                        switch error.code {
                        case AVError.fileFormatNotRecognized.rawValue:
                            userMessage = "Audio format not supported. Try regenerating."
                        case AVError.decodeFailed.rawValue:
                            userMessage = "Failed to decode audio. Try regenerating."
                        case AVError.contentIsNotAuthorized.rawValue:
                            userMessage = "Audio access denied. Sign in again."
                        case AVError.serverIncorrectlyConfigured.rawValue:
                            userMessage = "Server configuration error. Please try again later."
                        case AVError.noLongerPlayable.rawValue:
                            userMessage = "Audio file is corrupted. Try regenerating the song."
                        case AVError.failedToLoadMediaData.rawValue:
                            userMessage = "Download incomplete. Check your connection and try again."
                        default:
                            userMessage = "Playback error (\(error.code)). Try again."
                        }
                    } else if error.domain == NSOSStatusErrorDomain || error.domain == "com.apple.CoreMedia" {
                        // CoreMedia errors - often related to memory or buffer issues
                        userMessage = "Media processing error (\(error.code)). Try again."
                    } else {
                        // Unknown domain - show generic but include code for debugging
                        userMessage = "Unable to play audio (Error \(error.code))."
                    }
                } else {
                    userMessage = "Unable to play this audio."
                    print("[Audio] PlayerItem FAILED with no error details")
                }

                // H11: Set playback error for retry UI, or attempt automatic recovery
                let shouldRecover = shouldAttemptRecovery
                Task { @MainActor in
                    self.isPlaying = false

                    if shouldRecover && self.retryAttemptCount < 2 {
                        // Attempt automatic recovery for media services errors
                        self.retryAttemptCount += 1
                        self.recoverFromMediaServicesReset()
                    } else {
                        // Show error to user with retry option
                        self.playbackError = userMessage
                    }
                }
            case .unknown:
                print("[Audio] PlayerItem status is unknown (still loading)")
            @unknown default:
                print("[Audio] PlayerItem status is @unknown default")
            }
        }

        // Load duration asynchronously (deprecated sync property replaced with async load)
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
                // Duration unavailable - player will still work, progress just won't show
                print("Could not load duration: \(error.localizedDescription)")
            }
        }

        // Add periodic time observer (store token for cleanup)
        // Note: SwiftUI Views are structs, so closures capture self by value (no retain cycle)
        timeObserverToken = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { time in
            let timeSeconds = time.seconds
            guard timeSeconds.isFinite else { return }
            playbackTime = timeSeconds
            if duration > 0 {
                playbackProgress = min(1, timeSeconds / duration)
            }
            Task { @MainActor in
                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: isPlaying,
                    elapsed: timeSeconds,
                    duration: duration > 0 ? duration : nil
                )
            }
        }

        // Observe when playback ends (store token for cleanup)
        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { _ in
            isPlaying = false
            playbackProgress = 0
            playbackTime = 0
            player?.seek(to: .zero)
            Task { @MainActor in
                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: false,
                    elapsed: 0,
                    duration: duration > 0 ? duration : nil
                )
            }
        }
    }

    // H11: Retry playback after failure with backoff
    private func retryPlayback() {
        // Implement retry backoff to prevent spam
        if let lastRetry = lastRetryTime {
            let elapsed = Date().timeIntervalSince(lastRetry)
            // Exponential backoff: 2s, 4s, 8s, capped at 16s
            let requiredInterval = min(minRetryIntervalSeconds * pow(2.0, Double(retryAttemptCount)), 16.0)
            if elapsed < requiredInterval {
                let waitTime = Int(ceil(requiredInterval - elapsed))
                // Preserve original error context while showing wait requirement
                if let existingError = playbackError, !existingError.contains("wait") {
                    playbackError = "\(existingError) (wait \(waitTime)s)"
                } else if playbackError == nil || playbackError?.contains("wait") == true {
                    playbackError = "Please wait \(waitTime)s before retrying"
                }
                return
            }
        }

        // Track retry attempts
        lastRetryTime = Date()
        retryAttemptCount += 1
        playbackError = nil

        // Determine which URL to retry
        let urlToRetry: String?
        if fullUrl != nil {
            urlToRetry = fullUrl
        } else {
            urlToRetry = previewUrl
        }

        guard let url = urlToRetry else {
            playbackError = "No audio URL available"
            return
        }

        // Re-setup the player
        setupPlayer(url: url)
    }

    // Reset retry state on successful playback
    private func resetRetryState() {
        retryAttemptCount = 0
        lastRetryTime = nil
    }

    private func runStreamCheck() {
        guard AppConfig.enableStreamDiagnostics else { return }
        isStreamCheckRunning = true

        Task {
            do {
                let response = try await apiClient.streamCheck(trackId: trackId, versionNum: versionNum)
                let message = formatStreamCheckMessage(response)
                await MainActor.run {
                    streamCheckMessage = message
                    showingStreamCheck = true
                    isStreamCheckRunning = false
                }
            } catch {
                await MainActor.run {
                    streamCheckMessage = "Stream check failed: \(error.localizedDescription)"
                    showingStreamCheck = true
                    isStreamCheckRunning = false
                }
            }
        }
    }

    private func formatStreamCheckMessage(_ response: StreamCheckResponse) -> String {
        var lines: [String] = []
        lines.append("Storage: \(response.storage)")
        lines.append("Version: \(response.versionNum)")

        if let preview = response.preview {
            let status = preview.exists == true ? "exists" : "missing"
            lines.append("Preview: \(status)")
            lines.append(shortenUrl(preview.url))
        }

        if let full = response.full {
            let status = full.exists == true ? "exists" : "missing"
            lines.append("Full: \(status)")
            lines.append(shortenUrl(full.url))
        }

        return lines.joined(separator: "\n")
    }

    private func shortenUrl(_ url: String?) -> String {
        guard let url else { return "URL: none" }
        guard let parsed = URL(string: url) else { return url }
        let host = parsed.host ?? "unknown-host"
        return "URL: \(host)\(parsed.path)"
    }

    private func togglePlayback() {
        guard let player = player else {
            print("[Audio] togglePlayback: No player available")
            ToastService.shared.error("Player not initialized")
            return
        }

        if isPlaying {
            player.pause()
            print("[Audio] Paused playback")
            NowPlayingManager.shared.updatePlaybackState(isPlaying: false, elapsed: playbackTime, duration: duration > 0 ? duration : nil)
        } else {
            // Ensure audio session is still active (may have been interrupted)
            // Primary configuration happens in setupPlayer(), this is a safety check
            if !ensureAudioSessionActive() {
                ToastService.shared.error("Could not activate audio")
                return
            }

            // Check player item status before playing
            if let currentItem = player.currentItem {
                print("[Audio] PlayerItem status: \(currentItem.status.rawValue) (0=unknown, 1=ready, 2=failed)")
                print("[Audio] Current time: \(player.currentTime().seconds)s")
                if let error = currentItem.error {
                    print("[Audio] PlayerItem error: \(error.localizedDescription)")
                    ToastService.shared.error("Cannot play: \(error.localizedDescription)")
                    return
                }
            }

            // Check player rate before and after play()
            print("[Audio] Player rate before play(): \(player.rate)")
            player.play()
            print("[Audio] Player rate after play(): \(player.rate)")
            NowPlayingManager.shared.updatePlaybackState(isPlaying: true, elapsed: playbackTime, duration: duration > 0 ? duration : nil)

            // If rate is still 0 after play(), something is wrong
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if player.rate == 0 && self.isPlaying {
                    print("[Audio] WARNING: Player rate is 0 after 0.5s - playback may have failed silently")
                }
            }
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
        // Remove time observer before releasing player
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
        // Remove notification observer to prevent memory leak
        if let observer = playbackEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackEndObserver = nil
        }
    }

    // MARK: - Audio Session Management

    /// Ensures AVAudioSession is configured and active before audio operations.
    /// Must be called BEFORE creating AVPlayerItem to prevent -11849 errors.
    /// Returns true if session is ready, false if configuration failed.
    private func ensureAudioSessionActive() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()

            // Only reconfigure if needed (avoid unnecessary interruptions)
            if session.category != .playback {
                try session.setCategory(.playback, mode: .default, options: [])
                print("[Audio] Audio session category set to playback")
            }

            // Activate the session
            try session.setActive(true)
            print("[Audio] Audio session activated successfully")
            return true
        } catch {
            print("[Audio] Failed to configure audio session: \(error)")
            return false
        }
    }

    /// Attempts recovery after media services reset (error -11849).
    /// Resets audio session and retries playback with the current URL.
    private func recoverFromMediaServicesReset() {
        print("[Audio] Attempting recovery from media services reset")

        // Determine which URL to retry
        let urlToRetry = fullUrl ?? previewUrl
        guard let url = urlToRetry else {
            print("[Audio] No URL available for recovery")
            return
        }

        // Deactivate current session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("[Audio] Failed to deactivate session during recovery: \(error)")
        }

        // Brief delay to allow system to reset
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            // Re-setup player (which will re-activate session)
            self.setupPlayer(url: url)
        }
    }

}

#Preview {
    TrackPlayerView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        trackId: "test-track-id",
        versionNum: 1,
        onDone: { },
        onNewSong: { }
    )
}
