//
//  PlayerComponents.swift
//  PorizoApp
//
//  Mini player bar and full now playing view with lyrics display.
//  Editorial/magazine aesthetic with smooth transitions.
//

import SwiftUI
import UIKit
import AVFoundation
import Combine

// MARK: - Player State (Shared across components)

/// Observable player state for sharing between mini player and full view
class PlayerState: ObservableObject {
    @Published var currentTrack: Track?
    @Published var currentVersion: TrackVersion?
    @Published var isPlaying = false
    @Published var isLoading = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var lyrics: Lyrics?

    // Audio player (managed internally)
    private var audioPlayer: AVAudioPlayer?
    private var playbackTimer: Timer?

    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    var formattedCurrentTime: String {
        formatTime(currentTime)
    }

    var formattedDuration: String {
        formatTime(duration)
    }

    // MARK: - Playback Control

    /// Load and play audio from data
    func loadAndPlay(data: Data, track: Track, version: TrackVersion?) {
        // Stop any existing playback
        stopPlayback()

        do {
            // Configure audio session
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)

            // Create player
            let player = try AVAudioPlayer(data: data)
            player.prepareToPlay()
            audioPlayer = player

            // Update state
            currentTrack = track
            currentVersion = version
            duration = player.duration
            lyrics = version?.lyricsJson
            isLoading = false

            // Start playback
            if player.play() {
                isPlaying = true
                startPlaybackTimer()
                print("[PlayerState] Playback started")
            } else {
                print("[PlayerState] play() returned false")
                Task { @MainActor in
                    ToastService.shared.error("Failed to start playback")
                }
            }
        } catch {
            print("[PlayerState] Error: \(error.localizedDescription)")
            Task { @MainActor in
                ToastService.shared.error("Audio error: \(error.localizedDescription)")
            }
            isLoading = false
        }
    }

    /// Toggle play/pause
    func togglePlayback() {
        guard let player = audioPlayer else {
            print("[PlayerState] No player available")
            return
        }

        if isPlaying {
            player.pause()
            isPlaying = false
            stopPlaybackTimer()
            print("[PlayerState] Paused")
        } else {
            if player.play() {
                isPlaying = true
                startPlaybackTimer()
                print("[PlayerState] Resumed")
            }
        }
    }

    /// Seek to specific time
    func seekTo(time: TimeInterval) {
        audioPlayer?.currentTime = time
        currentTime = time
    }

    /// Stop playback and reset state
    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        stopPlaybackTimer()

        currentTrack = nil
        currentVersion = nil
        isPlaying = false
        isLoading = false
        currentTime = 0
        duration = 0
        lyrics = nil
    }

    /// Set loading state when starting to load
    func setLoading(track: Track) {
        isLoading = true
        currentTrack = track
    }

    // MARK: - Timer

    private func startPlaybackTimer() {
        stopPlaybackTimer()
        playbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let player = self.audioPlayer else { return }

            DispatchQueue.main.async {
                self.currentTime = player.currentTime

                // Check if playback ended
                if !player.isPlaying && self.currentTime >= self.duration - 0.5 {
                    self.isPlaying = false
                    self.currentTime = 0
                    self.stopPlaybackTimer()
                }
            }
        }
    }

    private func stopPlaybackTimer() {
        playbackTimer?.invalidate()
        playbackTimer = nil
    }

    deinit {
        stopPlayback()
    }
}

// MARK: - Mini Player Bar

/// Floating mini player bar - modern card style above tab bar
struct MiniPlayerBar: View {
    @ObservedObject var playerState: PlayerState
    let onTap: () -> Void
    let onPlayPause: () -> Void
    let onClose: () -> Void

    @State private var isPressed = false

    var body: some View {
        VStack(spacing: 0) {
            // Main content card
            HStack(spacing: 12) {
                // Album art with progress ring
                ZStack {
                    // Progress ring background
                    Circle()
                        .stroke(DesignTokens.cardBorder, lineWidth: 3)
                        .frame(width: 52, height: 52)

                    // Progress ring
                    Circle()
                        .trim(from: 0, to: playerState.progress)
                        .stroke(DesignTokens.rose, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .frame(width: 52, height: 52)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.5), value: playerState.progress)

                    // Album art (small square inside ring)
                    RoundedRectangle(cornerRadius: 10)
                        .fill(currentOccasionGradient)
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: currentOccasionIcon)
                                .font(.system(size: 18))
                                .foregroundColor(.white.opacity(0.9))
                        )
                }

                // Track info
                VStack(alignment: .leading, spacing: 3) {
                    Text(playerState.currentTrack?.title ?? "Now Playing")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(subtitleText)
                            .font(.system(size: 13))
                            .foregroundColor(DesignTokens.textSecondary)
                            .lineLimit(1)

                        // Time indicator
                        if playerState.duration > 0 {
                            Text("•")
                                .font(.system(size: 13))
                                .foregroundColor(DesignTokens.textTertiary)

                            Text(playerState.formattedCurrentTime)
                                .font(.system(size: 12, weight: .medium).monospacedDigit())
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                    }
                }

                Spacer()

                // Play/Pause button
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .light)
                    generator.impactOccurred()
                    onPlayPause()
                } label: {
                    ZStack {
                        Circle()
                            .fill(DesignTokens.rose)
                            .frame(width: 44, height: 44)

                        if playerState.isLoading {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .offset(x: playerState.isPlaying ? 0 : 1)
                        }
                    }
                    .shadow(color: DesignTokens.rose.opacity(0.3), radius: 8, y: 4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

                // Close button
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .light)
                    generator.impactOccurred()
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(
                            Circle()
                                .fill(DesignTokens.backgroundSubtle)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close player")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(DesignTokens.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.cardBorder.opacity(0.5), lineWidth: 0.5)
        )
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture {
            onTap()
        }
        .scaleEffect(isPressed ? 0.98 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: isPressed)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(playerState.currentTrack?.title ?? "Song"), \(playerState.isPlaying ? "playing" : "paused")")
        .accessibilityHint("Double tap to expand player")
    }

    private var subtitleText: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let style = track.style {
            parts.append(MusicStyle(rawValue: style)?.displayName ?? style.capitalized)
        }

        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append("For \(recipient)")
        }

        return parts.joined(separator: " • ")
    }

    private var currentOccasionIcon: String {
        occasionIcon(for: playerState.currentTrack?.occasion)
    }

    private var currentOccasionGradient: LinearGradient {
        occasionGradient(for: playerState.currentTrack?.occasion)
    }
}

// MARK: - Now Playing View (Full Screen)

/// Full screen player with lyrics display
struct NowPlayingView: View {
    @ObservedObject var playerState: PlayerState
    let onDismiss: () -> Void
    let onPlayPause: () -> Void
    let onSeek: (TimeInterval) -> Void

    @State private var isDraggingProgress = false
    @State private var dragProgress: Double = 0
    @GestureState private var dragOffset: CGFloat = 0

    var body: some View {
        ZStack {
            // Background gradient
            backgroundGradient
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with dismiss handle
                headerSection

                // Album art
                albumArtSection
                    .padding(.top, 20)

                // Track info
                trackInfoSection
                    .padding(.top, 24)

                // Progress bar
                progressSection
                    .padding(.top, 24)
                    .padding(.horizontal, 24)

                // Playback controls
                controlsSection
                    .padding(.top, 20)

                // Lyrics scroll view
                lyricsSection
                    .padding(.top, 24)

                Spacer(minLength: 20)
            }
        }
        .gesture(
            DragGesture()
                .updating($dragOffset) { value, state, _ in
                    if value.translation.height > 0 {
                        state = value.translation.height
                    }
                }
                .onEnded { value in
                    if value.translation.height > 100 {
                        onDismiss()
                    }
                }
        )
        .offset(y: dragOffset * 0.5)
        .animation(.interactiveSpring(), value: dragOffset)
    }

    // MARK: - View Components

    private var headerSection: some View {
        VStack(spacing: 8) {
            // Drag handle
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.white.opacity(0.3))
                .frame(width: 36, height: 4)
                .padding(.top, 8)

            // Title
            Text("Now Playing")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.85))
                .textCase(.uppercase)
                .tracking(1)
        }
    }

    private var albumArtSection: some View {
        ZStack {
            // Large album art
            RoundedRectangle(cornerRadius: 20)
                .fill(currentOccasionGradient)
                .frame(width: 280, height: 280)
                .shadow(color: Color.black.opacity(0.3), radius: 20, y: 10)

            // Icon
            Image(systemName: currentOccasionIcon)
                .font(.system(size: 80))
                .foregroundColor(.white.opacity(0.9))

            // Playing indicator (animated rings)
            if playerState.isPlaying {
                ForEach(0..<3) { index in
                    Circle()
                        .stroke(Color.white.opacity(0.2 - Double(index) * 0.05), lineWidth: 2)
                        .frame(width: 300 + CGFloat(index * 20), height: 300 + CGFloat(index * 20))
                        .scaleEffect(playerState.isPlaying ? 1.1 : 1.0)
                        .animation(
                            Animation.easeInOut(duration: 1.5)
                                .repeatForever(autoreverses: true)
                                .delay(Double(index) * 0.2),
                            value: playerState.isPlaying
                        )
                }
            }
        }
    }

    private var trackInfoSection: some View {
        VStack(spacing: 6) {
            Text(playerState.currentTrack?.title ?? "Unknown")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)

            Text(subtitleText)
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        }
        .padding(.horizontal, 24)
    }

    private var progressSection: some View {
        VStack(spacing: 8) {
            // Progress slider
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white.opacity(0.2))
                        .frame(height: 4)

                    // Progress
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white)
                        .frame(width: geo.size.width * (isDraggingProgress ? dragProgress : playerState.progress), height: 4)

                    // Thumb (only visible when dragging)
                    if isDraggingProgress {
                        Circle()
                            .fill(Color.white)
                            .frame(width: 12, height: 12)
                            .offset(x: geo.size.width * dragProgress - 6)
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            isDraggingProgress = true
                            dragProgress = max(0, min(1, value.location.x / geo.size.width))
                        }
                        .onEnded { value in
                            let progress = max(0, min(1, value.location.x / geo.size.width))
                            onSeek(progress * playerState.duration)
                            isDraggingProgress = false
                        }
                )
            }
            .frame(height: 4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Playback progress")
            .accessibilityValue("\(playerState.formattedCurrentTime) of \(playerState.formattedDuration)")
            .accessibilityAdjustableAction { direction in
                let stepSize: TimeInterval = 5.0 // 5 second increments
                switch direction {
                case .increment:
                    let newTime = min(playerState.duration, playerState.currentTime + stepSize)
                    onSeek(newTime)
                case .decrement:
                    let newTime = max(0, playerState.currentTime - stepSize)
                    onSeek(newTime)
                @unknown default:
                    break
                }
            }

            // Time labels
            HStack {
                Text(isDraggingProgress ? formatTime(dragProgress * playerState.duration) : playerState.formattedCurrentTime)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(.white.opacity(0.8))
                    .accessibilityHidden(true)

                Spacer()

                Text(playerState.formattedDuration)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(.white.opacity(0.8))
                    .accessibilityHidden(true)
            }
        }
    }

    private var controlsSection: some View {
        HStack(spacing: 48) {
            // Rewind 15s
            Button {
                let newTime = max(0, playerState.currentTime - 15)
                onSeek(newTime)
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 28))
                    .foregroundColor(.white.opacity(0.8))
            }
            .accessibilityLabel("Rewind 15 seconds")

            // Play/Pause (large)
            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onPlayPause()
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 72, height: 72)

                    if playerState.isLoading {
                        ProgressView()
                            .tint(DesignTokens.rose)
                    } else {
                        Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(DesignTokens.rose)
                            .offset(x: playerState.isPlaying ? 0 : 2)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

            // Forward 15s
            Button {
                let newTime = min(playerState.duration, playerState.currentTime + 15)
                onSeek(newTime)
            } label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 28))
                    .foregroundColor(.white.opacity(0.8))
            }
            .accessibilityLabel("Forward 15 seconds")
        }
    }

    private var lyricsSection: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let lyrics = playerState.lyrics {
                    ForEach(Array(lyrics.sections.enumerated()), id: \.offset) { index, section in
                        VStack(alignment: .leading, spacing: 8) {
                            // Section name (Verse 1, Chorus, etc.)
                            Text(section.name.uppercased())
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white.opacity(0.65))
                                .tracking(1.5)

                            // Lines
                            ForEach(Array(section.lines.enumerated()), id: \.offset) { lineIndex, line in
                                Text(line)
                                    .font(.system(size: 18, weight: .medium))
                                    .foregroundColor(.white.opacity(0.85))
                                    .lineSpacing(4)
                            }
                        }
                    }
                } else {
                    // No lyrics placeholder
                    VStack(spacing: 12) {
                        Image(systemName: "text.quote")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.5))

                        Text("Lyrics not available")
                            .font(.system(size: 15))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .frame(maxHeight: 200)
        .mask(
            LinearGradient(
                colors: [.clear, .white, .white, .clear],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    // MARK: - Helpers

    private var subtitleText: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let style = track.style {
            parts.append(MusicStyle(rawValue: style)?.displayName ?? style.capitalized)
        }

        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append("For \(recipient)")
        }

        return parts.joined(separator: " • ")
    }

    private var backgroundGradient: LinearGradient {
        occasionBackgroundGradient(for: playerState.currentTrack?.occasion)
    }

    private var currentOccasionGradient: LinearGradient {
        occasionGradient(for: playerState.currentTrack?.occasion)
    }

    private var currentOccasionIcon: String {
        occasionIcon(for: playerState.currentTrack?.occasion)
    }
}

// MARK: - Preview

#Preview("Mini Player") {
    let state = PlayerState()
    state.currentTrack = Track(
        id: "1",
        userId: "user",
        title: "Happy Birthday Mom",
        occasion: "birthday",
        recipientName: "Mom",
        style: "soul",
        durationTarget: 60,
        voiceMode: "ai_voice",
        message: "A heartfelt birthday song",
        status: "preview_ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01"
    )
    state.isPlaying = true
    state.currentTime = 15
    state.duration = 45

    return VStack {
        Spacer()
        MiniPlayerBar(
            playerState: state,
            onTap: { },
            onPlayPause: { },
            onClose: { }
        )
    }
    .background(DesignTokens.backgroundSubtle)
}

#Preview("Now Playing") {
    let state = PlayerState()
    state.currentTrack = Track(
        id: "1",
        userId: "user",
        title: "Happy Birthday Mom",
        occasion: "birthday",
        recipientName: "Mom",
        style: "soul",
        durationTarget: 60,
        voiceMode: "ai_voice",
        message: "A heartfelt birthday song",
        status: "preview_ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01"
    )
    state.isPlaying = true
    state.currentTime = 23
    state.duration = 45
    state.lyrics = Lyrics(
        title: "Happy Birthday Mom",
        style: "soul",
        sections: [
            LyricsSection(name: "Verse 1", lines: [
                "Waking up to sunshine bright",
                "On this day that feels so right",
                "Mom, you've been my guiding star",
                "The best you are, by far"
            ]),
            LyricsSection(name: "Chorus", lines: [
                "Happy birthday to you",
                "All my love shining through",
                "You deserve the world and more",
                "Mom, you're who I adore"
            ])
        ],
        anchorLine: nil
    )

    return NowPlayingView(
        playerState: state,
        onDismiss: { },
        onPlayPause: { },
        onSeek: { _ in }
    )
}
