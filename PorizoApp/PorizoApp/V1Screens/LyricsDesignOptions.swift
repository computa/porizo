//
//  LyricsDesignOptions.swift
//  PorizoApp
//
//  Three creative lyrics display designs for side-by-side comparison.
//  Each option shares the same mock data and auto-advancing playback state.
//  The 3 views (Spotlight, Karaoke Sweep, Verse Stage) accept value parameters
//  so they work with both the real PlayerState and the preview timer.
//

import Observation
import SwiftUI

// MARK: - Style Enum

enum LyricsDesignStyle: String, CaseIterable {
    case spotlight = "Spotlight"
    case karaokeSweep = "Karaoke Sweep"
    case verseStage = "Verse Stage"

    var label: String {
        switch self {
        case .spotlight: return "A: Spotlight"
        case .karaokeSweep: return "B: Karaoke"
        case .verseStage: return "C: Verse Stage"
        }
    }
}

// MARK: - Lyrics Timing Helpers

/// Computes timing info from lyrics + a fractional focus position.
/// Used by both the real NowPlayingView and the preview catalog.
enum LyricsTimingHelper {
    /// Flatten all sections into a single line array
    static func allLines(from lyrics: Lyrics) -> [String] {
        lyrics.sections.flatMap(\.lineTexts)
    }

    /// Section boundaries as (sectionIndex, startLineIndex, name) tuples
    static func sectionBoundaries(from lyrics: Lyrics) -> [(sectionIndex: Int, startLine: Int, name: String)] {
        var result: [(Int, Int, String)] = []
        var lineOffset = 0
        for (i, section) in lyrics.sections.enumerated() {
            result.append((i, lineOffset, section.name))
            lineOffset += section.lines.count
        }
        return result
    }

    /// Which section a given line index belongs to
    static func sectionIndex(forLine lineIndex: Int, in lyrics: Lyrics) -> Int {
        let boundaries = sectionBoundaries(from: lyrics)
        for i in stride(from: boundaries.count - 1, through: 0, by: -1) {
            if lineIndex >= boundaries[i].startLine {
                return boundaries[i].sectionIndex
            }
        }
        return 0
    }

    /// Line index relative to its section
    static func lineIndexInSection(forLine lineIndex: Int, in lyrics: Lyrics) -> Int {
        let boundaries = sectionBoundaries(from: lyrics)
        let secIdx = sectionIndex(forLine: lineIndex, in: lyrics)
        guard secIdx < boundaries.count else { return 0 }
        return lineIndex - boundaries[secIdx].startLine
    }
}

// MARK: - Auto-Advancing Preview State

#if DEBUG
/// Simulates playback by auto-incrementing currentTime so lyrics animate
/// without actual audio. Starts at 75s to show mid-song state.
@Observable
@MainActor
class LyricsPreviewState {
    var currentTime: TimeInterval = 75.0
    var isPlaying: Bool = true
    var duration: TimeInterval = 176.0

    @ObservationIgnored private var timer: Timer?

    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    var formattedCurrentTime: String { formatTime(currentTime) }
    var formattedDuration: String { formatTime(duration) }

    let track = Track(
        id: "track_vincent",
        userId: "user_preview",
        title: "Song for Vincent",
        occasion: "celebration",
        recipientName: "Vincent",
        style: "soul",
        durationTarget: 180,
        voiceMode: "ai_voice",
        message: "A tribute to your journey",
        status: "ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )

    let lyrics: Lyrics = {
        Lyrics(
            title: "Song for Vincent",
            style: "soul",
            sections: [
                LyricsSection(name: "verse_1", lines: [
                    "Oh, Vincent, the road you've walked is paved in gold,",
                    "From snowy streets to promises you uphold.",
                    "You keep your head down, never see the praise,",
                    "Vincent, it's time to count your flowers these days."
                ]),
                LyricsSection(name: "verse_2", lines: [
                    "Sweden's winter wind, a lesson learned in cold,",
                    "Denmark's helping hand, a story to be told.",
                    "Each younger one you lifted, a future taking flight,",
                    "While you kept pushing onward, day and through the night."
                ]),
                LyricsSection(name: "chorus", lines: [
                    "Canada's calling now, family by your side,",
                    "But the hustle never faded, nowhere left to hide.",
                    "Oh, Vincent, the road you've walked is paved in gold,",
                    "From snowy streets to promises you uphold."
                ])
            ],
            anchorLine: nil
        )
    }()

    /// Continuous fractional position across all lines (e.g. 3.7 = 70% through line 3)
    var focusPosition: Double {
        let lines = LyricsTimingHelper.allLines(from: lyrics)
        guard !lines.isEmpty, duration > 0 else { return 0 }
        let introSeconds: TimeInterval = 12.0
        let outroSeconds: TimeInterval = 8.0
        let singDuration = max(1, duration - introSeconds - outroSeconds)
        let elapsed = max(0, currentTime - introSeconds)
        let fraction = elapsed / singDuration
        let exactIndex = fraction * Double(lines.count)
        return max(0, min(Double(lines.count - 1), exactIndex))
    }

    /// Current line index based on time
    var currentLineIndex: Int {
        max(0, Int(round(focusPosition)))
    }

    /// Fractional position within the current line (0.0 to 1.0)
    var lineProgress: Double {
        focusPosition - floor(focusPosition)
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.isPlaying else { return }
                self.currentTime += 0.1
                if self.currentTime >= self.duration {
                    self.currentTime = 0
                }
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func togglePlayback() {
        isPlaying.toggle()
    }
}

// MARK: - Main Option View (Preview Catalog)

/// Container that wraps a specific lyrics design with shared chrome
struct LyricsOptionView: View {
    let style: LyricsDesignStyle
    @State private var previewState = LyricsPreviewState()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag handle
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 36, height: 4)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                lyricsTrackInfoSection
                    .padding(.bottom, 4)

                if style != .spotlight {
                    lyricsProgressSection
                        .padding(.horizontal, 24)
                        .padding(.bottom, 4)
                }

                // Design-specific lyrics area
                lyricsContent

                lyricsControlsSection
                    .padding(.bottom, 12)

                lyricsBottomActionsSection
                    .padding(.horizontal, 24)
                    .padding(.bottom, 34)
            }
        }
        .navigationBarHidden(true)
        .onAppear { previewState.start() }
        .onDisappear { previewState.stop() }
    }

    @ViewBuilder
    private var lyricsContent: some View {
        let lyrics = previewState.lyrics
        let currentIdx = previewState.currentLineIndex
        let progress = previewState.lineProgress

        switch style {
        case .spotlight:
            SpotlightLyricsView(lyrics: lyrics, focusPosition: previewState.focusPosition)
        case .karaokeSweep:
            KaraokeSweepLyricsView(lyrics: lyrics, currentLineIndex: currentIdx, lineProgress: progress)
        case .verseStage:
            VerseStageLyricsView(lyrics: lyrics, currentLineIndex: currentIdx, lineProgress: progress)
        }
    }

    // MARK: - Shared Chrome

    private var lyricsTrackInfoSection: some View {
        HStack {
            Text("SONG FOR VINCENT")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
                .tracking(2.0)
                .lineLimit(1)
            Spacer()
            Text("Soul \u{00B7} Celebration")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .lineLimit(1)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    private var lyricsProgressSection: some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 1.5)

                    Rectangle()
                        .fill(DesignTokens.gold)
                        .frame(width: geo.size.width * previewState.progress, height: 1.5)

                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 4, height: 4)
                        .shadow(color: DesignTokens.gold.opacity(0.6), radius: 4)
                        .offset(x: geo.size.width * previewState.progress - 2)
                }
            }
            .frame(height: 1.5)

            HStack {
                Text(previewState.formattedCurrentTime)
                    .font(DesignTokens.bodyFont(size: 10).monospacedDigit())
                    .foregroundStyle(DesignTokens.textTertiary)
                Spacer()
                Text(previewState.formattedDuration)
                    .font(DesignTokens.bodyFont(size: 10).monospacedDigit())
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
    }

    private var lyricsControlsSection: some View {
        HStack(spacing: 36) {
            Button {} label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Button {
                previewState.togglePlayback()
            } label: {
                ZStack {
                    if style == .spotlight {
                        Circle()
                            .stroke(Color.white.opacity(0.1), lineWidth: 3)
                            .frame(width: 52, height: 52)
                        Circle()
                            .trim(from: 0, to: previewState.progress)
                            .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                            .frame(width: 52, height: 52)
                            .rotationEffect(.degrees(-90))
                    }

                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 44, height: 44)

                    Image(systemName: previewState.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.black)
                        .offset(x: previewState.isPlaying ? 0 : 1)
                }
            }
            .buttonStyle(.plain)

            Button {} label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    private var lyricsBottomActionsSection: some View {
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

            Button {} label: {
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
}

// MARK: - Option A: Spotlight — Cinematic Single-Line Focus

struct SpotlightLyricsView: View {
    let lyrics: Lyrics
    let focusPosition: Double

    var body: some View {
        let lines = LyricsTimingHelper.allLines(from: lyrics)

        GeometryReader { geo in
            let lineSpacing: CGFloat = 24
            let lineSlotHeight: CGFloat = 48
            let lineStride = lineSlotHeight + lineSpacing
            let centerY = geo.size.height * 0.42
            // Use continuous focusPosition for smooth scrolling (not integer snap)
            let contentOffsetY = centerY - (CGFloat(focusPosition) * lineStride) - (lineStride * 0.5)

            ZStack {
                // Radial gold glow behind current line position
                RadialGradient(
                    colors: [DesignTokens.gold.opacity(0.12), .clear],
                    center: UnitPoint(x: 0.5, y: 0.42),
                    startRadius: 10,
                    endRadius: geo.size.width * 0.55
                )
                .allowsHitTesting(false)

                // Ambient particles
                SpotlightParticlesView()
                    .allowsHitTesting(false)

                // Scrolling lyrics stack
                VStack(spacing: lineSpacing) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { idx, line in
                        // Continuous distance for smooth opacity/scale transitions
                        let continuousDistance = abs(Double(idx) - focusPosition)
                        let isCurrent = continuousDistance < 0.55

                        Text(line)
                            .font(isCurrent
                                ? DesignTokens.displayFont(size: spotlightFontSize(for: line))
                                : DesignTokens.bodyFont(size: 16))
                            .foregroundStyle(isCurrent
                                ? DesignTokens.gold
                                : .white.opacity(spotlightOpacity(forDistance: continuousDistance)))
                            .shadow(color: isCurrent ? DesignTokens.gold.opacity(0.3) : .clear, radius: 20)
                            .multilineTextAlignment(.center)
                            .lineLimit(isCurrent ? 3 : 2)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: lineSlotHeight)
                            .scaleEffect(spotlightScale(forDistance: continuousDistance))
                    }
                }
                .padding(.horizontal, 28)
                .offset(y: contentOffsetY)
            }
            // Edge fade masks
            .mask(
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                        .frame(height: 56)
                    Color.white
                    LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 72)
                }
            )
        }
    }

    private func spotlightFontSize(for line: String) -> CGFloat {
        switch line.count {
        case 0...25: return 34
        case 26...40: return 30
        case 41...55: return 26
        default: return 22
        }
    }

    private func spotlightOpacity(forDistance distance: Double) -> Double {
        switch distance {
        case ..<0.55: return 1.0
        case ..<1.5: return 0.25 - 0.10 * (distance - 0.55)
        case ..<2.5: return 0.15 - 0.05 * (distance - 1.5)
        case ..<3.5: return 0.10 - 0.04 * (distance - 2.5)
        default: return 0.06
        }
    }

    private func spotlightScale(forDistance distance: Double) -> CGFloat {
        if distance < 0.55 { return 1.0 }
        // Smooth scale-down from 1.0 to 0.92 over distance 0.55→1.5
        let t = min(1.0, (distance - 0.55) / 0.95)
        return CGFloat(1.0 - 0.08 * t)
    }
}

// MARK: - Spotlight Particles

struct SpotlightParticlesView: View {
    private let particleCount = 7

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                for i in 0..<particleCount {
                    let seed = Double(i) * 137.508
                    let x = size.width * (0.15 + 0.7 * frac(sin(seed) * 0.5 + 0.5))
                    let baseY = size.height * frac(seed * 0.1 + time * 0.02 * (0.5 + frac(seed * 0.3)))
                    let y = size.height - baseY
                    let opacity = 0.05 + 0.1 * (0.5 + 0.5 * sin(time * 1.5 + seed))
                    let radius: CGFloat = 2 + 2 * CGFloat(frac(seed * 0.7))

                    let rect = CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)
                    context.fill(
                        Circle().path(in: rect),
                        with: .color(DesignTokens.gold.opacity(opacity))
                    )
                }
            }
        }
    }

    private func frac(_ value: Double) -> Double {
        value - floor(value)
    }
}

// MARK: - Option B: Karaoke Sweep — Word-by-Word Golden Wave

struct KaraokeSweepLyricsView: View {
    let lyrics: Lyrics
    let currentLineIndex: Int
    let lineProgress: Double

    var body: some View {
        let lines = LyricsTimingHelper.allLines(from: lyrics)
        let currentIdx = min(currentLineIndex, lines.count - 1)
        let boundaries = LyricsTimingHelper.sectionBoundaries(from: lyrics)

        GeometryReader { _ in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 28) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { idx, line in
                            VStack(alignment: .leading, spacing: 4) {
                                // Section label chip
                                if let boundary = boundaries.first(where: { $0.startLine == idx }) {
                                    Text(formatSectionName(boundary.name).uppercased())
                                        .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                        .foregroundStyle(DesignTokens.gold)
                                        .tracking(1.2)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 4)
                                        .background(
                                            Capsule()
                                                .fill(DesignTokens.gold.opacity(0.12))
                                        )
                                        .padding(.bottom, 2)
                                }

                                HStack(spacing: 8) {
                                    // Mini waveform for current line
                                    if idx == currentIdx {
                                        KaraokeWaveformView()
                                            .frame(width: 16, height: 18)
                                    }

                                    if idx == currentIdx {
                                        KaraokeSweepLineView(
                                            text: line,
                                            sweepProgress: lineProgress
                                        )
                                    } else {
                                        Text(line)
                                            .font(DesignTokens.bodyFont(size: 16))
                                            .foregroundStyle(.white.opacity(idx < currentIdx ? 0.5 : 0.2))
                                    }
                                }
                            }
                            .id(idx)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 40)
                }
                .scrollIndicators(.hidden)
                .onChange(of: currentIdx) { _, newIdx in
                    withAnimation(.easeInOut(duration: 0.4)) {
                        proxy.scrollTo(newIdx, anchor: UnitPoint(x: 0, y: 0.35))
                    }
                }
            }
            .mask(
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                        .frame(height: 40)
                    Color.white
                    LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 56)
                }
            )
        }
    }
}

// MARK: - Sweep Line Effect

struct KaraokeSweepLineView: View {
    let text: String
    let sweepProgress: Double

    var body: some View {
        ZStack(alignment: .leading) {
            // Base layer — dim gold
            Text(text)
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.gold.opacity(0.3))

            // Bright overlay with sweep mask
            Text(text)
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.gold)
                .shadow(color: DesignTokens.gold.opacity(0.3), radius: 12)
                .mask(
                    GeometryReader { _ in
                        LinearGradient(
                            stops: [
                                .init(color: .white, location: 0),
                                .init(color: .white, location: max(0, sweepProgress - 0.05)),
                                .init(color: .clear, location: min(1, sweepProgress + 0.02))
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                )
        }
    }
}

// MARK: - Mini Waveform

struct KaraokeWaveformView: View {
    private let barCount = 4

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 1.5) {
                ForEach(0..<barCount, id: \.self) { i in
                    let phase = time * 3.0 + Double(i) * 1.2
                    let height = 4.0 + 10.0 * abs(sin(phase))
                    RoundedRectangle(cornerRadius: 1)
                        .fill(DesignTokens.gold.opacity(0.6))
                        .frame(width: 2, height: CGFloat(height))
                }
            }
        }
    }
}

// MARK: - Option C: Verse Stage — Immersive Card Theater

struct VerseStageLyricsView: View {
    let lyrics: Lyrics
    let currentLineIndex: Int
    let lineProgress: Double

    var body: some View {
        let sections = lyrics.sections
        let currentSection = LyricsTimingHelper.sectionIndex(forLine: currentLineIndex, in: lyrics)
        let lineInSection = LyricsTimingHelper.lineIndexInSection(forLine: currentLineIndex, in: lyrics)

        ZStack {
            // Diagonal gold streaks background
            VerseStageBackgroundView()
                .allowsHitTesting(false)

            VStack(spacing: 16) {
                Spacer()

                // The card
                ZStack {
                    ForEach(Array(sections.enumerated()), id: \.offset) { sectionIdx, section in
                        if sectionIdx == currentSection {
                            VerseCardView(
                                section: section,
                                currentLineIndex: lineInSection,
                                lineProgress: lineProgress
                            )
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing).combined(with: .opacity),
                                removal: .move(edge: .leading).combined(with: .opacity)
                            ))
                        }
                    }
                }
                .animation(.spring(response: 0.5, dampingFraction: 0.85), value: currentSection)
                .padding(.horizontal, 24)

                Spacer()

                // Section dots
                HStack(spacing: 8) {
                    ForEach(0..<sections.count, id: \.self) { idx in
                        Circle()
                            .fill(idx == currentSection ? DesignTokens.gold : DesignTokens.textTertiary)
                            .frame(width: idx == currentSection ? 8 : 6, height: idx == currentSection ? 8 : 6)
                            .animation(.easeInOut(duration: 0.2), value: currentSection)
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}

// MARK: - Verse Card

struct VerseCardView: View {
    let section: LyricsSection
    let currentLineIndex: Int
    let lineProgress: Double

    private let goldGradient = LinearGradient(
        stops: [
            .init(color: DesignTokens.gold.opacity(0.7), location: 0),
            .init(color: DesignTokens.gold.opacity(0.2), location: 0.5),
            .init(color: DesignTokens.gold.opacity(0.7), location: 1.0)
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Section label
            Text(formatSectionName(section.name).uppercased())
                .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
                .tracking(2)

            // Lines with staggered reveal
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(section.lines.enumerated()), id: \.offset) { lineIdx, line in
                    if lineIdx <= currentLineIndex {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(line.text)
                                .font(lineIdx == currentLineIndex
                                    ? DesignTokens.displayFont(size: 22)
                                    : DesignTokens.displayFont(size: 18, relativeTo: .body))
                                .foregroundStyle(lineIdx == currentLineIndex
                                    ? DesignTokens.gold
                                    : DesignTokens.textPrimary)
                                .lineLimit(3)
                                .minimumScaleFactor(0.8)

                            // Animated underline on current line
                            if lineIdx == currentLineIndex {
                                GeometryReader { geo in
                                    Rectangle()
                                        .fill(DesignTokens.gold)
                                        .frame(width: geo.size.width * lineProgress, height: 2)
                                        .animation(.linear(duration: 0.1), value: lineProgress)
                                }
                                .frame(height: 2)
                            }
                        }
                        .transition(.asymmetric(
                            insertion: .offset(y: 12).combined(with: .opacity),
                            removal: .opacity
                        ))
                        .animation(
                            .spring(response: 0.3, dampingFraction: 0.8)
                                .delay(Double(lineIdx) * 0.15),
                            value: currentLineIndex
                        )
                    }
                }
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.radiusPremium)
                .fill(DesignTokens.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusPremium)
                .stroke(goldGradient, lineWidth: 1)
        )
        .shadow(color: DesignTokens.gold.opacity(0.12), radius: 40, y: 8)
    }
}

// MARK: - Verse Stage Background

struct VerseStageBackgroundView: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 10.0)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                let streakCount = 5
                for i in 0..<streakCount {
                    let seed = Double(i) * 73.7
                    let phase = time * 0.015 + seed * 0.1
                    let x1 = size.width * frac(phase)
                    let y1: CGFloat = 0
                    let x2 = x1 + size.width * 0.3
                    let y2 = size.height

                    var path = Path()
                    path.move(to: CGPoint(x: x1, y: y1))
                    path.addLine(to: CGPoint(x: x2, y: y2))

                    context.stroke(
                        path,
                        with: .color(DesignTokens.gold.opacity(0.03)),
                        lineWidth: 1.5
                    )
                }
            }
        }
    }

    private func frac(_ value: Double) -> Double {
        value - floor(value)
    }
}

#endif
