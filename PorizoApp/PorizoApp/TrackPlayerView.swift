//
//  TrackPlayerView.swift
//  PorizoApp
//
//  Renders and plays the generated song.
//

import SwiftUI
import AVFoundation

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
                        .stroke(Color.blue.opacity(0.2), lineWidth: 8)
                        .frame(width: 160, height: 160)

                    Circle()
                        .trim(from: 0, to: CGFloat(progress) / 100)
                        .stroke(Color.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 160, height: 160)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.5), value: progress)

                    Image(systemName: "waveform")
                        .font(.system(size: 50))
                        .foregroundColor(.blue)
                }

                Text("Creating Your Song...")
                    .font(.headline)

                Text("\(progress)%")
                    .font(.system(size: 36, weight: .light, design: .monospaced))
                    .foregroundColor(.blue)

                Text("This may take a minute")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

        case .completed:
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.green)

                Text("Your Song is Ready!")
                    .font(.title2)
                    .fontWeight(.bold)
            }

        case .failed(let error):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.orange)

                Text("Something went wrong")
                    .font(.headline)

                Text(error)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    startRender()
                } label: {
                    Label("Try Again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
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
                            .fill(Color.gray.opacity(0.3))
                            .frame(height: 4)
                            .cornerRadius(2)

                        Rectangle()
                            .fill(Color.blue)
                            .frame(width: geometry.size.width * playbackProgress, height: 4)
                            .cornerRadius(2)
                    }
                }
                .frame(height: 4)

                HStack {
                    Text(formatTime(playbackProgress * duration))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    Text(formatTime(duration))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Play/Pause button
            Button {
                togglePlayback()
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 72))
                    .foregroundColor(.blue)
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
                    .padding()
                }
                .buttonStyle(.borderedProminent)
            }

            Button {
                onDone()
            } label: {
                Text("Done")
                    .frame(maxWidth: .infinity)
                    .padding()
            }
            .buttonStyle(.bordered)
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
        let maxAttempts = 120  // 2 minutes max
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
                await MainActor.run {
                    self.previewUrl = url
                    self.progress = 100
                    self.renderStatus = .completed
                    setupPlayer(url: url)
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

        // Observe duration
        if let duration = playerItem.asset.duration.seconds.isNaN ? nil : playerItem.asset.duration.seconds {
            self.duration = duration
        }

        // Add periodic time observer
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
