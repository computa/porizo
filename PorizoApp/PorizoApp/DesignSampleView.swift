//
//  DesignSampleView.swift
//  PorizoApp
//
//  Debug-only view showing 3 design directions for Explore, Songs, and Poems.
//  Launch with --design-samples to access.
//

import SwiftUI

// MARK: - Design Sample Picker

struct DesignSampleView: View {
    @State private var selectedVariant: DesignVariant = {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--variant-b") { return .minimalLuxe }
        if args.contains("--variant-c") { return .richImmersive }
        return .refinedCurrent
    }()
    private let hideToolbar = ProcessInfo.processInfo.arguments.contains("--hide-toolbar")

    @State private var selectedScreen: ScreenType = {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--screen-songs") { return .songs }
        if args.contains("--screen-poems") { return .poems }
        if args.contains("--screen-nowplaying") { return .nowPlaying }
        if args.contains("--screen-miniplayer") { return .miniPlayer }
        if args.contains("--screen-createtype") { return .createType }
        if args.contains("--screen-poemdetail") { return .poemDetail }
        if args.contains("--screen-auth") { return .auth }
        if args.contains("--screen-onboarding") { return .onboarding }
        if args.contains("--screen-landing") { return .landing }
        return .explore
    }()

    enum DesignVariant: String, CaseIterable, Identifiable {
        case refinedCurrent = "A: Refined"
        case minimalLuxe = "B: Minimal"
        case richImmersive = "C: Rich"
        var id: String { rawValue }
    }

    // Original 3 screens (have A/B/C variants)
    enum ScreenType: String, CaseIterable, Identifiable {
        case explore = "Explore"
        case songs = "Songs"
        case poems = "Poems"
        case nowPlaying = "Now Playing"
        case miniPlayer = "Mini Player"
        case createType = "Create"
        case poemDetail = "Poem Detail"
        case auth = "Auth"
        case onboarding = "Onboarding"
        case landing = "Landing"
        var id: String { rawValue }

        /// Original 3 screens that have all 3 variant designs
        var hasVariants: Bool {
            switch self {
            case .explore, .songs, .poems, .nowPlaying: return true
            default: return false
            }
        }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                if !hideToolbar {
                    controlBar
                }
                screenContent
            }
        }
    }

    // Screens split into rows for the picker
    private static let screenRowTop: [ScreenType] = [.explore, .songs, .poems, .nowPlaying, .miniPlayer]
    private static let screenRowBottom: [ScreenType] = [.createType, .poemDetail, .auth, .onboarding, .landing]

    private var controlBar: some View {
        VStack(spacing: 6) {
            // Design variant picker (only shown for screens with variants)
            if selectedScreen.hasVariants {
                HStack(spacing: 6) {
                    ForEach(DesignVariant.allCases) { variant in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) { selectedVariant = variant }
                        } label: {
                            Text(variant.rawValue)
                                .font(DesignTokens.bodyFont(size: 12, weight: selectedVariant == variant ? .bold : .medium))
                                .foregroundStyle(selectedVariant == variant ? .black : DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .background(selectedVariant == variant ? DesignTokens.gold : DesignTokens.surface)
                                .clipShape(.rect(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Screen picker row 1
            screenPickerRow(Self.screenRowTop)

            // Screen picker row 2
            screenPickerRow(Self.screenRowBottom)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(hex: "#111111"))
    }

    private func screenPickerRow(_ screens: [ScreenType]) -> some View {
        HStack(spacing: 4) {
            ForEach(screens) { screen in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { selectedScreen = screen }
                } label: {
                    Text(screen.rawValue)
                        .font(DesignTokens.bodyFont(size: 10, weight: selectedScreen == screen ? .semibold : .regular))
                        .foregroundStyle(selectedScreen == screen ? DesignTokens.gold : DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background(selectedScreen == screen ? DesignTokens.gold.opacity(0.1) : .clear)
                        .clipShape(.rect(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var screenContent: some View {
        switch selectedScreen {
        // Original 3 screens with A/B/C variants
        case .explore:
            switch selectedVariant {
            case .refinedCurrent: VariantA_Explore()
            case .minimalLuxe:    VariantB_Explore()
            case .richImmersive:  VariantC_Explore()
            }
        case .songs:
            switch selectedVariant {
            case .refinedCurrent: VariantA_Songs()
            case .minimalLuxe:    VariantB_Songs()
            case .richImmersive:  VariantC_Songs()
            }
        case .poems:
            switch selectedVariant {
            case .refinedCurrent: VariantA_Poems()
            case .minimalLuxe:    VariantB_Poems()
            case .richImmersive:  VariantC_Poems()
            }
        case .nowPlaying:
            switch selectedVariant {
            case .refinedCurrent: VariantA_NowPlaying()
            case .minimalLuxe:    VariantB_NowPlaying()
            case .richImmersive:  VariantC_NowPlaying()
            }
        // New screens — Variant A only
        case .miniPlayer:  VariantA_MiniPlayer()
        case .createType:  VariantA_CreateType()
        case .poemDetail:  VariantA_PoemDetail()
        case .auth:        VariantA_Auth()
        case .onboarding:  VariantA_Onboarding()
        case .landing:     VariantA_Landing()
        }
    }
}

// MARK: - Sample Data

private struct SampleSong {
    let title: String
    let recipient: String
    let occasion: String
    let style: String
    let emoji: String
    let duration: String
}

private let sampleSongs: [SampleSong] = [
    SampleSong(title: "Song for Chioma", recipient: "Chioma", occasion: "Celebration", style: "Pop", emoji: "🎉", duration: "1:23"),
    SampleSong(title: "Song for Mom", recipient: "Mom", occasion: "Birthday", style: "Pop", emoji: "🎂", duration: "1:45"),
    SampleSong(title: "Song for Alex", recipient: "Alex", occasion: "Birthday", style: "R&B", emoji: "🎂", duration: "1:12"),
]

private struct SamplePoem {
    let title: String
    let recipient: String
    let occasion: String
    let preview: String
}

private let samplePoems: [SamplePoem] = [
    SamplePoem(title: "For Dad", recipient: "Dad", occasion: "Thank You", preview: "Through every storm you held the light, a steady hand through darkest night..."),
    SamplePoem(title: "Anniversary Words", recipient: "Sarah", occasion: "Anniversary", preview: "Ten years of mornings, ten years of grace, ten years of finding home in your face..."),
]

private let sampleOccasions: [(String, String)] = [
    ("🎂", "Birthday"), ("💍", "Anniversary"), ("🙏", "Thank You"),
    ("❤️", "I Love You"), ("💒", "Wedding"), ("🎓", "Graduation"),
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - VARIANT A: Refined Current
// Polishes existing Velvet & Gold. Better spacing,
// consistent headers, subtle card borders, clean hierarchy.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

struct VariantA_Explore: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                sectionHeader("Explore", icon: nil)
                    .padding(.bottom, 8)

                // Hero
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold.opacity(0.7), DesignTokens.goldDark.opacity(0.4)],
                            startPoint: .topTrailing, endPoint: .bottomLeading))
                        .frame(height: 160)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Every moment")
                            .font(DesignTokens.displayFont(size: 22))
                        Text("deserves a song.")
                            .font(DesignTokens.displayFont(size: 22))
                        Text("Create something personal")
                            .font(DesignTokens.bodyFont(size: 13))
                            .opacity(0.7)
                    }
                    .foregroundStyle(.white)
                    .padding(16)
                }
                .frame(height: 160)
                .padding(.horizontal, 20)
                .padding(.bottom, 24)

                // CTA
                goldCTA("Create a Song", icon: "sparkles")
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)

                // Recent songs preview
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Recent")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        Text("See All")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.gold)
                    }
                    .padding(.horizontal, 20)

                    ForEach(sampleSongs, id: \.title) { song in
                        songCardA(song)
                            .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 24)

                // Occasions
                VStack(alignment: .leading, spacing: 12) {
                    Text("Create for an Occasion")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.horizontal, 20)
                    occasionChipsRow()
                }
                .padding(.bottom, 120)
            }
        }
    }
}

struct VariantA_Songs: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                sectionHeader("My Songs", icon: "line.3.horizontal.decrease")
                    .padding(.bottom, 12)

                // Song count
                HStack {
                    Text("\(sampleSongs.count) songs")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textTertiary)
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.arrow.down")
                            .font(.system(size: 12))
                        Text("Recent")
                            .font(DesignTokens.bodyFont(size: 13))
                    }
                    .foregroundStyle(DesignTokens.textSecondary)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                ForEach(sampleSongs, id: \.title) { song in
                    songCardA(song)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 12)
                }

                Spacer(minLength: 120)
            }
        }
    }
}

struct VariantA_Poems: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                sectionHeader("My Poems", icon: "line.3.horizontal.decrease")
                    .padding(.bottom, 12)

                if samplePoems.isEmpty {
                    emptyStateView(icon: "doc.text", title: "No Poems Yet", subtitle: "Express your feelings through beautifully crafted words", ctaLabel: "Create Your First Poem")
                } else {
                    ForEach(samplePoems, id: \.title) { poem in
                        poemCardA(poem)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 12)
                    }
                }

                Spacer(minLength: 120)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - VARIANT A: New Screen Samples
// NowPlaying, MiniPlayer, CreateType, PoemDetail,
// Auth, Onboarding, Landing — Variant A only.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// MARK: Now Playing — Shared Data

private let nowPlayingLyrics: [String] = [
    "Happy birthday, dear Chioma,",
    "This one's just for you,",
    "Every candle on the cake tonight,",
    "Is a wish I'm sending through.",
    "From the first day that I met you,",   // index 4 = current
    "To the memories we've made,",
    "So blow 'em out and make a wish,",
    "Under golden lights we glow,",
    "Happy birthday, dear Chioma,",
    "More than you will ever know.",
]
private let nowPlayingCurrentLine = 4

// ────────────────────────────────────────────────────
// MARK: Variant A — "Velvet Spotlight"
// Card-based with dramatically improved contrast.
// Deep umber background, strong dark overlay, bold
// current line with radial gold glow.
// ────────────────────────────────────────────────────

struct VariantA_NowPlaying: View {
    @State private var progress: Double = 0.35

    var body: some View {
        VStack(spacing: 0) {
            // Drag indicator
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 12)

            // ═══ Album art with lyrics overlay ═══
            ZStack {
                // Layer 1: Deep warm umber gradient (replaces muddy gold)
                RoundedRectangle(cornerRadius: 20)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(hex: "#1A1408"),
                                Color(hex: "#2A1A0A"),
                                Color(hex: "#1A1408")
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                // Layer 2: Subtle radial gold glow (centered warmth)
                RoundedRectangle(cornerRadius: 20)
                    .fill(
                        RadialGradient(
                            colors: [
                                DesignTokens.gold.opacity(0.15),
                                .clear
                            ],
                            center: .center,
                            startRadius: 20,
                            endRadius: 200
                        )
                    )

                // Layer 3: Strong dark overlay for text readability
                RoundedRectangle(cornerRadius: 20)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.80),
                                Color.black.opacity(0.75),
                                Color.black.opacity(0.80)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                // Layer 4: Lyrics overlaid
                VStack(spacing: 14) {
                    ForEach(Array(nowPlayingLyrics.enumerated()), id: \.offset) { idx, line in
                        let isCurrent = idx == nowPlayingCurrentLine
                        Text(line)
                            .font(DesignTokens.displayFont(
                                size: isCurrent ? 22 : 16,
                                weight: isCurrent ? .bold : .regular
                            ))
                            .foregroundStyle(.white.opacity(variantAOpacity(for: idx)))
                            .multilineTextAlignment(.center)
                            .shadow(
                                color: isCurrent ? DesignTokens.gold.opacity(0.6) : .clear,
                                radius: 16
                            )
                            .padding(.vertical, isCurrent ? 4 : 0)
                            .background(
                                isCurrent
                                    ? RadialGradient(
                                        colors: [DesignTokens.gold.opacity(0.12), .clear],
                                        center: .center, startRadius: 0, endRadius: 120)
                                    : nil
                            )
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                // Edge fades — taller for smoother falloff
                .mask(
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                            .frame(height: 48)
                        Color.white
                        LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: 48)
                    }
                )
            }
            .frame(height: 340)
            .padding(.horizontal, 20)
            .overlay(
                // Gold indicator bar — 2pt fading
                RoundedRectangle(cornerRadius: 20)
                    .stroke(
                        LinearGradient(
                            colors: [DesignTokens.gold.opacity(0.5), DesignTokens.gold.opacity(0.15)],
                            startPoint: .top, endPoint: .bottom),
                        lineWidth: 2
                    )
                    .padding(.horizontal, 20)
            )

            // Song info
            VStack(spacing: 4) {
                Text("Song for Chioma")
                    .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Pop · Birthday Celebration")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .padding(.top, 20)
            .padding(.bottom, 16)

            // Progress bar
            nowPlayingProgressBar(progress: progress)

            // Transport controls
            nowPlayingTransport(playButtonSize: 56, playIconSize: 22, buttonColor: .white, iconColor: DesignTokens.gold)

            // Bottom actions
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
                    .foregroundStyle(.black)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(DesignTokens.gold)
                    .clipShape(.rect(cornerRadius: 22))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 34)
        }
    }

    private func variantAOpacity(for index: Int) -> Double {
        if index == nowPlayingCurrentLine { return 1.0 }
        let distance = abs(index - nowPlayingCurrentLine)
        switch distance {
        case 1: return 0.45
        case 2: return 0.35
        default: return 0.20
        }
    }
}

// ────────────────────────────────────────────────────
// MARK: Variant B — "Cinematic Full-Bleed"
// Full-screen immersive. No card container.
// Lyrics own the entire viewport with cinema-like
// spacing and glassmorphism controls.
// ────────────────────────────────────────────────────

struct VariantB_NowPlaying: View {
    @State private var progress: Double = 0.35

    var body: some View {
        ZStack {
            // Full-screen gradient background
            LinearGradient(
                colors: [
                    Color(hex: "#0F0A05"),
                    Color(hex: "#0A0A0A"),
                    Color(hex: "#050505")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            // Subtle radial gold glow behind lyrics
            RadialGradient(
                colors: [DesignTokens.gold.opacity(0.08), .clear],
                center: .center,
                startRadius: 10,
                endRadius: 300
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top: progress bar + song info overlay
                VStack(spacing: 0) {
                    // Full-width progress line
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color.white.opacity(0.1))
                                .frame(height: 2)
                            Rectangle()
                                .fill(DesignTokens.gold)
                                .frame(width: geo.size.width * progress, height: 2)
                        }
                    }
                    .frame(height: 2)

                    // Song info — translucent, left-aligned
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Song for Chioma")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Pop · Birthday Celebration")
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        Spacer()
                        // Timestamps
                        Text("0:29 / 1:23")
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Color.black.opacity(0.4))
                }

                Spacer()

                // ═══ Lyrics — center of screen ═══
                VStack(spacing: 20) {
                    ForEach(Array(nowPlayingLyrics.enumerated()), id: \.offset) { idx, line in
                        let isCurrent = idx == nowPlayingCurrentLine
                        Text(line)
                            .font(DesignTokens.displayFont(
                                size: isCurrent ? 26 : 15,
                                weight: isCurrent ? .bold : .regular
                            ))
                            .foregroundStyle(.white.opacity(variantBOpacity(for: idx)))
                            .multilineTextAlignment(.center)
                            .scaleEffect(isCurrent ? 1.08 : 1.0)
                            .shadow(
                                color: isCurrent ? DesignTokens.gold.opacity(0.5) : .clear,
                                radius: 20
                            )
                            .blur(radius: variantBBlur(for: idx))
                            .animation(.easeInOut(duration: 0.4), value: isCurrent)
                    }
                }
                .padding(.horizontal, 28)
                // Tall edge fades for cinematic look
                .mask(
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                            .frame(height: 64)
                        Color.white
                        LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: 80)
                    }
                )

                Spacer()

                // ═══ Bottom controls — glassmorphism panel ═══
                VStack(spacing: 16) {
                    // Transport
                    nowPlayingTransport(playButtonSize: 52, playIconSize: 20, buttonColor: .white, iconColor: DesignTokens.gold)

                    // Bottom row
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
                            .foregroundStyle(.black)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(DesignTokens.gold)
                            .clipShape(.rect(cornerRadius: 22))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.vertical, 16)
                .background(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
                .padding(.bottom, 20)
            }
        }
    }

    private func variantBOpacity(for index: Int) -> Double {
        if index == nowPlayingCurrentLine { return 1.0 }
        let distance = abs(index - nowPlayingCurrentLine)
        switch distance {
        case 1: return 0.30
        case 2: return 0.20
        default: return 0.12
        }
    }

    private func variantBBlur(for index: Int) -> CGFloat {
        let distance = abs(index - nowPlayingCurrentLine)
        if distance <= 1 { return 0 }
        return CGFloat(distance - 1) * 0.5
    }
}

// ────────────────────────────────────────────────────
// MARK: Variant C — "Editorial"
// Magazine typography. Left-aligned. Pure black bg.
// Current line in gold Playfair. Typography IS the design.
// ────────────────────────────────────────────────────

struct VariantC_NowPlaying: View {
    @State private var progress: Double = 0.35

    var body: some View {
        ZStack {
            // Pure black — no gradients, no album art
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar — small caps title + progress
                VStack(spacing: 12) {
                    HStack {
                        Text("SONG FOR CHIOMA")
                            .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .tracking(2.0)
                        Spacer()
                        Text("Pop · Birthday")
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 16)

                    // Thin gold progress line
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color.white.opacity(0.08))
                                .frame(height: 1.5)
                            Rectangle()
                                .fill(DesignTokens.gold)
                                .frame(width: geo.size.width * progress, height: 1.5)
                        }
                    }
                    .frame(height: 1.5)
                    .padding(.horizontal, 24)

                    // Timestamps
                    HStack {
                        Text("0:29")
                            .font(DesignTokens.bodyFont(size: 10))
                            .foregroundStyle(DesignTokens.textTertiary)
                        Spacer()
                        Text("1:23")
                            .font(DesignTokens.bodyFont(size: 10))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(.horizontal, 24)
                }

                Spacer()

                // ═══ Lyrics — left-aligned, editorial ═══
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(Array(nowPlayingLyrics.enumerated()), id: \.offset) { idx, line in
                        let isCurrent = idx == nowPlayingCurrentLine

                        VStack(alignment: .leading, spacing: 0) {
                            // Gold horizontal rule above current line
                            if isCurrent {
                                Rectangle()
                                    .fill(DesignTokens.gold.opacity(0.6))
                                    .frame(width: 40, height: 2)
                                    .padding(.bottom, 8)
                            }

                            Text(line)
                                .font(isCurrent
                                    ? DesignTokens.displayFont(size: 28)
                                    : DesignTokens.bodyFont(size: 16))
                                .foregroundStyle(isCurrent
                                    ? DesignTokens.gold
                                    : .white.opacity(variantCOpacity(for: idx)))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.horizontal, 24)
                // Edge fades
                .mask(
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                            .frame(height: 48)
                        Color.white
                        LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: 64)
                    }
                )

                Spacer()

                // ═══ Controls — understated editorial ═══
                VStack(spacing: 16) {
                    // Transport — smaller, gold-toned
                    HStack(spacing: 36) {
                        Image(systemName: "gobackward.15")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)

                        ZStack {
                            Circle()
                                .fill(DesignTokens.gold)
                                .frame(width: 44, height: 44)
                            Image(systemName: "play.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(.black)
                        }

                        Image(systemName: "goforward.15")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }

                    // Bottom row — ghost share button
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
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 34)
            }
        }
    }

    private func variantCOpacity(for index: Int) -> Double {
        if index == nowPlayingCurrentLine { return 1.0 }
        let distance = abs(index - nowPlayingCurrentLine)
        switch distance {
        case 1: return 0.30
        case 2: return 0.22
        default: return 0.14
        }
    }
}

// MARK: Now Playing — Shared Components

private func nowPlayingProgressBar(progress: Double) -> some View {
    VStack(spacing: 6) {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.border)
                    .frame(height: 3)
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold)
                    .frame(width: geo.size.width * progress, height: 3)
            }
        }
        .frame(height: 3)
        HStack {
            Text("0:29")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
            Spacer()
            Text("1:23")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
        }
    }
    .padding(.horizontal, 20)
    .padding(.bottom, 16)
}

private func nowPlayingTransport(playButtonSize: CGFloat, playIconSize: CGFloat, buttonColor: Color, iconColor: Color) -> some View {
    HStack(spacing: 36) {
        Image(systemName: "gobackward.15")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(DesignTokens.textPrimary)

        ZStack {
            Circle()
                .fill(buttonColor)
                .frame(width: playButtonSize, height: playButtonSize)
            Image(systemName: "play.fill")
                .font(.system(size: playIconSize))
                .foregroundStyle(iconColor)
        }

        Image(systemName: "goforward.15")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(DesignTokens.textPrimary)
    }
    .padding(.bottom, 16)
}

// MARK: Mini Player

struct VariantA_MiniPlayer: View {
    var body: some View {
        VStack {
            Spacer()

            Text("Mini Player Preview")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)
                .padding(.bottom, 8)

            // The mini player bar
            VStack(spacing: 0) {
                // Gold accent line on top
                Rectangle()
                    .fill(DesignTokens.gold)
                    .frame(height: 1)

                HStack(spacing: 12) {
                    // Artwork
                    RoundedRectangle(cornerRadius: 8)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold, DesignTokens.goldDark],
                            startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: "music.note")
                                .font(.system(size: 16))
                                .foregroundStyle(.white)
                        )

                    // Song info
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Song for Chioma")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineLimit(1)
                        Text("For Chioma · Celebration")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    // Controls
                    HStack(spacing: 16) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(DesignTokens.gold)
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
            }

            // Simulated tab bar space
            Rectangle()
                .fill(Color(hex: "#111111"))
                .frame(height: 83)
        }
    }
}

// MARK: Create Type Selection

struct VariantA_CreateType: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header
                Text("What would you\nlike to create?")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.top, 32)
                    .padding(.bottom, 32)

                // Song card
                createTypeCard(
                    icon: "music.note.list",
                    title: "A Song",
                    description: "Create a personalized song for someone special. Choose an occasion, add a message, and hear it in your voice.",
                    gradientColors: [DesignTokens.gold.opacity(0.3), DesignTokens.gold.opacity(0.05)]
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 14)

                // Poem card
                createTypeCard(
                    icon: "text.book.closed",
                    title: "A Poem",
                    description: "Craft heartfelt words for any moment. Personalize with their name, occasion, and your feelings.",
                    gradientColors: [DesignTokens.roseGold.opacity(0.2), DesignTokens.roseGold.opacity(0.05)]
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 32)

                // Hint text
                Text("Not sure? Start with a song")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textTertiary)

                Spacer(minLength: 120)
            }
        }
    }

    private func createTypeCard(icon: String, title: String, description: String, gradientColors: [Color]) -> some View {
        HStack(spacing: 16) {
            // Gold gradient left accent
            RoundedRectangle(cornerRadius: 4)
                .fill(LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.goldDark],
                    startPoint: .top, endPoint: .bottom))
                .frame(width: 4, height: 80)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundStyle(DesignTokens.gold)
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                Text(description)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineSpacing(3)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
        }
        .padding(16)
        .frame(height: 120)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(LinearGradient(colors: gradientColors, startPoint: .leading, endPoint: .trailing))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }
}

// MARK: Poem Detail

struct VariantA_PoemDetail: View {
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button {} label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                Spacer()
                Button {} label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .frame(height: 56)

            // Poem card (matches real PoemFullView card design)
            ScrollView {
                VStack(spacing: 16) {
                    // Decorative top glyph
                    Text("✦ ─── ✦")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.gold.opacity(0.5))

                    // Recipient name
                    Text("For Dad")
                        .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    // Occasion tag
                    Text("A Thank You Poem")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .tracking(1)

                    // Fading gold divider
                    poemDivider

                    // Poem verses (centered, italic serif)
                    VStack(spacing: 20) {
                        poemVerse("Through every storm you held the light,\nA steady hand through darkest night.\nYou taught me strength without a word,\nThe bravest voice I ever heard.")

                        poemVerse("For every lesson, every prayer,\nFor showing up and being there—\nThis gratitude runs deeper still\nThan any words could ever fill.")

                        poemVerse("So here's to you, my guiding star,\nWho loved me just the way we are.")
                    }
                    .padding(.horizontal, 8)

                    // Fading gold divider
                    poemDivider

                    // Attribution
                    Text("With love, from you")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)

                    // Decorative bottom glyph
                    Text("✦")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.gold.opacity(0.5))
                }
                .padding(32)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(DesignTokens.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 24)
                                .stroke(
                                    LinearGradient(
                                        colors: [
                                            DesignTokens.gold.opacity(0.7),
                                            DesignTokens.gold.opacity(0.2),
                                            DesignTokens.gold.opacity(0.7)
                                        ],
                                        startPoint: .top, endPoint: .bottom
                                    ),
                                    lineWidth: 1
                                )
                        )
                        .shadow(color: DesignTokens.gold.opacity(0.12), radius: 40, y: 8)
                )
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)

            // Action bar
            HStack(spacing: 12) {
                Button {} label: {
                    HStack(spacing: 8) {
                        Image(systemName: "speaker.wave.2.fill")
                            .font(.system(size: 14))
                        Text("Listen")
                            .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    }
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DesignTokens.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 25)
                            .stroke(DesignTokens.border, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 25))
                }
                .buttonStyle(.plain)

                Button {} label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14))
                        Text("Share")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 25))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 34)
        }
    }

    private var poemDivider: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        DesignTokens.gold.opacity(0),
                        DesignTokens.gold,
                        DesignTokens.gold.opacity(0)
                    ],
                    startPoint: .leading, endPoint: .trailing
                )
            )
            .frame(width: 200, height: 1)
    }

    private func poemVerse(_ text: String) -> some View {
        Text(text)
            .font(DesignTokens.displayFont(size: 16, relativeTo: .body))
            .italic()
            .foregroundStyle(DesignTokens.textPrimary)
            .multilineTextAlignment(.center)
            .lineSpacing(6)
            .frame(maxWidth: .infinity)
    }
}

// MARK: Auth

struct VariantA_Auth: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Header
            VStack(spacing: 12) {
                Text("Welcome")
                    .font(DesignTokens.displayFont(size: 32))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Create personalized songs for birthdays,\nanniversaries, and every moment that matters.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .padding(.horizontal, 20)

            Spacer()

            // Sign in buttons
            VStack(spacing: 14) {
                // Sign in with Apple
                Button {} label: {
                    HStack(spacing: 10) {
                        Image(systemName: "apple.logo")
                            .font(.system(size: 20))
                        Text("Sign in with Apple")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(.black)
                    .clipShape(.rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.2), lineWidth: 1))
                }
                .buttonStyle(.plain)

                // Phone number
                Button {} label: {
                    HStack(spacing: 10) {
                        Image(systemName: "phone")
                            .font(.system(size: 18))
                        Text("Continue with Phone")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(DesignTokens.gold)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(.clear)
                    .clipShape(.rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(DesignTokens.gold, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)

            // Legal text
            Text("By continuing, you agree to our Terms of Service\nand Privacy Policy.")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.bottom, 40)
        }
    }
}

// MARK: Onboarding

struct VariantA_Onboarding: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 40) {
                // Page 1
                onboardingPage(
                    icon: "waveform",
                    iconSize: 48,
                    title: "Every moment\ndeserves a song",
                    subtitle: "Create personalized songs that sound like you singing, for the people you love.",
                    pageIndex: 0
                )

                // Divider
                Rectangle().fill(DesignTokens.border).frame(height: 0.5).padding(.horizontal, 40)

                // Page 2
                onboardingPage(
                    icon: "sparkles",
                    iconSize: 44,
                    title: "Create in\nseconds",
                    subtitle: "Pick an occasion, write a message, and we'll craft a unique song in under 90 seconds.",
                    pageIndex: 1
                )

                // Divider
                Rectangle().fill(DesignTokens.border).frame(height: 0.5).padding(.horizontal, 40)

                // Page 3
                onboardingPage(
                    icon: "gift",
                    iconSize: 44,
                    title: "Share the\nfeeling",
                    subtitle: "Send your song as a gift link. They'll hear your voice singing just for them.",
                    pageIndex: 2
                )

                // CTA
                goldCTA("Get Started", icon: "arrow.right")
                    .padding(.horizontal, 20)

                // Page dots
                HStack(spacing: 8) {
                    ForEach(0..<3) { i in
                        Circle()
                            .fill(i == 2 ? DesignTokens.gold : DesignTokens.textTertiary.opacity(0.4))
                            .frame(width: 8, height: 8)
                    }
                }
                .padding(.bottom, 40)
            }
        }
    }

    private func onboardingPage(icon: String, iconSize: CGFloat, title: String, subtitle: String, pageIndex: Int) -> some View {
        VStack(spacing: 20) {
            // Icon
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.12))
                    .frame(width: 96, height: 96)
                Image(systemName: icon)
                    .font(.system(size: iconSize))
                    .foregroundStyle(DesignTokens.gold)
            }

            // Title
            Text(title)
                .font(DesignTokens.displayFont(size: 28))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            // Subtitle
            Text(subtitle)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 32)
        }
    }
}

// MARK: Landing

struct VariantA_Landing: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Hero text
            VStack(spacing: 16) {
                Text("Your moment,\nin a song.")
                    .font(DesignTokens.displayFont(size: 42))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)

                Text("Create personalized songs for the\nmoments that matter")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }

            Spacer().frame(height: 40)

            // Waveform visualizer
            HStack(spacing: 3) {
                ForEach(0..<24, id: \.self) { i in
                    let height: CGFloat = waveformHeight(index: i)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold, DesignTokens.goldDark],
                            startPoint: .top, endPoint: .bottom))
                        .frame(width: 4, height: height)
                }
            }
            .frame(height: 44)
            .padding(.bottom, 40)

            Spacer()

            // CTAs
            VStack(spacing: 16) {
                goldCTA("Create account", icon: "person.badge.plus")
                    .padding(.horizontal, 20)

                Button {} label: {
                    Text("Already have an account? ")
                        .foregroundStyle(DesignTokens.textSecondary)
                    + Text("Sign in")
                        .foregroundStyle(DesignTokens.gold)
                }
                .font(DesignTokens.bodyFont(size: 14))
                .buttonStyle(.plain)
            }
            .padding(.bottom, 48)
        }
    }

    private func waveformHeight(index: Int) -> CGFloat {
        // Organic waveform shape — taller in the center, shorter at edges
        let center = 11.5
        let distance = abs(Double(index) - center) / center
        let base: CGFloat = 8
        let waveHeightScale: CGFloat = 36
        let variation: CGFloat = CGFloat(((index * 7 + 3) % 5)) * 3 // pseudo-random variation
        return base + waveHeightScale * CGFloat(1.0 - distance * distance) + variation
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - VARIANT B: Minimal Luxe
// Typography-driven. Maximum whitespace. Softer gold.
// Thinner cards, divider-based lists, no borders.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

private let softGold = Color(hex: "#C8A882")

struct VariantB_Explore: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header - larger, airy
                HStack(alignment: .firstTextBaseline) {
                    Text("Explore")
                        .font(DesignTokens.displayFont(size: 34))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .light))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 32)

                // Hero text - no card, just beautiful type
                VStack(alignment: .leading, spacing: 8) {
                    Text("Create something\nbeautiful.")
                        .font(DesignTokens.displayFont(size: 32))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineSpacing(4)
                    Text("Personalized songs for the moments that matter.")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)

                // CTA - understated
                Button {} label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .medium))
                        Text("New Song")
                            .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(softGold)
                    .clipShape(.rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 24)
                .padding(.bottom, 40)

                // Recent - divider-based list
                VStack(alignment: .leading, spacing: 0) {
                    Text("RECENT")
                        .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .tracking(1.2)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 16)

                    ForEach(Array(sampleSongs.enumerated()), id: \.element.title) { idx, song in
                        HStack(spacing: 14) {
                            Circle()
                                .fill(softGold.opacity(0.15))
                                .frame(width: 44, height: 44)
                                .overlay(Text(song.emoji).font(.system(size: 18)))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(song.title)
                                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                    .foregroundStyle(DesignTokens.textPrimary)
                                Text("\(song.occasion) · \(song.style)")
                                    .font(DesignTokens.bodyFont(size: 13))
                                    .foregroundStyle(DesignTokens.textTertiary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 14)

                        if idx < sampleSongs.count - 1 {
                            Divider().background(DesignTokens.border).padding(.leading, 82)
                        }
                    }
                }
                .padding(.bottom, 32)

                // Occasions - text-only pills
                VStack(alignment: .leading, spacing: 16) {
                    Text("OCCASIONS")
                        .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .tracking(1.2)
                        .padding(.horizontal, 24)

                    ScrollView(.horizontal) {
                        HStack(spacing: 10) {
                            ForEach(sampleOccasions, id: \.1) { _, name in
                                Text(name)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                    .foregroundStyle(DesignTokens.textSecondary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(Color(hex: "#131313"))
                                    .clipShape(.rect(cornerRadius: 20))
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 120)
            }
        }
    }
}

struct VariantB_Songs: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Songs")
                        .font(DesignTokens.displayFont(size: 34))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Text("\(sampleSongs.count)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 24)

                ForEach(Array(sampleSongs.enumerated()), id: \.element.title) { idx, song in
                    HStack(spacing: 14) {
                        Circle()
                            .fill(softGold.opacity(0.15))
                            .frame(width: 44, height: 44)
                            .overlay(Text(song.emoji).font(.system(size: 18)))

                        VStack(alignment: .leading, spacing: 3) {
                            Text(song.title)
                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("\(song.style) · \(song.recipient) · \(song.duration)")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }
                        Spacer()
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(softGold)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)

                    if idx < sampleSongs.count - 1 {
                        Divider().background(DesignTokens.border).padding(.leading, 82)
                    }
                }

                Spacer(minLength: 120)
            }
        }
    }
}

struct VariantB_Poems: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Poems")
                        .font(DesignTokens.displayFont(size: 34))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Text("\(samplePoems.count)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 24)

                ForEach(samplePoems, id: \.title) { poem in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(poem.title)
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Spacer()
                            Text(poem.occasion)
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }
                        Text(poem.preview)
                            .font(DesignTokens.displayFont(size: 15, relativeTo: .body))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(2)
                            .lineSpacing(4)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)

                    Divider().background(DesignTokens.border).padding(.leading, 24)
                }

                Spacer(minLength: 120)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - VARIANT C: Rich & Immersive
// Deeper gradients, bolder presence, larger artwork,
// gold glow effects, grid occasions, visual texture.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

struct VariantC_Explore: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header with greeting
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Good afternoon")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                        Text("Explore")
                            .font(DesignTokens.displayFont(size: 30, weight: .semibold))
                            .foregroundStyle(DesignTokens.gold)
                    }
                    Spacer()
                    HStack(spacing: 12) {
                        circleIconButton("magnifyingglass")
                        circleIconButton("bell")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)

                // Rich hero
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 20)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold.opacity(0.9), DesignTokens.gold.opacity(0.5), Color(hex: "#2A1A0A")],
                            startPoint: .topTrailing, endPoint: .bottomLeading))
                        .frame(height: 200)
                    RoundedRectangle(cornerRadius: 20)
                        .fill(LinearGradient(
                            colors: [.clear, .black.opacity(0.4)],
                            startPoint: .top, endPoint: .bottom))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Express yourself, for them")
                            .font(DesignTokens.displayFont(size: 26, weight: .semibold))
                        Text("Personalized songs for the moments that matter")
                            .font(DesignTokens.bodyFont(size: 14))
                            .opacity(0.8)
                    }
                    .foregroundStyle(.white)
                    .padding(20)
                }
                .frame(height: 200)
                .padding(.horizontal, 20)
                .shadow(color: DesignTokens.gold.opacity(0.15), radius: 20, y: 8)
                .padding(.bottom, 20)

                // Stats ribbon
                statsRibbon()
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)

                // CTA with glow
                Button {} label: {
                    HStack(spacing: 10) {
                        Image(systemName: "sparkles").font(.system(size: 20))
                        Text("Create a Song").font(DesignTokens.bodyFont(size: 16, weight: .bold))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                    .background(LinearGradient(
                        colors: [DesignTokens.gold, Color(hex: "#E8C49A")],
                        startPoint: .leading, endPoint: .trailing))
                    .clipShape(.rect(cornerRadius: 16))
                    .shadow(color: DesignTokens.gold.opacity(0.35), radius: 12, y: 4)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.bottom, 28)

                // Songs preview
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Your Songs")
                            .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        Text("See All")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                    }
                    .padding(.horizontal, 20)

                    ForEach(sampleSongs, id: \.title) { song in
                        richSongCard(song)
                            .padding(.horizontal, 20)
                    }
                }
                .padding(.bottom, 28)

                // Occasions grid
                VStack(alignment: .leading, spacing: 14) {
                    Text("Create for")
                        .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.horizontal, 20)

                    LazyVGrid(columns: [
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10)
                    ], spacing: 10) {
                        ForEach(sampleOccasions, id: \.1) { emoji, name in
                            VStack(spacing: 6) {
                                Text(emoji).font(.system(size: 24))
                                Text(name)
                                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                    .foregroundStyle(DesignTokens.textPrimary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(RoundedRectangle(cornerRadius: 14).fill(DesignTokens.surface)
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(DesignTokens.border, lineWidth: 0.5)))
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.bottom, 120)
            }
        }
    }
}

struct VariantC_Songs: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("My Songs")
                            .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("\(sampleSongs.count) songs created")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    Spacer()
                    circleIconButton("line.3.horizontal.decrease")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .padding(.bottom, 8)

                ForEach(sampleSongs, id: \.title) { song in
                    richSongCard(song)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 12)
                }

                Spacer(minLength: 120)
            }
        }
    }
}

struct VariantC_Poems: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("My Poems")
                            .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("\(samplePoems.count) poems written")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    Spacer()
                    circleIconButton("line.3.horizontal.decrease")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .padding(.bottom, 8)

                ForEach(samplePoems, id: \.title) { poem in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(poem.title)
                                    .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                                    .foregroundStyle(DesignTokens.textPrimary)
                                HStack(spacing: 6) {
                                    Text("For \(poem.recipient)")
                                        .font(DesignTokens.bodyFont(size: 13))
                                        .foregroundStyle(DesignTokens.textSecondary)
                                    Text("·")
                                        .foregroundStyle(DesignTokens.textTertiary)
                                    Text(poem.occasion)
                                        .font(DesignTokens.bodyFont(size: 13))
                                        .foregroundStyle(DesignTokens.gold)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }

                        // Poem preview with serif font
                        Text(poem.preview)
                            .font(DesignTokens.displayFont(size: 14, relativeTo: .body))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(2)
                            .lineSpacing(6)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(DesignTokens.gold.opacity(0.05))
                            )
                    }
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(DesignTokens.surface)
                    )
                    .padding(.horizontal, 20)
                    .padding(.bottom, 12)
                }

                Spacer(minLength: 120)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - Shared Components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

private func sectionHeader(_ title: String, icon: String?) -> some View {
    HStack {
        Text(title)
            .font(DesignTokens.displayFont(size: 28))
            .foregroundStyle(DesignTokens.textPrimary)
        Spacer()
        if let icon {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }
    .padding(.horizontal, 20)
    .frame(height: 56)
}

private func goldCTA(_ label: String, icon: String) -> some View {
    Button {} label: {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 18))
            Text(label).font(DesignTokens.bodyFont(size: 16, weight: .semibold))
        }
        .foregroundStyle(.black)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(DesignTokens.gold)
        .clipShape(.rect(cornerRadius: 14))
    }
    .buttonStyle(.plain)
}

private func songCardA(_ song: SampleSong) -> some View {
    HStack(spacing: 12) {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.goldDark],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 56, height: 56)
            Image(systemName: "music.note")
                .font(.system(size: 20))
                .foregroundStyle(.white)
        }

        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(song.title)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Ready")
                    .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(DesignTokens.success)
                    .clipShape(.rect(cornerRadius: 4))
                Spacer()
            }
            HStack {
                Text("\(song.style) · \(song.recipient) · \(song.occasion)")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
                Text(song.duration)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
        Spacer()
        Image(systemName: "play.circle.fill")
            .font(.system(size: 36))
            .foregroundStyle(DesignTokens.gold)
    }
    .padding(12)
    .background(DesignTokens.surface)
    .clipShape(.rect(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 0.5))
}

private func poemCardA(_ poem: SamplePoem) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        HStack {
            Text(poem.title)
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Text(poem.occasion)
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.gold)
        }
        Text("For \(poem.recipient)")
            .font(DesignTokens.bodyFont(size: 13))
            .foregroundStyle(DesignTokens.textSecondary)
        Text(poem.preview)
            .font(DesignTokens.displayFont(size: 14, relativeTo: .body))
            .foregroundStyle(DesignTokens.textSecondary)
            .lineLimit(2)
            .lineSpacing(4)
    }
    .padding(14)
    .background(DesignTokens.surface)
    .clipShape(.rect(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 0.5))
}

private func richSongCard(_ song: SampleSong) -> some View {
    HStack(spacing: 14) {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.goldDark],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 72, height: 72)
            VStack(spacing: 2) {
                Text(song.emoji).font(.system(size: 22))
                Image(systemName: "music.note")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.8))
            }
        }

        VStack(alignment: .leading, spacing: 4) {
            Text(song.title)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("\(song.style) · \(song.recipient)")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
            HStack(spacing: 4) {
                Circle().fill(DesignTokens.success).frame(width: 6, height: 6)
                Text("Ready · \(song.duration)")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundStyle(DesignTokens.success)
            }
        }
        Spacer()
        Image(systemName: "play.circle.fill")
            .font(.system(size: 36))
            .foregroundStyle(DesignTokens.gold)
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16).fill(DesignTokens.surface))
}

private func circleIconButton(_ icon: String) -> some View {
    Circle()
        .fill(DesignTokens.surface)
        .frame(width: 40, height: 40)
        .overlay(
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
        )
}

private func statsRibbon() -> some View {
    HStack(spacing: 0) {
        statItem(icon: "music.note.list", value: "3", label: "Songs")
        Divider().frame(height: 30).background(DesignTokens.border)
        statItem(icon: "waveform", value: "1", label: "Voice")
        Divider().frame(height: 30).background(DesignTokens.border)
        statItem(icon: "star.fill", value: "5", label: "Credits")
    }
    .padding(.vertical, 14)
    .background(
        RoundedRectangle(cornerRadius: 14).fill(DesignTokens.surface)
            .overlay(RoundedRectangle(cornerRadius: 14)
                .stroke(LinearGradient(
                    colors: [DesignTokens.gold.opacity(0.3), DesignTokens.border],
                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
    )
}

private func statItem(icon: String, value: String, label: String) -> some View {
    VStack(spacing: 4) {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(DesignTokens.gold)
            Text(value).font(DesignTokens.bodyFont(size: 18, weight: .bold)).foregroundStyle(DesignTokens.textPrimary)
        }
        Text(label).font(DesignTokens.bodyFont(size: 11)).foregroundStyle(DesignTokens.textTertiary)
    }
    .frame(maxWidth: .infinity)
}

private func occasionChipsRow() -> some View {
    ScrollView(.horizontal) {
        HStack(spacing: 8) {
            ForEach(sampleOccasions, id: \.1) { emoji, name in
                HStack(spacing: 6) {
                    Text(emoji).font(.system(size: 14))
                    Text(name).font(DesignTokens.bodyFont(size: 14, weight: .medium))
                }
                .foregroundStyle(DesignTokens.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(DesignTokens.borderSubtle, lineWidth: 1))
            }
        }
        .padding(.horizontal, 20)
    }
    .scrollIndicators(.hidden)
}

private func emptyStateView(icon: String, title: String, subtitle: String, ctaLabel: String) -> some View {
    VStack(spacing: 16) {
        Spacer().frame(height: 80)

        ZStack {
            Circle()
                .fill(DesignTokens.gold.opacity(0.12))
                .frame(width: 100, height: 100)
            Image(systemName: icon)
                .font(.system(size: 36))
                .foregroundStyle(DesignTokens.gold)
        }

        Text(title)
            .font(DesignTokens.bodyFont(size: 20, weight: .semibold))
            .foregroundStyle(DesignTokens.textPrimary)

        Text(subtitle)
            .font(DesignTokens.bodyFont(size: 15))
            .foregroundStyle(DesignTokens.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 40)

        goldCTA(ctaLabel, icon: "plus.circle")
            .padding(.horizontal, 40)
            .padding(.top, 8)
    }
}

// MARK: - Preview

#Preview {
    DesignSampleView()
}
