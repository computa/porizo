//
//  TrackPlayerView.swift
//  PorizoApp
//
//  Renders and plays the generated song.
//  Light mode design with rose accents.
//

import SwiftUI
import AVFoundation

// Reference DesignTokens from MainTabView.swift

struct TrackPlayerView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let onDone: () -> Void
    let onNewSong: () -> Void

    // Render state
    @State private var renderStatus: RenderStatus = .idle
    @State private var jobId: String?
    @State private var previewUrl: String?
    @State private var progress: Int = 0

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

    enum RenderStatus {
        case idle
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
            .onAppear {
                startRender()
            }
            .onDisappear {
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
                togglePlayback()
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 72))
                    .foregroundColor(DesignTokens.rose)
            }
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Bottom Actions

    private var bottomActions: some View {
        VStack(spacing: 16) {
            if case .completed = renderStatus {
                Button {
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

    // MARK: - Actions

    private func startRender() {
        renderStatus = .rendering
        progress = 0

        Task {
            do {
                // Start the render
                let response = try await apiClient.renderPreview(
                    trackId: trackId,
                    versionNum: versionNum
                )

                if let jobId = response.jobId {
                    self.jobId = jobId
                    await pollForCompletion(jobId: jobId)
                } else {
                    // Already completed?
                    await checkTrackStatus()
                }

            } catch {
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
            try? await Task.sleep(nanoseconds: pollInterval)

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

        // Timeout
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

        // Add periodic time observer
        // Note: SwiftUI Views are structs, so closures capture self by value (no retain cycle)
        player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { time in
            guard duration > 0 else { return }
            playbackProgress = time.seconds / duration
        }

        // Observe when playback ends
        NotificationCenter.default.addObserver(
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
        player?.pause()
        player = nil
        isPlaying = false
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
