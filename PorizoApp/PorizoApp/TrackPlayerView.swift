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
    @State private var progress: Int = 0

    // Full render state
    @State private var fullRenderStatus: FullRenderStatus = .notStarted
    @State private var fullUrl: String?
    @State private var creditsBalance: Int = 0
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
    @State private var duration: Double = 0

    // Error state
    @State private var showingError = false
    @State private var errorMessage = ""

    // Timer for progress updates
    @State private var progressTimer: Timer?

    // Observer tokens for proper cleanup (prevents memory leak)
    @State private var playbackEndObserver: NSObjectProtocol?
    @State private var timeObserverToken: Any?

    // Task references for proper cancellation
    @State private var renderTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?
    @State private var fullRenderTask: Task<Void, Never>?

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
                Text("This will use 1 credit. You have \(creditsBalance) credits.\n\nYou'll get the full 60-second song with higher quality audio.")
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
                        .trim(from: 0, to: CGFloat(progress) / 100)
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

                Text("\(progress)%")
                    .font(.system(size: 36, weight: .light, design: .monospaced))
                    .foregroundColor(DesignTokens.rose)

                Text("This may take a minute")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Creating your song, \(progress) percent complete")
            .accessibilityValue("\(progress)%")

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
                    Text(formatTime(playbackProgress * duration))
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)

                    Spacer()

                    Text(formatTime(duration))
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            // Play/Pause button
            Button {
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
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
                if creditsBalance > 0 {
                    showingCreditConfirmation = true
                } else {
                    errorMessage = "You need credits to get the full song. Get more credits in Settings."
                    showingError = true
                }
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "music.note.list")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Get Full Song")
                            .font(.headline)
                        Text("\(creditsBalance) credits available")
                            .font(.caption)
                            .opacity(0.9)
                    }
                    Spacer()
                }
                .foregroundColor(.white)
                .padding()
                .background(creditsBalance > 0 ? DesignTokens.rose : DesignTokens.textTertiary)
                .cornerRadius(12)
            }
            .disabled(creditsBalance == 0)

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

    // MARK: - Actions

    private func startRender() {
        renderStatus = .rendering
        progress = 0

        renderTask = Task {
            do {
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
                    await checkTrackStatus()
                }

            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    renderStatus = .failed(error.localizedDescription)
                }
            }
        }
    }

    private func pollForCompletion(jobId: String) async {
        let maxAttempts = 300  // 5 minutes max
        let pollInterval: UInt64 = 1_000_000_000  // 1 second

        for attempt in 0..<maxAttempts {
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            try? await Task.sleep(nanoseconds: pollInterval)

            // Check again after sleep
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

                await MainActor.run {
                    self.progress = status.progress ?? min(attempt * 2, 95)
                }

                switch status.status {
                case "completed":
                    await checkTrackStatus()
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
                // Continue polling on transient errors
                continue
            }
        }

        // Timeout (only show if not cancelled)
        guard !Task.isCancelled else { return }
        await MainActor.run {
            renderStatus = .failed("Render timed out. Please try again.")
        }
    }

    private func checkTrackStatus() async {
        do {
            let track = try await apiClient.getTrack(trackId: trackId)

            // Find the version
            if let version = track.versions.first(where: { $0.versionNum == versionNum }),
               let url = version.previewUrl ?? version.fullUrl {
                // Transform localhost URL to actual server IP
                let transformedUrl = transformAudioUrl(url)
                await MainActor.run {
                    self.previewUrl = transformedUrl
                    self.progress = 100
                    self.renderStatus = .completed
                    setupPlayer(url: transformedUrl)
                }
            } else {
                await MainActor.run {
                    renderStatus = .failed("Preview not ready yet")
                }
            }

        } catch {
            await MainActor.run {
                renderStatus = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Credits & Full Render

    private func fetchCredits() {
        creditsTask = Task {
            do {
                let response = try await apiClient.getEntitlements()

                guard !Task.isCancelled else { return }

                await MainActor.run {
                    creditsBalance = response.entitlements?.creditsBalance ?? 0
                }
            } catch {
                guard !Task.isCancelled else { return }
                // Default to 0 if we can't fetch (non-critical for UX)
                await MainActor.run {
                    creditsBalance = 0
                }
            }
        }
    }

    private func startFullRender() {
        fullRenderStatus = .rendering

        fullRenderTask = Task {
            do {
                let response = try await apiClient.renderFull(
                    trackId: trackId,
                    versionNum: versionNum
                )

                guard !Task.isCancelled else { return }

                fullRenderJobId = response.jobId
                await pollForFullRenderCompletion(jobId: response.jobId)

            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    fullRenderStatus = .failed(error.localizedDescription)
                    // Refresh credits in case they weren't consumed
                    fetchCredits()
                }
            }
        }
    }

    private func pollForFullRenderCompletion(jobId: String) async {
        let maxAttempts = 360  // 6 minutes max for full render
        let pollInterval: UInt64 = 1_000_000_000  // 1 second

        for _ in 0..<maxAttempts {
            guard !Task.isCancelled else { return }

            try? await Task.sleep(nanoseconds: pollInterval)

            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)

                switch status.status {
                case "completed":
                    await checkFullRenderStatus()
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
        await MainActor.run {
            fullRenderStatus = .failed("Full render timed out. Please try again.")
        }
    }

    private func checkFullRenderStatus() async {
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
                }
            } else {
                await MainActor.run {
                    fullRenderStatus = .failed("Full render not ready")
                }
            }

        } catch {
            await MainActor.run {
                fullRenderStatus = .failed(error.localizedDescription)
            }
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
        guard let audioUrl = URL(string: url) else { return }

        let playerItem = AVPlayerItem(url: audioUrl)
        player = AVPlayer(playerItem: playerItem)

        // Load duration asynchronously (deprecated sync property replaced with async load)
        Task {
            do {
                let loadedDuration = try await playerItem.asset.load(.duration)
                let durationSeconds = loadedDuration.seconds
                if !durationSeconds.isNaN {
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
            guard duration > 0 else { return }
            playbackProgress = time.seconds / duration
        }

        // Observe when playback ends (store token for cleanup)
        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { _ in
            isPlaying = false
            playbackProgress = 0
            player?.seek(to: .zero)
        }
    }

    private func togglePlayback() {
        guard let player = player else { return }

        if isPlaying {
            player.pause()
        } else {
            // Configure audio session for playback
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
        }

        isPlaying.toggle()
    }

    private func stopPlayback() {
        // Remove time observer before releasing player
        if let token = timeObserverToken, let currentPlayer = player {
            currentPlayer.removeTimeObserver(token)
            timeObserverToken = nil
        }
        player?.pause()
        player = nil
        isPlaying = false
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

    /// Transform audio URL to use the actual server base URL
    /// The server stores URLs with localhost:3000, but we need the actual server IP
    private func transformAudioUrl(_ urlString: String) -> String {
        guard let storedUrl = URL(string: urlString),
              let path = storedUrl.path.isEmpty ? nil : storedUrl.path else {
            return urlString
        }
        return apiClient.baseURL + path
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
