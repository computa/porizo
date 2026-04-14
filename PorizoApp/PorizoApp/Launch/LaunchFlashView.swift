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
    let apiClient: APIClient?
    let onDismiss: () -> Void
    let onPrimaryActionRequested: () -> Void
    let onDisableRequested: () -> Void

    @State private var viewModel: LaunchFlashViewModel
    @State private var showContent = false
    @State private var waveformPhase = false
    @State private var failsafeTask: Task<Void, Never>?
    @State private var audioFetchTask: Task<Void, Never>?
    @State private var showDisableAlert = false
    @State private var dismissalType: String = "tap"
    @State private var appearedAt: Date = .init()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    // VoiceOver auto-dismiss timer.
    private static let voiceOverDismissSeconds: TimeInterval = 4.0
    // Owned-track URL fetch budget — beyond this, give up and stay visual-only.
    private static let lazyAudioFetchTimeoutSeconds: TimeInterval = 2.5

    init(
        content: LaunchFlashContent,
        apiClient: APIClient?,
        onDismiss: @escaping () -> Void,
        onPrimaryActionRequested: @escaping () -> Void,
        onDisableRequested: @escaping () -> Void
    ) {
        self.content = content
        self.apiClient = apiClient
        self.onDismiss = onDismiss
        self.onPrimaryActionRequested = onPrimaryActionRequested
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
                bottomArea
            }
            .padding(.horizontal, DesignTokens.spacing20)

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss(type: "skip_button")
                    } label: {
                        Text("Skip")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(DesignTokens.surface.opacity(0.9))
                            .clipShape(Capsule())
                    }
                    .padding(.top, DesignTokens.spacing24)
                    .padding(.trailing, DesignTokens.spacing20)
                    .accessibilityIdentifier("launch-flash-skip")
                }
                Spacer()
            }
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

    @ViewBuilder
    private var bottomArea: some View {
        VStack(spacing: DesignTokens.spacing12) {
            if content.source == .suggestion {
                Button {
                    onPrimaryActionRequested()
                } label: {
                    HStack(spacing: DesignTokens.spacing8) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 16))
                        Text("Make This Song")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .goldGlow()
                .accessibilityIdentifier("launch-flash-primary-cta")
            }

            Text(content.source == .suggestion ? "Or tap anywhere to continue" : "Tap anywhere to continue")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)
                .opacity(showContent ? 0.6 : 0)
                .accessibilityHidden(true)
        }
        .padding(.bottom, DesignTokens.spacing32)
    }

    private var coralGradient: LinearGradient {
        LinearGradient(
            colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var shouldShowPlayAffordance: Bool {
        // Show "Listen" whenever audio has been loaded successfully and is
        // currently paused, including owned tracks that fetched audio lazily.
        viewModel.canResumePlayback
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

            if content.audioURL != nil {
                // Direct path: demo / suggestion already has a URL
                #if DEBUG
                print("[LaunchFlash] handleAppear — direct audio path (URL already present)")
                #endif
                viewModel.startAudio()
            } else if let trackId = content.trackId, let client = apiClient {
                // Lazy path: owned tracks need an async fetch for the version URL.
                // Visual stays up; audio fades in if/when the URL resolves.
                #if DEBUG
                print("[LaunchFlash] handleAppear — lazy fetch needed for trackId: \(trackId)")
                #endif
                audioFetchTask = Task { @MainActor in
                    if let url = await fetchAudioURL(for: trackId, using: client) {
                        guard !Task.isCancelled, !viewModel.hasDismissed else { return }
                        #if DEBUG
                        print("[LaunchFlash] handleAppear — lazy fetch succeeded, starting audio")
                        #endif
                        viewModel.startAudio(with: url)
                    } else {
                        #if DEBUG
                        print("[LaunchFlash] handleAppear — lazy fetch returned nil, staying visual-only")
                        #endif
                    }
                }
            } else {
                #if DEBUG
                print("[LaunchFlash] handleAppear — no audio path: trackId=\(content.trackId ?? "nil"), apiClient=\(apiClient != nil ? "set" : "nil"), audioURL=nil")
                #endif
            }

            // No normal-user auto-dismiss. Launch flash is explicitly user-controlled:
            // tap anywhere or use the visible Skip affordance.
        }
    }

    private func handleDisappear() {
        failsafeTask?.cancel()
        failsafeTask = nil
        audioFetchTask?.cancel()
        audioFetchTask = nil
        viewModel.dismiss()
    }

    /// Async-fetch the latest playable version URL for an owned track.
    /// Returns nil on timeout / failure / cancellation — caller stays visual-only.
    private func fetchAudioURL(for trackId: String, using client: APIClient) async -> URL? {
        do {
            let details = try await withTimeout(seconds: Self.lazyAudioFetchTimeoutSeconds) {
                try await client.getTrack(trackId: trackId)
            }
            guard let (_, urlString) = details.latestPlayableVersion(), !urlString.isEmpty else {
                return nil
            }
            let transformed = transformAudioUrl(urlString, baseURL: client.baseURL)
            LocalCache.shared.savePlayableAudioURL(transformed, for: trackId)
            return URL(string: transformed)
        } catch {
            #if DEBUG
            print("[LaunchFlash] Lazy audio fetch failed for \(trackId): \(error.localizedDescription)")
            #endif
            return nil
        }
    }

    private func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw CancellationError()
            }
            guard let result = try await group.next() else { throw CancellationError() }
            group.cancelAll()
            return result
        }
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
