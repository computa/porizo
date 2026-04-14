//
//  LivingSplashView.swift
//  PorizoApp
//
//  Screen 1: Living Splash — animated personal-song artifact.
//  Visual-only: audio is managed by OnboardingV2View (parent) so it persists across screens.
//  Auto-advances after 4 seconds or on tap.
//

import SwiftUI

struct LivingSplashView: View {
    let demoURL: String?
    let recipientLabel: String?
    let lyricsPreview: String?
    let onAdvance: () -> Void
    let onAudioPlayed: ((_ trigger: String) -> Void)?

    @State private var showContent = false
    @State private var waveformPhase = false
    @State private var autoAdvanceTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing24) {
                Spacer()

                // Personal-song artifact card
                VStack(spacing: DesignTokens.spacing16) {
                    // Cover art
                    ZStack {
                        RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)
                            .fill(
                                LinearGradient(
                                    colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 200, height: 200)

                        VStack(spacing: DesignTokens.spacing12) {
                            Image(systemName: "music.note")
                                .font(.system(size: 40))
                                .foregroundStyle(.white.opacity(0.4))
                                .accessibilityHidden(true)

                            Text(recipientLabel ?? "For Mom")
                                .font(DesignTokens.displayFont(size: 22))
                                .foregroundStyle(.white)

                            StaticWaveformBars(
                                heights: [6, 12, 18, 24, 18, 12, 6],
                                barWidth: 3,
                                spacing: 3,
                                color: .white.opacity(0.7)
                            )
                            .scaleEffect(waveformPhase ? 1.05 : 0.95)
                            .accessibilityHidden(true)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("A personal song for \(recipientLabel ?? "Mom")")
                    }
                    .shadow(color: DesignTokens.gold.opacity(0.2), radius: 20, y: 8)

                    // Lyric preview line
                    if let preview = lyricsPreview, !preview.isEmpty {
                        Text(preview)
                            .font(DesignTokens.displayFont(size: 16, relativeTo: .subheadline))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .italic()
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, DesignTokens.spacing32)
                    }
                }
                .opacity(showContent ? 1 : 0)
                .scaleEffect(reduceMotion ? 1 : (showContent ? 1 : 0.9))

                Spacer()

                // Tap to continue hint
                Text("Tap anywhere to continue")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .opacity(showContent ? 0.6 : 0)
                    .padding(.bottom, DesignTokens.spacing32)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            autoAdvanceTask?.cancel()
            onAdvance()
        }
        .onAppear {
            if reduceMotion {
                showContent = true
            } else {
                withAnimation(.easeOut(duration: 0.8)) { showContent = true }
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                    waveformPhase = true
                }
            }
            // Auto-advance after 4 seconds
            autoAdvanceTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled else { return }
                onAdvance()
            }
        }
        .onDisappear { autoAdvanceTask?.cancel() }
        .accessibilityIdentifier("onboarding-living-splash")
    }
}
