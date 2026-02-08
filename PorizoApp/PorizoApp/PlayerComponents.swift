//
//  PlayerComponents.swift
//  PorizoApp
//
//  Mini player bar and full now playing view with lyrics display.
//  Velvet & Gold design system.
//

import SwiftUI
import UIKit
import AVFoundation
import Combine

// MARK: - Player State (Shared across components)

/// Observable player state for sharing between mini player and full view
@MainActor
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
        playbackTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self = self, let player = self.audioPlayer else { return }

            DispatchQueue.main.async {
                self.currentTime = player.currentTime

                // Check if playback ended
                if !player.isPlaying && self.currentTime >= self.duration - 0.1 {
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

    // MARK: - Audio Interruption Handling

    private var interruptionObserver: NSObjectProtocol?

    func setupInterruptionHandling() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

            if type == .began {
                Task { @MainActor [weak self] in
                    self?.pausePlayback()
                }
            }
        }
    }

    /// Pause without stopping — preserves track state for resume
    func pausePlayback() {
        audioPlayer?.pause()
        isPlaying = false
        stopPlaybackTimer()
    }

    nonisolated deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}

// MARK: - Mini Player Bar

/// Mini player bar with gold accent line — Variant A design
struct MiniPlayerBar: View {
    @ObservedObject var playerState: PlayerState
    let onTap: () -> Void
    let onPlayPause: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Gold accent line on top
            Rectangle()
                .fill(DesignTokens.gold)
                .frame(height: 1)

            HStack(spacing: 12) {
                // Album art: 44x44, 8px radius
                if let track = playerState.currentTrack {
                    SongCoverView(track: track, size: 44)
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold, DesignTokens.goldDark],
                            startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: "music.note")
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                        )
                }

                // Track info
                VStack(alignment: .leading, spacing: 2) {
                    Text(playerState.currentTrack?.title ?? "Now Playing")
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .lineLimit(1)

                    Text(subtitleText)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)
                        .lineLimit(1)
                }

                Spacer()

                // Play/Pause + Close
                HStack(spacing: 16) {
                    Button {
                        let generator = UIImpactFeedbackGenerator(style: .light)
                        generator.impactOccurred()
                        onPlayPause()
                    } label: {
                        if playerState.isLoading {
                            ProgressView()
                                .tint(DesignTokens.gold)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 22))
                                .foregroundColor(DesignTokens.gold)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

                    Button {
                        let generator = UIImpactFeedbackGenerator(style: .light)
                        generator.impactOccurred()
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close player")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            onTap()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(playerState.currentTrack?.title ?? "Song"), \(playerState.isPlaying ? "playing" : "paused")")
        .accessibilityHint("Double tap to expand player")
    }

    private var subtitleText: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append("For \(recipient)")
        }

        if let occasion = track.occasion, let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " · ")
    }
}

// MARK: - Now Playing View (Full Screen)

/// Full screen player with lyrics overlay on album art — Variant A design
struct NowPlayingView: View {
    @ObservedObject var playerState: PlayerState
    let onDismiss: () -> Void
    let onPlayPause: () -> Void
    let onSeek: (TimeInterval) -> Void
    var onShare: (() -> Void)?

    @State private var isDraggingProgress = false
    @State private var dragProgress: Double = 0
    @GestureState private var dragOffset: CGFloat = 0

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag handle
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 36, height: 4)
                    .padding(.top, 12)
                    .padding(.bottom, 12)

                // Album art with lyrics overlay
                albumArtWithLyrics
                    .padding(.horizontal, 20)

                // Song info
                trackInfoSection
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                // Progress bar
                progressSection
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)

                // Transport controls
                controlsSection
                    .padding(.bottom, 16)

                // Bottom actions
                bottomActionsSection
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
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

    // MARK: - Album Art + Lyrics Overlay

    private var albumArtWithLyrics: some View {
        ZStack {
            // Layer 1: Album art (remote cover or gold gradient fallback)
            if let track = playerState.currentTrack,
               let url = URL(string: track.coverImageLargeUrl ?? track.coverImageUrl ?? "") {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fill)
                    default:
                        goldGradientArt
                    }
                }
            } else {
                goldGradientArt
            }

            // Layer 2: Subtle music note pattern
            VStack(spacing: 24) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 32) {
                        ForEach(0..<4, id: \.self) { _ in
                            Image(systemName: "music.note")
                                .font(.system(size: 20))
                                .foregroundColor(.white.opacity(0.06))
                        }
                    }
                }
            }

            // Layer 3: Dark overlay for text readability
            RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)
                .fill(
                    LinearGradient(
                        colors: [
                            Color.black.opacity(0.3),
                            Color.black.opacity(0.6),
                            Color.black.opacity(0.3)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            // Layer 4: Lyrics overlaid with distance-based opacity
            lyricsOverlay
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: 360)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)
                .stroke(DesignTokens.gold.opacity(0.3), lineWidth: 0.5)
        )
    }

    private var goldGradientArt: some View {
        RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)
            .fill(
                LinearGradient(
                    colors: [
                        DesignTokens.gold.opacity(0.6),
                        DesignTokens.goldDark.opacity(0.4),
                        DesignTokens.gold.opacity(0.3),
                        DesignTokens.goldDark.opacity(0.5)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }

    private var lyricsOverlay: some View {
        Group {
            if let lyrics = playerState.lyrics {
                let allLines = lyrics.sections
                    .flatMap { $0.lines }
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                let currentIdx = currentLyricLineIndex(allLines: allLines)

                GeometryReader { geometry in
                    let cardSize = min(geometry.size.width, geometry.size.height)
                    let verticalSpacer = max(90, cardSize * 0.30)
                    let edgeFade = max(42, cardSize * 0.14)
                    let horizontalInset = max(20, cardSize * 0.09)
                    let lineSpacing = max(8, cardSize * 0.025)

                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            LazyVStack(spacing: lineSpacing) {
                                Spacer().frame(height: verticalSpacer)

                                ForEach(Array(allLines.enumerated()), id: \.offset) { idx, line in
                                    let distance = abs(idx - currentIdx)
                                    Text(line)
                                        .font(
                                            DesignTokens.displayFont(
                                                size: lyricFontSize(for: line, distance: distance, cardSize: cardSize),
                                                weight: distance == 0 ? .semibold : .medium
                                            )
                                        )
                                        .lineLimit(distance == 0 ? 2 : 1)
                                        .minimumScaleFactor(0.72)
                                        .allowsTightening(true)
                                        .multilineTextAlignment(.center)
                                        .foregroundColor(.white.opacity(lyricOpacity(for: idx, current: currentIdx)))
                                        .frame(maxWidth: .infinity)
                                        .padding(.horizontal, max(6, cardSize * 0.02))
                                        .padding(.vertical, distance == 0 ? 8 : 2)
                                        .scaleEffect(lyricScale(forDistance: distance))
                                        .blur(radius: lyricBlur(forDistance: distance))
                                        .shadow(
                                            color: DesignTokens.gold.opacity(distance == 0 ? 0.35 : 0),
                                            radius: distance == 0 ? 10 : 0
                                        )
                                        .background {
                                            if distance == 0 {
                                                RoundedRectangle(cornerRadius: 14)
                                                    .fill(Color.white.opacity(0.08))
                                                    .overlay(
                                                        RoundedRectangle(cornerRadius: 14)
                                                            .stroke(DesignTokens.gold.opacity(0.35), lineWidth: 0.8)
                                                    )
                                            }
                                        }
                                        .id(idx)
                                        .animation(
                                            .spring(response: 0.42, dampingFraction: 0.86, blendDuration: 0.18),
                                            value: currentIdx
                                        )
                                }

                                Spacer().frame(height: verticalSpacer)
                            }
                            .padding(.horizontal, horizontalInset)
                        }
                        .scrollDisabled(true)
                        .onChange(of: currentIdx) { _, newIdx in
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.88, blendDuration: 0.2)) {
                                proxy.scrollTo(newIdx, anchor: .center)
                            }
                        }
                        .onAppear {
                            DispatchQueue.main.async {
                                proxy.scrollTo(currentIdx, anchor: .center)
                            }
                        }
                    }
                    .mask(
                        VStack(spacing: 0) {
                            LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                                .frame(height: edgeFade)
                            Color.white
                            LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                                .frame(height: edgeFade)
                        }
                    )
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "text.quote")
                        .font(.system(size: 32))
                        .foregroundColor(.white.opacity(0.4))
                    Text("Lyrics not available")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(.white.opacity(0.5))
                }
            }
        }
    }

    // MARK: - Track Info

    private var trackInfoSection: some View {
        VStack(spacing: 4) {
            Text(playerState.currentTrack?.title ?? "Unknown")
                .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text(subtitleText)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Progress

    private var progressSection: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.border)
                        .frame(height: 3)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold)
                        .frame(width: geo.size.width * (isDraggingProgress ? dragProgress : playerState.progress), height: 3)

                    if isDraggingProgress {
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 10, height: 10)
                            .offset(x: geo.size.width * dragProgress - 5)
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
            .frame(height: 3)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Playback progress")
            .accessibilityValue("\(playerState.formattedCurrentTime) of \(playerState.formattedDuration)")
            .accessibilityAdjustableAction { direction in
                let stepSize: TimeInterval = 5.0
                switch direction {
                case .increment:
                    onSeek(min(playerState.duration, playerState.currentTime + stepSize))
                case .decrement:
                    onSeek(max(0, playerState.currentTime - stepSize))
                @unknown default:
                    break
                }
            }

            HStack {
                Text(isDraggingProgress ? formatTime(dragProgress * playerState.duration) : playerState.formattedCurrentTime)
                    .font(DesignTokens.bodyFont(size: 11).monospacedDigit())
                    .foregroundColor(DesignTokens.textTertiary)
                    .accessibilityHidden(true)

                Spacer()

                Text(playerState.formattedDuration)
                    .font(DesignTokens.bodyFont(size: 11).monospacedDigit())
                    .foregroundColor(DesignTokens.textTertiary)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: - Transport Controls

    private var controlsSection: some View {
        HStack(spacing: 36) {
            Button {
                onSeek(max(0, playerState.currentTime - 15))
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .accessibilityLabel("Rewind 15 seconds")

            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onPlayPause()
            } label: {
                ZStack {
                    Circle()
                        .fill(.white)
                        .frame(width: 56, height: 56)

                    if playerState.isLoading {
                        ProgressView()
                            .tint(DesignTokens.gold)
                    } else {
                        Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 22))
                            .foregroundColor(DesignTokens.gold)
                            .offset(x: playerState.isPlaying ? 0 : 1)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

            Button {
                onSeek(min(playerState.duration, playerState.currentTime + 15))
            } label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .accessibilityLabel("Forward 15 seconds")
        }
    }

    // MARK: - Bottom Actions

    private var bottomActionsSection: some View {
        HStack {
            VStack(spacing: 4) {
                Image(systemName: "waveform")
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.gold)
                Text("Your Voice")
                    .font(DesignTokens.bodyFont(size: 10))
                    .foregroundColor(DesignTokens.textTertiary)
            }

            Spacer()

            Button {
                onShare?()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 14))
                    Text("Share")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                }
                .foregroundColor(.black)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(DesignTokens.gold)
                .cornerRadius(22)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Helpers

    private var subtitleText: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let style = track.style {
            parts.append(MusicStyle(rawValue: style)?.displayName ?? style.capitalized)
        }

        if let occasion = track.occasion, let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " · ")
    }

    /// Estimate current lyric line based on playback progress
    private func currentLyricLineIndex(allLines: [String]) -> Int {
        guard !allLines.isEmpty, playerState.duration > 0 else { return 0 }
        let progress = playerState.currentTime / playerState.duration
        return min(allLines.count - 1, Int(progress * Double(allLines.count)))
    }

    private func lyricOpacity(for index: Int, current: Int) -> Double {
        if index == current { return 1.0 }
        let distance = abs(index - current)
        switch distance {
        case 1: return 0.62
        case 2: return 0.34
        default: return 0.16
        }
    }

    private func lyricScale(forDistance distance: Int) -> CGFloat {
        switch distance {
        case 0: return 1.05
        case 1: return 0.95
        case 2: return 0.90
        default: return 0.86
        }
    }

    private func lyricBlur(forDistance distance: Int) -> CGFloat {
        switch distance {
        case 0: return 0
        case 1: return 0.6
        case 2: return 1.1
        default: return 1.6
        }
    }

    private func lyricFontSize(for line: String, distance: Int, cardSize: CGFloat) -> CGFloat {
        let base = min(23, max(18, cardSize * 0.062))
        let charCount = line.count
        let lengthAdjustment: CGFloat
        switch charCount {
        case 0...24:
            lengthAdjustment = 0
        case 25...40:
            lengthAdjustment = -1.5
        case 41...56:
            lengthAdjustment = -3
        default:
            lengthAdjustment = -4.5
        }
        let distanceAdjustment: CGFloat = distance == 0 ? 0 : -2
        return max(14, base + lengthAdjustment + distanceAdjustment)
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
        updatedAt: "2025-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
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
    .background(DesignTokens.surface)
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
        updatedAt: "2025-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
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
