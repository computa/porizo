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
    /// Optional canonical 2048² artwork URL. When present, replaces the coral
    /// bloom gradient with the actual generated bouquet (blurred + dimmed so
    /// the white reveal text stays readable). Falls back to the gradient when
    /// nil (free tier without library v2, or library_not_bootstrapped errors).
    var artworkURL: URL? = nil
    var isPlaying: Bool = false
    var hasSavedToLibrary: Bool = false
    var shareDebugStatusLabel: String? = nil
    let onPlay: () -> Void
    let onShare: () -> Void
    /// When non-nil, the primary "Send to [recipientName]" button invokes this
    /// one-tap direct-send action instead of `onShare` (the system share sheet).
    /// Wired by the flow only when a recipient phone was captured.
    var onDirectSend: (() -> Void)? = nil
    let onEditLyrics: () -> Void
    let onSaveToLibrary: () -> Void
    var onListenFully: (() -> Void)?
    let onClose: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var bloomScale: CGFloat = 1.0
    @State private var wavePhases: [Bool] = Array(repeating: false, count: 7)
    @State private var checkmarkOpacity: Double = 0
    @State private var contentOpacity: Double = 0
    @State private var playButtonScale: CGFloat = 0.5
    @State private var revealHapticTrigger: Bool = false
    @State private var impactHapticTrigger: Bool = false
    @State private var cachedBloomSize: CGSize = .zero

    var body: some View {
        ZStack {
            // MARK: - Radial Bloom Background

            bloomBackground

            // MARK: - Content

            ScrollView {
                VStack(spacing: DesignTokens.spacing24) {
                    HStack {
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                                .frame(width: 40, height: 40)
                                .background(.white.opacity(0.14))
                                .clipShape(Circle())
                        }
                        .accessibilityIdentifier("reveal-exit-button")
                        .accessibilityLabel("Close reveal")
                    }
                    .padding(.top, 16)

                    Spacer()
                        .frame(height: 4)

                    // Frosted checkmark
                    checkmarkCircle

                    // "For {recipientName}"
                    Text("For \(recipientName)")
                        .font(DesignTokens.displayFont(size: 36))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.25), radius: 8, y: 2)
                        .multilineTextAlignment(.center)

                    // Occasion subtitle
                    if let subtitle = occasion.flatMap({ Occasion(rawValue: $0)?.greetingWithEmoji }) {
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

                    // Full player link
                    if let onListenFully {
                        Button(action: onListenFully) {
                            HStack(spacing: 4) {
                                Image(systemName: "text.quote")
                                    .font(.system(size: 12))
                                Text("Listen with lyrics")
                            }
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.8))
                        }
                        .accessibilityIdentifier("reveal-listen-button")
                        .accessibilityLabel("Open full player with lyrics")
                    }

                    // Share secondary button
                    shareButton
                        .padding(.top, DesignTokens.spacing8)

                    // F-3 — reaction-capture nudge (the content moment).
                    reactionPromptButton
                        .padding(.top, DesignTokens.spacing4)

                    if let shareDebugStatusLabel {
                        Text(shareDebugStatusLabel)
                            .font(.system(size: 1))
                            .foregroundStyle(.clear)
                            .opacity(0.01)
                            .accessibilityIdentifier("share-link-ready-indicator")
                            .accessibilityLabel(shareDebugStatusLabel)
                    }

                    // Tertiary links
                    tertiaryLinks

                    Spacer()
                        .frame(height: 40)
                }
                .padding(.horizontal, DesignTokens.spacing20)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .opacity(contentOpacity)
        }
        .ignoresSafeArea()
        .sensoryFeedback(.success, trigger: revealHapticTrigger)
        .sensoryFeedback(.impact(weight: .heavy, intensity: 0.8), trigger: impactHapticTrigger)
        .task {
            await startAnimations()
        }
    }

    // MARK: - Bloom Background

    /// When an artwork URL is available, render the generated bouquet as a
    /// blurred, dimmed backdrop that tints the screen with its colors. The
    /// existing reveal UI (checkmark, title, play CTA, share) overlays it.
    /// The bloomScale breathing animation still applies so the screen still
    /// pulses subtly.
    ///
    /// Falls back to the original coral RadialGradient when artworkURL is
    /// nil (e.g. free tier without library_v2, library-not-bootstrapped
    /// errors, share-link recipient on a model that hasn't generated yet).
    @ViewBuilder
    private var bloomBackground: some View {
        if let artworkURL = artworkURL {
            artworkBackdrop(url: artworkURL)
        } else {
            gradientBloom
        }
    }

    private var gradientBloom: some View {
        GeometryReader { geometry in
            RadialGradient(
                stops: [
                    .init(color: DesignTokens.gold, location: 0),
                    .init(color: Color(hex: "#C45A32"), location: 0.4),
                    .init(color: DesignTokens.background, location: 1.0)
                ],
                center: .center,
                startRadius: 0,
                endRadius: cachedBloomSize.height * 0.6
            )
            .scaleEffect(bloomScale)
            .ignoresSafeArea()
            .onAppear { cachedBloomSize = geometry.size }
            .onChange(of: geometry.size) { _, newSize in cachedBloomSize = newSize }
        }
    }

    private func artworkBackdrop(url: URL) -> some View {
        ZStack {
            // Layer 1: warm cream base so AsyncImage `.empty` doesn't flash black.
            DesignTokens.background
                .ignoresSafeArea()
            // Layer 2: artwork — full-bleed, scaled to fill, with a subtle
            // scale breathing animation to preserve the original bloom-pulse feel.
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .scaleEffect(bloomScale)
                        .ignoresSafeArea()
                default:
                    EmptyView()
                }
            }
            // Layer 3: warm coral wash to keep the brand identity + ensure
            // the white reveal text always passes contrast. 0.45 opacity is
            // enough to dim a bright photo without losing the bouquet underneath.
            LinearGradient(
                colors: [
                    DesignTokens.gold.opacity(0.55),
                    Color(hex: "#C45A32").opacity(0.45),
                    Color(hex: "#C45A32").opacity(0.65)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
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
        .accessibilityHidden(true)
    }

    // MARK: - Waveform Bars

    private var waveformBars: some View {
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(.white)
                    .frame(width: 4, height: 24)
                    .scaleEffect(
                        y: (wavePhases[index] && isPlaying) ? 1.0 : 0.5,
                        anchor: .center
                    )
                    .animation(
                        isPlaying
                            ? .easeInOut(duration: 1.2).repeatForever(autoreverses: true)
                            : .easeOut(duration: 0.3),
                        value: isPlaying
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
        .accessibilityIdentifier("reveal-play-button")
        .accessibilityLabel("Play your song for \(recipientName)")
    }

    // MARK: - Share Button

    private var shareButton: some View {
        Button(action: onDirectSend ?? onShare) {
            Text("Send to \(recipientName)")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
                .frame(maxWidth: 280)
                .padding(.vertical, 14)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        }
        .accessibilityIdentifier("reveal-share-button")
        .accessibilityLabel("Send song to \(recipientName)")
    }

    // F-3 — secondary prompt at the reveal: nudge capturing the recipient's
    // reaction (the highest-value sharable/TikTok moment). Same send action as the
    // primary CTA — framing, not a separate flow.
    private var reactionPromptButton: some View {
        Button(action: onShare) {
            Text("Send & see their reaction \u{2192}")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
        }
        .accessibilityIdentifier("reveal-reaction-button")
        .accessibilityLabel("Send to \(recipientName) and capture their reaction")
    }

    // MARK: - Tertiary Links

    private var tertiaryLinks: some View {
        HStack(spacing: DesignTokens.spacing24) {
            Button("Edit lyrics", action: onEditLyrics)
                .accessibilityIdentifier("reveal-edit-lyrics-button")
            Button(hasSavedToLibrary ? "Saved to library" : "Save to library", action: onSaveToLibrary)
                .accessibilityIdentifier("reveal-save-button")
                .disabled(hasSavedToLibrary)
        }
        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
        .foregroundStyle(.white.opacity(0.7))
    }

    // MARK: - Animation Choreography

    private func startAnimations() async {
        // Haptic feedback: the reveal should feel physical
        revealHapticTrigger.toggle()

        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }

        impactHapticTrigger.toggle()

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
        onSaveToLibrary: {},
        onClose: {}
    )
}

#Preview("No Occasion") {
    RevealBloomView(
        recipientName: "Mom",
        occasion: nil,
        onPlay: {},
        onShare: {},
        onEditLyrics: {},
        onSaveToLibrary: {},
        onClose: {}
    )
}
