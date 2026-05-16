import SwiftUI

struct NowPlayingView: View {
    var playerState: PlayerState
    let onDismiss: () -> Void
    let onPlayPause: () -> Void
    let onSeek: (TimeInterval) -> Void
    var onShare: (() -> Void)?

    @Environment(StyleStore.self) private var styleStore
    @AppStorage("lyricsStyle") private var lyricsStyle: LyricsDesignStyle = .karaokeSweep
    @State private var isDraggingProgress = false
    @State private var dragProgress: Double = 0
    @GestureState private var dragOffset: CGFloat = 0
    @State private var hapticTrigger = false

    var body: some View {
        ZStack {
            // Warm canvas background
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag handle
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 36, height: 4)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                // Album art -- gold gradient with occasion emoji
                albumArtSection
                    .padding(.horizontal, 24)
                    .padding(.bottom, 4)

                // Top: small caps title + thin progress
                trackInfoSection
                    .padding(.bottom, 4)

                progressSection
                    .padding(.horizontal, 24)
                    .padding(.bottom, 4)

                // Lyrics -- style selectable by user preference
                selectedLyricsView

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
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticTrigger)
    }

    // MARK: - Selected Lyrics View

    @ViewBuilder
    private var selectedLyricsView: some View {
        if let lyrics = playerState.lyrics {
            let allLines = LyricsTimingHelper.allLines(from: lyrics)
            let focusPosition = currentLyricFocusPosition(allLines: allLines)
            // Use round (not floor) so lines transition at midpoint -- matches original editorial timing
            let currentIdx = max(0, min(allLines.count - 1, Int(round(focusPosition))))
            // lineProgress: 0->1 within the rounded window (currentIdx-0.5 to currentIdx+0.5)
            let lineProgress = max(0, min(1, focusPosition - Double(currentIdx) + 0.5))

            switch lyricsStyle {
            case .spotlight:
                SpotlightLyricsView(lyrics: lyrics, focusPosition: focusPosition)
            case .karaokeSweep:
                KaraokeSweepLyricsView(lyrics: lyrics, currentLineIndex: currentIdx, lineProgress: lineProgress)
            case .verseStage:
                VerseStageLyricsView(lyrics: lyrics, currentLineIndex: currentIdx, lineProgress: lineProgress)
            }
        } else {
            VStack(spacing: 8) {
                Spacer()
                Image(systemName: "text.quote")
                    .font(.system(size: 32))
                    .foregroundStyle(DesignTokens.textTertiary)
                Text("Lyrics not available")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textTertiary)
                Spacer()
            }
        }
    }

    // MARK: - Editorial Lyrics (Full-Screen) -- Legacy

    private var editorialLyrics: some View {
        Group {
            if let lyrics = playerState.lyrics {
                let allLines = lyrics.sections
                    .flatMap { $0.lineTexts }
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
                                    .foregroundStyle(isCurrent
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
                        .foregroundStyle(DesignTokens.textTertiary)
                    Text("Lyrics not available")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
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

    // MARK: - Album Art

    private var albumArtSection: some View {
        VStack(spacing: 4) {
            let occasionEmoji: String = {
                if let occasion = playerState.currentTrack?.occasion,
                   let occ = Occasion(rawValue: occasion) {
                    return occ.emoji
                }
                return "🎵"
            }()

            // Per-song occasion artwork. Falls back to coral-gradient + occasion
            // emoji while the artwork loads (or if it's missing — e.g. older tracks
            // generated before the artwork pipeline shipped, or the artwork job
            // failed and the READY barrier released the track with artwork_url=NULL).
            ZStack {
                if let urlString = playerState.currentTrack?.artworkUrl,
                   let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .empty:
                            albumArtPlaceholder(occasionEmoji: occasionEmoji)
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .transition(.opacity.animation(.easeOut(duration: 0.2)))
                        case .failure:
                            albumArtPlaceholder(occasionEmoji: occasionEmoji)
                        @unknown default:
                            albumArtPlaceholder(occasionEmoji: occasionEmoji)
                        }
                    }
                } else {
                    albumArtPlaceholder(occasionEmoji: occasionEmoji)
                }
            }
            .frame(height: 280)
            .clipShape(RoundedRectangle(cornerRadius: 20))

            VStack(spacing: 4) {
                Text("For \(playerState.currentTrack?.recipientName ?? "You")")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(albumArtSubtitle)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    private func albumArtPlaceholder(occasionEmoji: String) -> some View {
        RoundedRectangle(cornerRadius: 20)
            .fill(LinearGradient(
                colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .overlay(Text(occasionEmoji).font(.system(size: 48)))
    }

    private var albumArtSubtitle: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let occasion = track.occasion, let occ = Occasion(rawValue: occasion) {
            parts.append("\(occ.displayName) Song")
        }

        if let style = track.style {
            parts.append(styleStore.displayName(for: style))
        }

        if playerState.duration > 0 {
            parts.append(playerState.formattedDuration)
        }

        return parts.joined(separator: " \u{2022} ")
    }

    // MARK: - Track Info

    private var trackInfoSection: some View {
        HStack {
            Text((playerState.currentTrack?.title ?? "Unknown").uppercased())
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
                .tracking(2.0)
                .lineLimit(1)
            Spacer()
            Text(subtitleText)
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .lineLimit(1)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    // MARK: - Progress

    private var progressSection: some View {
        VStack(spacing: 4) {
            let currentProgress = isDraggingProgress ? dragProgress : playerState.progress
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.border)
                        .frame(height: 4)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold)
                        .frame(width: geo.size.width * currentProgress, height: 4)

                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 12, height: 12)
                        .offset(x: geo.size.width * currentProgress - 6)
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
            .frame(height: 12)
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
                    .foregroundStyle(DesignTokens.textTertiary)
                    .accessibilityHidden(true)

                Spacer()

                Text(playerState.formattedDuration)
                    .font(DesignTokens.bodyFont(size: 11).monospacedDigit())
                    .foregroundStyle(DesignTokens.textTertiary)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: - Transport Controls

    private var controlsSection: some View {
        HStack(spacing: 32) {
            Button {
                onSeek(max(0, playerState.currentTime - 15))
            } label: {
                Image(systemName: "backward.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Rewind 15 seconds")

            Button {
                hapticTrigger.toggle()
                onPlayPause()
            } label: {
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 56, height: 56)

                    if playerState.isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white)
                            .offset(x: playerState.isPlaying ? 0 : 1)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

            Button {
                onSeek(min(playerState.duration, playerState.currentTime + 15))
            } label: {
                Image(systemName: "forward.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(DesignTokens.textSecondary)
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
                    .foregroundStyle(DesignTokens.gold)
                Text("Your Voice")
                    .font(DesignTokens.bodyFont(size: 10))
                    .foregroundStyle(DesignTokens.textTertiary)
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
                .foregroundStyle(DesignTokens.gold)
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
            parts.append(styleStore.displayName(for: style))
        }

        if let occasion = track.occasion, let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " · ")
    }

    private func currentLyricFocusPosition(allLines: [String]) -> Double {
        guard !allLines.isEmpty else { return 0 }
        guard playerState.duration > 0 else { return 0 }

        // Hold on first line while detecting vocal onset from audio metering
        if !playerState.introDetected {
            return 0
        }

        let style = playerState.lyrics?.style
        let startTimes = estimatedLyricStarts(for: allLines, duration: playerState.duration, style: style, displayStyle: lyricsStyle)
        let leadTime = lyricLeadTime(duration: playerState.duration, lineCount: allLines.count, displayStyle: lyricsStyle)
        let playbackTime = min(playerState.duration, max(0, playerState.currentTime + leadTime))
        return lyricInterpolatedPosition(for: startTimes, at: playbackTime)
    }

    private func estimatedLyricStarts(for lines: [String], duration: TimeInterval, style: String?, displayStyle: LyricsDesignStyle) -> [TimeInterval] {
        guard !lines.isEmpty, duration > 0 else { return [] }

        // Use detected vocal onset if available, otherwise fall back to heuristic
        let introSeconds = playerState.detectedIntroEnd ?? estimatedIntroLength(style: style, duration: duration)
        let outroSeconds = min(max(duration * 0.045, 1.0), 4.0)
        let performDuration = max(1.0, duration - introSeconds - outroSeconds)

        let weights = lines.map(lyricTimingWeight(for:))
        let totalWeight = max(weights.reduce(0, +), Double(lines.count))

        // Per-style acceleration: Spotlight shows one line at a time so drift
        // is very noticeable -- needs stronger curve. Karaoke sweep's continuous
        // animation is more forgiving. Verse Stage's card format is in between.
        let accelCoeff: Double
        switch displayStyle {
        case .spotlight:
            accelCoeff = 0.45
        case .verseStage:
            accelCoeff = 0.30
        case .karaokeSweep:
            accelCoeff = 0.25
        }

        var starts: [TimeInterval] = []
        starts.reserveCapacity(lines.count)

        var consumedWeight = 0.0
        for weight in weights {
            let t = consumedWeight / totalWeight
            // Acceleration curve: shifts middle/later lines earlier.
            // t*(1-t) peaks at 0.5, so the maximum shift is in the song's middle.
            let curved = t - accelCoeff * t * (1.0 - t)
            starts.append(introSeconds + (curved * performDuration))
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

    private func lyricLeadTime(duration: TimeInterval, lineCount: Int, displayStyle: LyricsDesignStyle) -> TimeInterval {
        guard duration > 0, lineCount > 0 else { return 1.20 }
        let linesPerSecond = Double(lineCount) / duration
        let baseLead = 1.40 - (linesPerSecond * 0.25)

        // Per-style offset: each visual style creates different perceived timing.
        // Karaoke sweep's animation makes lines feel "active" longer -> reduce lead.
        // Verse stage reveals lines discretely -> needs more lead to feel in sync.
        // Spotlight is single-line focus -> moderate lead.
        let styleOffset: TimeInterval
        switch displayStyle {
        case .karaokeSweep:
            styleOffset = -0.35
        case .spotlight:
            styleOffset = 0.0
        case .verseStage:
            styleOffset = 0.30
        }

        return min(2.10, max(0.50, baseLead + styleOffset))
    }

    private func estimatedIntroLength(style: String?, duration: TimeInterval) -> TimeInterval {
        let lower = style?.lowercased() ?? ""

        // Ballad / soul / R&B / jazz -- longer atmospheric intros
        let slowGenres = ["ballad", "soul", "r&b", "rnb", "jazz", "blues", "gospel", "classical"]
        // Pop / dance / hip-hop -- medium intros
        let medGenres = ["pop", "dance", "edm", "hip-hop", "hip hop", "hiphop", "reggae", "country", "folk", "indie"]
        // Rock / punk / uptempo -- shorter intros
        let fastGenres = ["rock", "punk", "metal", "uptempo", "ska", "hardcore"]

        if slowGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.09, 3.5), 10.0)
        } else if fastGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.04, 1.5), 5.0)
        } else if medGenres.contains(where: { lower.contains($0) }) {
            return min(max(duration * 0.06, 2.5), 7.0)
        }

        // Unknown style -- sensible default for Suno-generated songs
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
