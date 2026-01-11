//
//  TrackPlayerView.swift
//  PorizoApp
//
//  Renders and plays the generated song.
//  Light mode design with rose accents.
//

import SwiftUI
import AVFoundation

// DesignTokens are now in DesignTokens.swift

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
                        .stroke(DesignTokens.roseMuted, lineWidth: 8)
                        .frame(width: 160, height: 160)

                    Circle()
                        .trim(from: 0, to: CGFloat(progress ?? 0) / 100)
                        .stroke(DesignTokens.rose, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 160, height: 160)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.5), value: progress)

                    Image(systemName: "waveform")
                        .font(.system(size: 50))
                        .foregroundColor(DesignTokens.rose)
                }

                Text("Creating Your Song...")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                // Show real progress when available, "Processing..." otherwise
                if let actualProgress = progress {
                    Text("\(actualProgress)%")
                        .font(.system(size: 36, weight: .light, design: .monospaced))
                        .foregroundColor(DesignTokens.rose)
                } else {
                    Text("Processing...")
                        .font(.system(size: 24, weight: .light))
                        .foregroundColor(DesignTokens.rose)
                }

                Text("This may take a minute")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
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
                    .foregroundColor(DesignTokens.rose)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.roseMuted)
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
                            .fill(DesignTokens.cardBorder)
                            .frame(height: 4)
                            .cornerRadius(2)

                        Rectangle()
                            .fill(DesignTokens.rose)
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
                    .foregroundColor(DesignTokens.rose)
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
                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.rose))
                        .scaleEffect(0.8)
                    Text("Creating new version...")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(DesignTokens.roseMuted)
                .cornerRadius(12)
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
                    .background(DesignTokens.rose)
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
                    .foregroundColor(DesignTokens.rose)
                    .padding()
                    .background(DesignTokens.roseMuted)
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
                    .background(DesignTokens.backgroundSubtle)
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.cardBorder, lineWidth: 1)
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
            .foregroundColor(DesignTokens.rose)
            .padding()
            .background(DesignTokens.roseMuted)
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
                .background(creditsLoadState.balance > 0 ? DesignTokens.rose : DesignTokens.textTertiary)
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
            .background(DesignTokens.rose.opacity(0.7))
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

    /// Credits status text - shows balance, loading, or error with retry hint
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

    // MARK: - Actions

    private func startRender() {
        renderStatus = .rendering
        progress = nil  // Unknown progress until server reports
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
                    let transformedUrl = transformAudioUrl(url)
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
            // Ignore and allow render to start
        }
        return false
    }

    private func pollForCompletion(jobId: String) async {
        // H10: Exponential backoff for job polling: 1s, 2s, 5s, 10s, 30s (max)
        let backoffIntervals: [UInt64] = [
            1_000_000_000,   // 1s
            2_000_000_000,   // 2s
            5_000_000_000,   // 5s
            10_000_000_000,  // 10s
            30_000_000_000   // 30s (max)
        ]
        let maxDuration: UInt64 = 5 * 60 * 1_000_000_000  // 5 minutes max
        var elapsed: UInt64 = 0

        while elapsed < maxDuration {
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            // Select appropriate backoff interval based on elapsed time
            let intervalIndex = min(Int(elapsed / 10_000_000_000), backoffIntervals.count - 1)
            let pollInterval = backoffIntervals[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            // Check again after sleep
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

                await MainActor.run {
                    // Only show real progress from server, not fake estimates
                    self.progress = status.progress
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
                let transformedUrl = transformAudioUrl(url)
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
                    let transformedUrl = transformAudioUrl(url)
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
            // Ignore and allow render to start
        }
        return false
    }

    private func pollForFullRenderCompletion(jobId: String) async {
        // H10: Exponential backoff for job polling: 1s, 2s, 5s, 10s, 30s (max)
        let backoffIntervals: [UInt64] = [
            1_000_000_000,   // 1s
            2_000_000_000,   // 2s
            5_000_000_000,   // 5s
            10_000_000_000,  // 10s
            30_000_000_000   // 30s (max)
        ]
        let maxDuration: UInt64 = 6 * 60 * 1_000_000_000  // 6 minutes max for full render
        var elapsed: UInt64 = 0

        while elapsed < maxDuration {
            guard !Task.isCancelled else { return }

            // Select appropriate backoff interval based on elapsed time
            let intervalIndex = min(Int(elapsed / 10_000_000_000), backoffIntervals.count - 1)
            let pollInterval = backoffIntervals[intervalIndex]

            try? await Task.sleep(nanoseconds: pollInterval)
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

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
                let transformedUrl = transformAudioUrl(url)
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
                    }
                }
            case .failed:
                let message = item.error?.localizedDescription ?? "Unable to play this audio."
                print("[Audio] PlayerItem FAILED: \(message)")
                if let error = item.error as NSError? {
                    print("[Audio] Error domain: \(error.domain), code: \(error.code)")
                    print("[Audio] Error userInfo: \(error.userInfo)")
                }
                // H11: Set playback error for retry UI
                Task { @MainActor in
                    self.isPlaying = false
                    self.playbackError = message
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
        }
    }

    // H11: Retry playback after failure
    private func retryPlayback() {
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

    private func togglePlayback() {
        guard let player = player else {
            print("[Audio] togglePlayback: No player available")
            ToastService.shared.error("Player not initialized")
            return
        }

        if isPlaying {
            player.pause()
            print("[Audio] Paused playback")
        } else {
            // Configure audio session for playback with proper error handling
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [])
                try session.setActive(true)
                print("[Audio] Audio session configured successfully")

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

                // If rate is still 0 after play(), something is wrong
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    if player.rate == 0 && self.isPlaying {
                        print("[Audio] WARNING: Player rate is 0 after 0.5s - playback may have failed silently")
                    }
                }
            } catch {
                print("[Audio] Audio session error: \(error.localizedDescription)")
                ToastService.shared.error("Audio error: \(error.localizedDescription)")
                return
            }
        }

        isPlaying.toggle()
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
        // Remove notification observer to prevent memory leak
        if let observer = playbackEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackEndObserver = nil
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        guard !seconds.isNaN && seconds.isFinite else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }

    /// C9: Transform audio URLs from backend format to client-accessible URLs
    /// Backend may return localhost URLs in development - transform to actual API host
    private func transformAudioUrl(_ urlString: String) -> String {
        guard let storedUrl = URL(string: urlString) else {
            print("[Audio] transformAudioUrl: Invalid URL string: \(urlString)")
            return urlString
        }

        // Only transform URLs that are localhost/127.0.0.1
        // Production URLs from backend should be returned as-is
        guard let host = storedUrl.host else {
            // Relative URL - prepend base URL
            return apiClient.baseURL + urlString
        }

        let isLocalhost = host == "localhost" || host == "127.0.0.1"
        guard isLocalhost else {
            // Non-localhost URL - use as-is (production URL)
            return urlString
        }

        // Transform localhost URL to use client's configured API host
        let path = storedUrl.path
        guard !path.isEmpty else {
            print("[Audio] transformAudioUrl: Empty path in URL: \(urlString)")
            return urlString
        }

        let result = apiClient.baseURL + path

        // Validate the transformed URL is valid
        guard URL(string: result) != nil else {
            print("[Audio] transformAudioUrl: Transformed URL is invalid: \(result)")
            return urlString  // Fall back to original
        }

        return result
    }
}

#Preview {
    TrackPlayerView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        trackId: "test-track-id",
        versionNum: 1,
        onDone: { },
        onNewSong: { }
    )
}
