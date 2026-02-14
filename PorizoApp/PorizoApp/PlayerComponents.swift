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

    // Vocal onset detection via audio metering
    @Published private(set) var detectedIntroEnd: TimeInterval?
    private(set) var introDetected = false
    private var baselinePowerSamples: [Float] = []
    private var baselinePower: Float = -160.0
    private var baselineReady = false
    private var consecutiveOnsetFrames = 0

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
            player.isMeteringEnabled = true
            player.prepareToPlay()
            audioPlayer = player

            // Reset vocal onset detection
            detectedIntroEnd = nil
            introDetected = false
            baselinePowerSamples = []
            baselinePower = -160.0
            baselineReady = false
            consecutiveOnsetFrames = 0

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

                // Vocal onset detection via audio metering
                if !self.introDetected {
                    player.updateMeters()
                    let power = player.averagePower(forChannel: 0)
                    self.updateOnsetDetection(power: power, time: self.currentTime)
                }

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

    // MARK: - Vocal Onset Detection

    /// Analyzes audio power levels to find where vocals begin.
    /// Collects a baseline during the first second, then detects a sustained
    /// power increase (~300ms) as the vocal onset point.
    private func updateOnsetDetection(power: Float, time: TimeInterval) {
        if time < 1.0 {
            // Collect baseline power during first second (instrumental intro)
            baselinePowerSamples.append(power)
        } else {
            if !baselineReady {
                if !baselinePowerSamples.isEmpty {
                    baselinePower = baselinePowerSamples.reduce(0, +) / Float(baselinePowerSamples.count)
                }
                baselineReady = true
                baselinePowerSamples = []
            }

            // Detect sustained power increase above baseline (vocals are louder)
            if power > baselinePower + 8.0 {
                consecutiveOnsetFrames += 1
                if consecutiveOnsetFrames >= 9 { // ~300ms at 30fps
                    detectedIntroEnd = max(0, time - 0.3)
                    introDetected = true
                }
            } else {
                consecutiveOnsetFrames = 0
            }
        }

        // Safety: stop trying after 20s — fall back to heuristic
        if time > 20.0 {
            introDetected = true
        }
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
            // Pure black background — editorial design
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag handle
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 36, height: 4)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                // Top: small caps title + thin progress
                trackInfoSection
                    .padding(.bottom, 4)

                progressSection
                    .padding(.horizontal, 24)
                    .padding(.bottom, 4)

                // Lyrics — full-screen editorial
                editorialLyrics

                // Transport + actions
                controlsSection
                    .padding(.bottom, 12)

                bottomActionsSection
                    .padding(.horizontal, 24)
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

    // MARK: - Editorial Lyrics (Full-Screen)

    private var editorialLyrics: some View {
        Group {
            if let lyrics = playerState.lyrics {
                let allLines = lyrics.sections
                    .flatMap { $0.lines }
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                let focusPosition = currentLyricFocusPosition(allLines: allLines)
                let currentIdx = max(0, min(allLines.count - 1, Int(round(focusPosition))))

                GeometryReader { geometry in
                    let areaHeight = geometry.size.height
                    let areaWidth = geometry.size.width
                    let verticalSpacer = max(56, areaHeight * 0.15)
                    let lineSpacing: CGFloat = 20
                    let lineSlotHeight: CGFloat = 44
                    let lineStride = lineSlotHeight + lineSpacing
                    let firstLineCenterY = verticalSpacer + (lineStride * 0.5)
                    let focusCenterY = firstLineCenterY + (CGFloat(focusPosition) * lineStride)
                    let contentOffsetY = (areaHeight * 0.42) - focusCenterY

                    VStack(alignment: .leading, spacing: lineSpacing) {
                        Spacer().frame(height: verticalSpacer)

                        ForEach(Array(allLines.enumerated()), id: \.offset) { idx, line in
                            let distance = abs(Double(idx) - focusPosition)
                            let isCurrent = distance < 0.55

                            VStack(alignment: .leading, spacing: 0) {
                                // Gold horizontal rule above current line
                                if isCurrent {
                                    Rectangle()
                                        .fill(DesignTokens.gold.opacity(0.6))
                                        .frame(width: 40, height: 2)
                                        .padding(.bottom, 6)
                                }

                                Text(line)
                                    .font(isCurrent
                                        ? DesignTokens.displayFont(size: editorialCurrentFontSize(for: line, areaWidth: areaWidth))
                                        : DesignTokens.bodyFont(size: 16))
                                    .lineLimit(isCurrent ? 2 : 1)
                                    .minimumScaleFactor(0.72)
                                    .allowsTightening(true)
                                    .foregroundColor(isCurrent
                                        ? DesignTokens.gold
                                        : .white.opacity(editorialOpacity(forDistance: distance)))
                                    .frame(maxWidth: .infinity, minHeight: lineSlotHeight, alignment: .leading)
                            }
                            .id(idx)
                        }

                        Spacer().frame(height: verticalSpacer)
                    }
                    .padding(.horizontal, 24)
                    .offset(y: contentOffsetY)
                    .animation(nil, value: playerState.currentTime)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Lyrics")
                    .accessibilityValue(allLines.isEmpty ? "No lyrics" : allLines[currentIdx])
                    .mask(
                        VStack(spacing: 0) {
                            LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                                .frame(height: 48)
                            Color.white
                            LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                                .frame(height: 64)
                        }
                    )
                }
            } else {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "text.quote")
                        .font(.system(size: 32))
                        .foregroundColor(.white.opacity(0.4))
                    Text("Lyrics not available")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                }
            }
        }
    }

    private func editorialCurrentFontSize(for line: String, areaWidth: CGFloat) -> CGFloat {
        let base: CGFloat = 28
        let charCount = line.count
        switch charCount {
        case 0...20: return base
        case 21...32: return base - 2
        case 33...44: return base - 4
        default: return base - 6
        }
    }

    private func editorialOpacity(forDistance distance: Double) -> Double {
        switch distance {
        case ..<0.55: return 1.0
        case ..<1.5: return 0.30
        case ..<2.5: return 0.22
        default: return 0.14
        }
    }

    // MARK: - Track Info

    private var trackInfoSection: some View {
        HStack {
            Text((playerState.currentTrack?.title ?? "Unknown").uppercased())
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
                .tracking(2.0)
                .lineLimit(1)
            Spacer()
            Text(subtitleText)
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundColor(DesignTokens.textTertiary)
                .lineLimit(1)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    // MARK: - Progress

    private var progressSection: some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 1.5)

                    Rectangle()
                        .fill(DesignTokens.gold)
                        .frame(width: geo.size.width * (isDraggingProgress ? dragProgress : playerState.progress), height: 1.5)

                    if isDraggingProgress {
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 8, height: 8)
                            .offset(x: geo.size.width * dragProgress - 4)
                    }
                }
                .contentShape(Rectangle().inset(by: -8))
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
            .frame(height: 1.5)
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
                    .font(DesignTokens.bodyFont(size: 10).monospacedDigit())
                    .foregroundColor(DesignTokens.textTertiary)
                    .accessibilityHidden(true)

                Spacer()

                Text(playerState.formattedDuration)
                    .font(DesignTokens.bodyFont(size: 10).monospacedDigit())
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
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Rewind 15 seconds")

            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onPlayPause()
            } label: {
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 44, height: 44)

                    if playerState.isLoading {
                        ProgressView()
                            .tint(.black)
                    } else {
                        Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 18))
                            .foregroundColor(.black)
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
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
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
                .foregroundColor(DesignTokens.gold)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .overlay(
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(DesignTokens.gold.opacity(0.5), lineWidth: 1)
                )
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

    /// Returns a fractional lyric index so transitions can scroll continuously.
    private func currentLyricFocusPosition(allLines: [String]) -> Double {
        guard !allLines.isEmpty else { return 0 }
        guard playerState.duration > 0 else { return 0 }

        // Hold on first line while detecting vocal onset from audio metering
        if !playerState.introDetected {
            return 0
        }

        let style = playerState.lyrics?.style
        let startTimes = estimatedLyricStarts(for: allLines, duration: playerState.duration, style: style)
        let leadTime = lyricLeadTime(duration: playerState.duration, lineCount: allLines.count)
        let playbackTime = min(playerState.duration, max(0, playerState.currentTime + leadTime))
        return lyricInterpolatedPosition(for: startTimes, at: playbackTime)
    }

    private func estimatedLyricStarts(for lines: [String], duration: TimeInterval, style: String?) -> [TimeInterval] {
        guard !lines.isEmpty, duration > 0 else { return [] }

        // Use detected vocal onset if available, otherwise fall back to heuristic
        let introSeconds = playerState.detectedIntroEnd ?? estimatedIntroLength(style: style, duration: duration)
        let outroSeconds = min(max(duration * 0.045, 1.0), 4.0)
        let performDuration = max(1.0, duration - introSeconds - outroSeconds)

        let weights = lines.map(lyricTimingWeight(for:))
        let totalWeight = max(weights.reduce(0, +), Double(lines.count))

        var starts: [TimeInterval] = []
        starts.reserveCapacity(lines.count)

        var consumedWeight = 0.0
        for weight in weights {
            let normalizedOffset = consumedWeight / totalWeight
            starts.append(introSeconds + (normalizedOffset * performDuration))
            consumedWeight += weight
        }

        return starts
    }

    private func lyricTimingWeight(for line: String) -> Double {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 1.0 }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        let nonWhitespaceChars = trimmed.filter { !$0.isWhitespace }.count
        let commas = trimmed.filter { $0 == "," || $0 == ";" || $0 == ":" }.count
        let hardStops = trimmed.filter { $0 == "." || $0 == "!" || $0 == "?" }.count

        let wordWeight = Double(words.count) * 0.75
        let charWeight = Double(nonWhitespaceChars) / 32.0
        let punctuationWeight = (Double(commas) * 0.15) + (Double(hardStops) * 0.25)
        return max(1.0, wordWeight + charWeight + punctuationWeight)
    }

    private func lyricLeadTime(duration: TimeInterval, lineCount: Int) -> TimeInterval {
        guard duration > 0, lineCount > 0 else { return 0.50 }
        let linesPerSecond = Double(lineCount) / duration
        let adaptiveLead = 0.55 - (linesPerSecond * 0.18)
        return min(0.70, max(0.30, adaptiveLead))
    }

    private func estimatedIntroLength(style: String?, duration: TimeInterval) -> TimeInterval {
        let lower = style?.lowercased() ?? ""

        // Ballad / soul / R&B / jazz — longer atmospheric intros
        let slowGenres = ["ballad", "soul", "r&b", "rnb", "jazz", "blues", "gospel", "classical"]
        // Pop / dance / hip-hop — medium intros
        let medGenres = ["pop", "dance", "edm", "hip-hop", "hip hop", "hiphop", "reggae", "country", "folk", "indie"]
        // Rock / punk / uptempo — shorter intros
        let fastGenres = ["rock", "punk", "metal", "uptempo", "ska", "hardcore"]

        if slowGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.09, 3.5), 10.0)
        } else if fastGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.04, 1.5), 5.0)
        } else if medGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.06, 2.5), 7.0)
        }

        // Unknown style — sensible default for Suno-generated songs
        return min(max(duration * 0.06, 2.5), 7.0)
    }

    private func lyricIndex(for startTimes: [TimeInterval], at time: TimeInterval) -> Int {
        guard !startTimes.isEmpty else { return 0 }
        if time <= startTimes[0] { return 0 }

        var low = 0
        var high = startTimes.count - 1
        var result = 0

        while low <= high {
            let mid = (low + high) / 2
            if startTimes[mid] <= time {
                result = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }

        return result
    }

    private func lyricInterpolatedPosition(for startTimes: [TimeInterval], at time: TimeInterval) -> Double {
        guard !startTimes.isEmpty else { return 0 }
        if startTimes.count == 1 { return 0 }

        let clampedTime = min(max(0, time), startTimes.last ?? time)
        let lowerIndex = lyricIndex(for: startTimes, at: clampedTime)
        let upperIndex = min(lowerIndex + 1, startTimes.count - 1)
        guard upperIndex > lowerIndex else { return Double(lowerIndex) }

        let lowerTime = startTimes[lowerIndex]
        let upperTime = startTimes[upperIndex]
        let span = max(0.001, upperTime - lowerTime)
        let fraction = min(1, max(0, (clampedTime - lowerTime) / span))
        return Double(lowerIndex) + fraction
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
