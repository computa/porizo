//
//  RevealBloomView.swift
//  PorizoApp
//
//  Full-screen coral gradient bloom — the moment the song is ready.
//  Gold center blooms outward through coral into the parchment background,
//  with Play as the dominant call-to-action.
//

import SwiftUI

struct RevealBloomView: View {
    let recipientName: String
    let occasion: String?
    let onPlay: () -> Void
    let onShare: () -> Void
    let onEditLyrics: () -> Void
    let onSaveToLibrary: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var bloomScale: CGFloat = 1.0
    @State private var wavePhases: [Bool] = Array(repeating: false, count: 7)
    @State private var checkmarkOpacity: Double = 0
    @State private var contentOpacity: Double = 0
    @State private var playButtonScale: CGFloat = 0.5

    var body: some View {
        ZStack {
            // MARK: - Radial Bloom Background

            bloomBackground

            // MARK: - Content

            ScrollView(showsIndicators: false) {
                VStack(spacing: DesignTokens.spacing24) {
                    Spacer()
                        .frame(height: 60)

                    // Frosted checkmark
                    checkmarkCircle

                    // "For {recipientName}"
                    Text("For \(recipientName)")
                        .font(DesignTokens.displayFont(size: 36))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.25), radius: 8, y: 2)
                        .multilineTextAlignment(.center)

                    // Occasion subtitle
                    if let subtitle = occasionSubtitle {
                        Text(subtitle)
                            .font(DesignTokens.bodyFont(size: 18))
                            .foregroundStyle(.white.opacity(0.8))
                    }

                    // Animated waveform
                    waveformBars
                        .padding(.top, DesignTokens.spacing8)

                    // Play button — dominant CTA
                    playButton
                        .padding(.top, DesignTokens.spacing16)

                    // Hint text
                    Text("Tap to play your song")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(.white.opacity(0.6))

                    // Share secondary button
                    shareButton
                        .padding(.top, DesignTokens.spacing8)

                    // Tertiary links
                    tertiaryLinks

                    Spacer()
                        .frame(height: 40)
                }
                .padding(.horizontal, DesignTokens.spacing20)
                .frame(maxWidth: .infinity)
            }
            .opacity(contentOpacity)
        }
        .ignoresSafeArea()
        .task {
            await startAnimations()
        }
    }

    // MARK: - Bloom Background

    private var bloomBackground: some View {
        GeometryReader { geometry in
            RadialGradient(
                stops: [
                    .init(color: DesignTokens.gold, location: 0),
                    .init(color: Color(hex: "#C45A32"), location: 0.4),
                    .init(color: DesignTokens.background, location: 1.0)
                ],
                center: .center,
                startRadius: 0,
                endRadius: geometry.size.height * 0.6
            )
            .scaleEffect(bloomScale)
            .ignoresSafeArea()
        }
    }

    // MARK: - Checkmark Circle

    private var checkmarkCircle: some View {
        ZStack {
            Circle()
                .fill(.ultraThinMaterial)
                .frame(width: 56, height: 56)

            Text("\u{2713}")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)
        }
        .opacity(checkmarkOpacity)
    }

    // MARK: - Waveform Bars

    private var waveformBars: some View {
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(.white)
                    .frame(width: 4, height: 24)
                    .scaleEffect(
                        y: wavePhases[index] ? 1.0 : 0.5,
                        anchor: .center
                    )
            }
        }
        .frame(height: 24)
        .accessibilityHidden(true)
    }

    // MARK: - Play Button (Dominant CTA)

    private var playButton: some View {
        Button(action: onPlay) {
            ZStack {
                Circle()
                    .fill(.white)
                    .frame(width: 80, height: 80)
                    .shadow(color: .black.opacity(0.2), radius: 12, y: 4)

                Image(systemName: "play.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(DesignTokens.gold)
                    .offset(x: 2) // Optical center for play triangle
            }
        }
        .scaleEffect(playButtonScale)
        .accessibilityLabel("Play your song for \(recipientName)")
    }

    // MARK: - Share Button

    private var shareButton: some View {
        Button(action: onShare) {
            Text("Share with \(recipientName)")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
                .frame(maxWidth: 280)
                .padding(.vertical, 14)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        }
        .accessibilityLabel("Share song with \(recipientName)")
    }

    // MARK: - Tertiary Links

    private var tertiaryLinks: some View {
        HStack(spacing: DesignTokens.spacing24) {
            Button("Edit lyrics", action: onEditLyrics)
            Button("Save to library", action: onSaveToLibrary)
        }
        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
        .foregroundStyle(.white.opacity(0.7))
    }

    // MARK: - Occasion Subtitle

    private var occasionSubtitle: String? {
        guard let occasion = occasion?.lowercased() else { return nil }
        switch occasion {
        case "birthday": return "Happy Birthday \u{1F382}"
        case "anniversary": return "Happy Anniversary \u{1F491}"
        case "thank_you": return "Thank You \u{1F64F}"
        case "i_love_you": return "With Love \u{2764}\u{FE0F}"
        case "wedding": return "Congratulations \u{1F492}"
        case "graduation": return "Congratulations \u{1F393}"
        case "friendship": return "For a Great Friend \u{1F31F}"
        case "encouragement": return "You Got This \u{1F4AA}"
        case "advice": return "Words of Wisdom \u{1F9ED}"
        case "bereavement": return "In Loving Memory \u{1F54A}\u{FE0F}"
        case "apology": return "I\u{2019}m Sorry \u{1F490}"
        case "get_well": return "Get Well Soon \u{1F33B}"
        case "celebration": return "Let\u{2019}s Celebrate \u{1F389}"
        default: return nil
        }
    }

    // MARK: - Animation Choreography

    private func startAnimations() async {
        guard !reduceMotion else {
            // Static state: no animations, everything visible immediately
            checkmarkOpacity = 1
            contentOpacity = 1
            playButtonScale = 1.0
            wavePhases = Array(repeating: true, count: 7)
            return
        }

        // 1. Bloom background breathes: scale 1.0 → 1.5 over 6s, repeat forever
        withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
            bloomScale = 1.5
        }

        // 2. Fade in content
        withAnimation(.easeOut(duration: 0.6).delay(0.2)) {
            contentOpacity = 1.0
        }

        // 3. Checkmark appears
        withAnimation(.easeOut(duration: 0.4).delay(0.3)) {
            checkmarkOpacity = 1.0
        }

        // 4. Play button springs in
        withAnimation(.spring(response: 0.5, dampingFraction: 0.65).delay(0.5)) {
            playButtonScale = 1.0
        }

        // 5. Waveform bars stagger in with perpetual bounce
        for index in 0..<7 {
            let staggerDelay = 0.6 + Double(index) * 0.1
            withAnimation(
                .easeInOut(duration: 1.2)
                .repeatForever(autoreverses: true)
                .delay(staggerDelay)
            ) {
                wavePhases[index] = true
            }
        }
    }
}

// MARK: - Preview

#Preview("Birthday") {
    RevealBloomView(
        recipientName: "Sarah",
        occasion: "birthday",
        onPlay: {},
        onShare: {},
        onEditLyrics: {},
        onSaveToLibrary: {}
    )
}

#Preview("No Occasion") {
    RevealBloomView(
        recipientName: "Mom",
        occasion: nil,
        onPlay: {},
        onShare: {},
        onEditLyrics: {},
        onSaveToLibrary: {}
    )
}
