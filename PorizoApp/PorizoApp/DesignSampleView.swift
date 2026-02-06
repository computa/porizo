//
//  DesignSampleView.swift
//  PorizoApp
//
//  Debug-only view showing 3 design directions for Explore, Songs, and Poems.
//  Launch with --design-samples to access.
//

import SwiftUI

#if DEBUG

// MARK: - Design Sample Picker

struct DesignSampleView: View {
    @State private var selectedVariant: DesignVariant = {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--variant-b") { return .minimalLuxe }
        if args.contains("--variant-c") { return .richImmersive }
        return .refinedCurrent
    }()
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
            case .explore, .songs, .poems: return true
            default: return false
            }
        }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                controlBar
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
                                .foregroundColor(selectedVariant == variant ? .black : DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .background(selectedVariant == variant ? DesignTokens.gold : DesignTokens.surface)
                                .cornerRadius(8)
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
                        .foregroundColor(selectedScreen == screen ? DesignTokens.gold : DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background(selectedScreen == screen ? DesignTokens.gold.opacity(0.1) : .clear)
                        .cornerRadius(6)
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
        // New screens — Variant A only
        case .nowPlaying:  VariantA_NowPlaying()
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
                    .foregroundColor(.white)
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
                            .foregroundColor(DesignTokens.textPrimary)
                        Spacer()
                        Text("See All")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.gold)
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
                        .foregroundColor(DesignTokens.textPrimary)
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
                        .foregroundColor(DesignTokens.textTertiary)
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.arrow.down")
                            .font(.system(size: 12))
                        Text("Recent")
                            .font(DesignTokens.bodyFont(size: 13))
                    }
                    .foregroundColor(DesignTokens.textSecondary)
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

// MARK: Now Playing

struct VariantA_NowPlaying: View {
    @State private var progress: Double = 0.35
    private let currentLineIndex = 4

    private let allLyrics: [String] = [
        "Happy birthday, dear Chioma,",
        "This one's just for you,",
        "Every candle on the cake tonight,",
        "Is a wish I'm sending through.",
        "From the first day that I met you,",   // ← current
        "To the memories we've made,",
        "So blow 'em out and make a wish,",
        "Under golden lights we glow,",
        "Happy birthday, dear Chioma,",
        "More than you will ever know.",
    ]

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
                // Layer 1: Gold gradient album art
                RoundedRectangle(cornerRadius: 20)
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

                // Layer 2: Subtle pattern overlay (music note motif)
                VStack(spacing: 24) {
                    ForEach(0..<3, id: \.self) { row in
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
                RoundedRectangle(cornerRadius: 20)
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

                // Layer 4: Lyrics overlaid
                VStack(spacing: 8) {
                    ForEach(Array(allLyrics.enumerated()), id: \.offset) { idx, line in
                        Text(line)
                            .font(DesignTokens.displayFont(
                                size: idx == currentLineIndex ? 20 : 15,
                                weight: idx == currentLineIndex ? .semibold : .regular
                            ))
                            .foregroundColor(.white.opacity(lyricOpacity(for: idx)))
                            .multilineTextAlignment(.center)
                            .shadow(
                                color: idx == currentLineIndex
                                    ? DesignTokens.gold.opacity(0.5)
                                    : .clear,
                                radius: 12
                            )
                            .padding(.vertical, idx == currentLineIndex ? 2 : 0)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                // Fade top and bottom edges of lyrics
                .mask(
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .white], startPoint: .top, endPoint: .bottom)
                            .frame(height: 24)
                        Color.white
                        LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: 24)
                    }
                )
            }
            .frame(height: 320)
            .padding(.horizontal, 20)
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(DesignTokens.gold.opacity(0.3), lineWidth: 0.5)
                    .padding(.horizontal, 20)
            )

            // Song info
            VStack(spacing: 4) {
                Text("Song for Chioma")
                    .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                Text("Pop · Birthday Celebration")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.top, 20)
            .padding(.bottom, 16)

            // Progress bar
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
                        .foregroundColor(DesignTokens.textTertiary)
                    Spacer()
                    Text("1:23")
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 16)

            // Transport controls
            HStack(spacing: 36) {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)

                ZStack {
                    Circle()
                        .fill(.white)
                        .frame(width: 56, height: 56)
                    Image(systemName: "play.fill")
                        .font(.system(size: 22))
                        .foregroundColor(DesignTokens.gold)
                }

                Image(systemName: "goforward.15")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .padding(.bottom, 16)

            // Bottom actions
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
                Button {} label: {
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
            .padding(.horizontal, 20)
            .padding(.bottom, 34)
        }
    }

    private func lyricOpacity(for index: Int) -> Double {
        if index == currentLineIndex { return 1.0 }
        let distance = abs(index - currentLineIndex)
        return max(0.12, 1.0 - Double(distance) * 0.22)
    }
}

// MARK: Mini Player

struct VariantA_MiniPlayer: View {
    var body: some View {
        VStack {
            Spacer()

            Text("Mini Player Preview")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textTertiary)
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
                                .foregroundColor(.white)
                        )

                    // Song info
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Song for Chioma")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                            .lineLimit(1)
                        Text("For Chioma · Celebration")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundColor(DesignTokens.textSecondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    // Controls
                    HStack(spacing: 16) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 20))
                            .foregroundColor(DesignTokens.gold)
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textTertiary)
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
                    .foregroundColor(DesignTokens.textPrimary)
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
                    .foregroundColor(DesignTokens.textTertiary)

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
                        .foregroundColor(DesignTokens.gold)
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                }
                Text(description)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineSpacing(3)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
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
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                Spacer()
                Button {} label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .frame(height: 56)

            // Poem card (matches real PoemFullView card design)
            ScrollView(showsIndicators: false) {
                VStack(spacing: 16) {
                    // Decorative top glyph
                    Text("✦ ─── ✦")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.gold.opacity(0.5))

                    // Recipient name
                    Text("For Dad")
                        .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)

                    // Occasion tag
                    Text("A Thank You Poem")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
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
                        .foregroundColor(DesignTokens.textTertiary)

                    // Decorative bottom glyph
                    Text("✦")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.gold.opacity(0.5))
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

            // Action bar
            HStack(spacing: 12) {
                Button {} label: {
                    HStack(spacing: 8) {
                        Image(systemName: "speaker.wave.2.fill")
                            .font(.system(size: 14))
                        Text("Listen")
                            .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    }
                    .foregroundColor(DesignTokens.textPrimary)
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
                    .foregroundColor(.black)
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
            .font(DesignTokens.displayFont(size: 16))
            .italic()
            .foregroundColor(DesignTokens.textPrimary)
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
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Create personalized songs for birthdays,\nanniversaries, and every moment that matters.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textSecondary)
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
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(.black)
                    .cornerRadius(14)
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
                    .foregroundColor(DesignTokens.gold)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(.clear)
                    .cornerRadius(14)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(DesignTokens.gold, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)

            // Legal text
            Text("By continuing, you agree to our Terms of Service\nand Privacy Policy.")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundColor(DesignTokens.textTertiary)
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
                    .foregroundColor(DesignTokens.gold)
            }

            // Title
            Text(title)
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            // Subtitle
            Text(subtitle)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundColor(DesignTokens.textSecondary)
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
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)

                Text("Create personalized songs for the\nmoments that matter")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textSecondary)
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
                        .foregroundColor(DesignTokens.textSecondary)
                    + Text("Sign in")
                        .foregroundColor(DesignTokens.gold)
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
        let amplitude: CGFloat = 36
        let variation: CGFloat = CGFloat(((index * 7 + 3) % 5)) * 3 // pseudo-random variation
        return base + amplitude * CGFloat(1.0 - distance * distance) + variation
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
                        .foregroundColor(DesignTokens.textPrimary)
                    Spacer()
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .light))
                        .foregroundColor(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 32)

                // Hero text - no card, just beautiful type
                VStack(alignment: .leading, spacing: 8) {
                    Text("Create something\nbeautiful.")
                        .font(DesignTokens.displayFont(size: 32))
                        .foregroundColor(DesignTokens.textPrimary)
                        .lineSpacing(4)
                    Text("Personalized songs for the moments that matter.")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundColor(DesignTokens.textSecondary)
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
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(softGold)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 24)
                .padding(.bottom, 40)

                // Recent - divider-based list
                VStack(alignment: .leading, spacing: 0) {
                    Text("RECENT")
                        .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                        .foregroundColor(DesignTokens.textTertiary)
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
                                    .foregroundColor(DesignTokens.textPrimary)
                                Text("\(song.occasion) · \(song.style)")
                                    .font(DesignTokens.bodyFont(size: 13))
                                    .foregroundColor(DesignTokens.textTertiary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(DesignTokens.textTertiary)
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
                        .foregroundColor(DesignTokens.textTertiary)
                        .tracking(1.2)
                        .padding(.horizontal, 24)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(sampleOccasions, id: \.1) { _, name in
                                Text(name)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                    .foregroundColor(DesignTokens.textSecondary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(Color(hex: "#131313"))
                                    .cornerRadius(20)
                            }
                        }
                        .padding(.horizontal, 24)
                    }
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
                        .foregroundColor(DesignTokens.textPrimary)
                    Spacer()
                    Text("\(sampleSongs.count)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textTertiary)
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
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("\(song.style) · \(song.recipient) · \(song.duration)")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                        Spacer()
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 36))
                            .foregroundColor(softGold)
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
                        .foregroundColor(DesignTokens.textPrimary)
                    Spacer()
                    Text("\(samplePoems.count)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 24)

                ForEach(samplePoems, id: \.title) { poem in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(poem.title)
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Text(poem.occasion)
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                        Text(poem.preview)
                            .font(DesignTokens.displayFont(size: 15))
                            .foregroundColor(DesignTokens.textSecondary)
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
                            .foregroundColor(DesignTokens.textSecondary)
                        Text("Explore")
                            .font(DesignTokens.displayFont(size: 30, weight: .semibold))
                            .foregroundColor(DesignTokens.gold)
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
                    .foregroundColor(.white)
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
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                    .background(LinearGradient(
                        colors: [DesignTokens.gold, Color(hex: "#E8C49A")],
                        startPoint: .leading, endPoint: .trailing))
                    .cornerRadius(16)
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
                            .foregroundColor(DesignTokens.textPrimary)
                        Spacer()
                        Text("See All")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.gold)
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
                        .foregroundColor(DesignTokens.textPrimary)
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
                                    .foregroundColor(DesignTokens.textPrimary)
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
                            .foregroundColor(DesignTokens.textPrimary)
                        Text("\(sampleSongs.count) songs created")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundColor(DesignTokens.textSecondary)
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
                            .foregroundColor(DesignTokens.textPrimary)
                        Text("\(samplePoems.count) poems written")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundColor(DesignTokens.textSecondary)
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
                                    .foregroundColor(DesignTokens.textPrimary)
                                HStack(spacing: 6) {
                                    Text("For \(poem.recipient)")
                                        .font(DesignTokens.bodyFont(size: 13))
                                        .foregroundColor(DesignTokens.textSecondary)
                                    Text("·")
                                        .foregroundColor(DesignTokens.textTertiary)
                                    Text(poem.occasion)
                                        .font(DesignTokens.bodyFont(size: 13))
                                        .foregroundColor(DesignTokens.gold)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(DesignTokens.textTertiary)
                        }

                        // Poem preview with serif font
                        Text(poem.preview)
                            .font(DesignTokens.displayFont(size: 14))
                            .foregroundColor(DesignTokens.textSecondary)
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
            .foregroundColor(DesignTokens.textPrimary)
        Spacer()
        if let icon {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)
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
        .foregroundColor(.black)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(DesignTokens.gold)
        .cornerRadius(14)
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
                .foregroundColor(.white)
        }

        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(song.title)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                Text("Ready")
                    .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(DesignTokens.success)
                    .cornerRadius(4)
                Spacer()
            }
            HStack {
                Text("\(song.style) · \(song.recipient) · \(song.occasion)")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
                Spacer()
                Text(song.duration)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textTertiary)
            }
        }
        Spacer()
        Image(systemName: "play.circle.fill")
            .font(.system(size: 36))
            .foregroundColor(DesignTokens.gold)
    }
    .padding(12)
    .background(DesignTokens.surface)
    .cornerRadius(12)
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 0.5))
}

private func poemCardA(_ poem: SamplePoem) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        HStack {
            Text(poem.title)
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)
            Spacer()
            Text(poem.occasion)
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundColor(DesignTokens.gold)
        }
        Text("For \(poem.recipient)")
            .font(DesignTokens.bodyFont(size: 13))
            .foregroundColor(DesignTokens.textSecondary)
        Text(poem.preview)
            .font(DesignTokens.displayFont(size: 14))
            .foregroundColor(DesignTokens.textSecondary)
            .lineLimit(2)
            .lineSpacing(4)
    }
    .padding(14)
    .background(DesignTokens.surface)
    .cornerRadius(12)
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
                    .foregroundColor(.white.opacity(0.8))
            }
        }

        VStack(alignment: .leading, spacing: 4) {
            Text(song.title)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)
            Text("\(song.style) · \(song.recipient)")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textSecondary)
            HStack(spacing: 4) {
                Circle().fill(DesignTokens.success).frame(width: 6, height: 6)
                Text("Ready · \(song.duration)")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundColor(DesignTokens.success)
            }
        }
        Spacer()
        Image(systemName: "play.circle.fill")
            .font(.system(size: 36))
            .foregroundColor(DesignTokens.gold)
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
                .foregroundColor(DesignTokens.textPrimary)
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
            Image(systemName: icon).font(.system(size: 12)).foregroundColor(DesignTokens.gold)
            Text(value).font(DesignTokens.bodyFont(size: 18, weight: .bold)).foregroundColor(DesignTokens.textPrimary)
        }
        Text(label).font(DesignTokens.bodyFont(size: 11)).foregroundColor(DesignTokens.textTertiary)
    }
    .frame(maxWidth: .infinity)
}

private func occasionChipsRow() -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
            ForEach(sampleOccasions, id: \.1) { emoji, name in
                HStack(spacing: 6) {
                    Text(emoji).font(.system(size: 14))
                    Text(name).font(DesignTokens.bodyFont(size: 14, weight: .medium))
                }
                .foregroundColor(DesignTokens.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .cornerRadius(22)
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(DesignTokens.borderSubtle, lineWidth: 1))
            }
        }
        .padding(.horizontal, 20)
    }
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
                .foregroundColor(DesignTokens.gold)
        }

        Text(title)
            .font(DesignTokens.bodyFont(size: 20, weight: .semibold))
            .foregroundColor(DesignTokens.textPrimary)

        Text(subtitle)
            .font(DesignTokens.bodyFont(size: 15))
            .foregroundColor(DesignTokens.textSecondary)
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

#endif
