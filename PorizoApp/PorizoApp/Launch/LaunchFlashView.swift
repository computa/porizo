//
//  LaunchFlashView.swift
//  PorizoApp
//
//  TikTok-style launch flash. Plays a personal song (or demo) full-screen
//  on every cold launch. Tap anywhere to dismiss.
//
//  Visual language mirrors LivingSplashView (used in onboarding) for brand
//  consistency. Audio + lifecycle owned by LaunchFlashViewModel.
//

import SwiftUI

struct LaunchFlashView: View {
    let content: LaunchFlashContent
    let onDismiss: () -> Void
    let onDisableRequested: () -> Void

    @State private var viewModel: LaunchFlashViewModel
    @State private var showContent = false
    @State private var waveformPhase = false
    @State private var failsafeTask: Task<Void, Never>?
    @State private var showDisableAlert = false
    @State private var dismissalType: String = "tap"
    @State private var appearedAt: Date = .init()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    // Failsafe: if user hasn't tapped after this long, auto-dismiss.
    private static let visibleFailsafeSeconds: TimeInterval = 15.0
    // VoiceOver auto-dismiss timer.
    private static let voiceOverDismissSeconds: TimeInterval = 4.0

    init(
        content: LaunchFlashContent,
        onDismiss: @escaping () -> Void,
        onDisableRequested: @escaping () -> Void
    ) {
        self.content = content
        self.onDismiss = onDismiss
        self.onDisableRequested = onDisableRequested
        _viewModel = State(initialValue: LaunchFlashViewModel(content: content))
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing24) {
                Spacer()
                songCard
                    .opacity(showContent ? 1 : 0)
                    .scaleEffect(reduceMotion ? 1 : (showContent ? 1 : 0.92))
                Spacer()
                bottomHint
            }
            .padding(.horizontal, DesignTokens.spacing20)
        }
        .contentShape(Rectangle())
        .onTapGesture { dismiss(type: "tap") }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 1.2)
                .onEnded { _ in showDisableAlert = true }
        )
        .onAppear { handleAppear() }
        .onDisappear { handleDisappear() }
        .alert("Hide launch flash?", isPresented: $showDisableAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Hide", role: .destructive) {
                onDisableRequested()
                dismiss(type: "long_press_disable")
            }
        } message: {
            Text("You can re-enable it in Settings.")
        }
        .accessibilityIdentifier("launch-flash")
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
    }

    // MARK: - Song Card

    private var songCard: some View {
        VStack(spacing: DesignTokens.spacing16) {
            // Cover artwork
            ZStack {
                if let coverURL = content.coverImageURL {
                    AsyncImage(url: coverURL) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            coralGradient
                        }
                    }
                    .frame(width: 200, height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay))
                } else {
                    RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)
                        .fill(coralGradient)
                        .frame(width: 200, height: 200)
                }

                VStack(spacing: DesignTokens.spacing12) {
                    if content.coverImageURL == nil {
                        Image(systemName: "music.note")
                            .font(.system(size: 36))
                            .foregroundStyle(.white.opacity(0.4))
                            .accessibilityHidden(true)
                    }

                    if let recipient = content.recipientName {
                        Text(recipient.hasPrefix("For ") ? recipient : "For \(recipient)")
                            .font(DesignTokens.displayFont(size: 22))
                            .foregroundStyle(.white)
                    }

                    if !content.title.isEmpty {
                        Text(content.title)
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.85))
                            .lineLimit(1)
                    }

                    StaticWaveformBars(
                        heights: [6, 12, 18, 24, 18, 12, 6],
                        barWidth: 3,
                        spacing: 3,
                        color: .white.opacity(0.7)
                    )
                    .scaleEffect(waveformPhase && !reduceMotion ? 1.05 : 0.95)
                    .accessibilityHidden(true)
                }
            }
            .shadow(color: DesignTokens.gold.opacity(0.2), radius: 20, y: 8)

            if let lyric = content.lyricPreview, !lyric.isEmpty {
                Text(lyric)
                    .font(DesignTokens.displayFont(size: 16, relativeTo: .subheadline))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .italic()
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.spacing32)
            }

            if shouldShowPlayAffordance {
                Button {
                    viewModel.resumePlayback()
                } label: {
                    HStack(spacing: DesignTokens.spacing8) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 14))
                        Text("Listen")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    }
                    .foregroundStyle(DesignTokens.gold)
                    .padding(.horizontal, DesignTokens.spacing16)
                    .padding(.vertical, DesignTokens.spacing8)
                    .background(DesignTokens.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(DesignTokens.gold.opacity(0.3), lineWidth: 0.5))
                }
                .accessibilityLabel("Play song preview")
            }
        }
    }

    private var bottomHint: some View {
        Text("Tap anywhere to continue")
            .font(DesignTokens.bodyFont(size: 13))
            .foregroundStyle(DesignTokens.textTertiary)
            .opacity(showContent ? 0.6 : 0)
            .padding(.bottom, DesignTokens.spacing32)
            .accessibilityHidden(true)
    }

    private var coralGradient: LinearGradient {
        LinearGradient(
            colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var shouldShowPlayAffordance: Bool {
        // Show "Listen" only when audio is available but not currently playing.
        content.audioURL != nil
            && !viewModel.isAudioPlaying
            && !viewModel.audioLoadFailed
            && !voiceOverEnabled
    }

    private var accessibilityDescription: String {
        var parts: [String] = ["Porizo."]
        parts.append("\(content.title).")
        if let recipient = content.recipientName {
            parts.append("For \(recipient).")
        }
        return parts.joined(separator: " ")
    }

    // MARK: - Lifecycle Handlers

    private func handleAppear() {
        appearedAt = Date()

        // Animate content in
        if reduceMotion {
            showContent = true
        } else {
            withAnimation(.easeOut(duration: 0.6)) { showContent = true }
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                waveformPhase = true
            }
        }

        // Audio: VoiceOver users get visual-only + announcement.
        if voiceOverEnabled {
            UIAccessibility.post(notification: .announcement, argument: accessibilityDescription)
            failsafeTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(Self.voiceOverDismissSeconds))
                guard !Task.isCancelled else { return }
                dismiss(type: "voiceover_auto")
            }
        } else {
            // Wire audio-started analytics
            viewModel.onAudioStarted = { delayMs in
                AnalyticsService.shared.log(.launchFlashAudioStarted, properties: [
                    "source": content.source.rawValue,
                    "first_frame_delay_ms": "\(delayMs)"
                ])
            }
            viewModel.startAudio()
            // 15-second visible failsafe (covers user who walks away mid-flash)
            failsafeTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(Self.visibleFailsafeSeconds))
                guard !Task.isCancelled else { return }
                dismiss(type: "auto_15s_failsafe")
            }
        }
    }

    private func handleDisappear() {
        failsafeTask?.cancel()
        failsafeTask = nil
        viewModel.dismiss()
    }

    // MARK: - Dismiss

    private func dismiss(type: String) {
        guard !viewModel.hasDismissed else { return }
        dismissalType = type

        // Light haptic on user-initiated tap dismissal
        if type == "tap" && !reduceMotion {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }

        viewModel.dismiss()
        failsafeTask?.cancel()
        failsafeTask = nil

        let durationMs = Int(Date().timeIntervalSince(appearedAt) * 1000)
        // History is recorded at decision time in RootView.nextStateAfterSplash()
        // so rotation works even when the user force-quits during the flash.
        AnalyticsService.shared.log(.launchFlashDismissed, properties: [
            "duration_ms": "\(durationMs)",
            "audio_finished_naturally": viewModel.didFinishNaturally ? "true" : "false",
            "dismissal_type": type
        ])

        onDismiss()
    }
}
