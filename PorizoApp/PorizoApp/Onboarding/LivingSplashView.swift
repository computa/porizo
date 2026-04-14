//
//  LivingSplashView.swift
//  PorizoApp
//
//  Screen 1: Living Splash — animated personal-song artifact with optional audio.
//  Auto-advances after 4 seconds or on tap.
//

import SwiftUI
import AVFoundation

struct LivingSplashView: View {
    let demoURL: String?
    let recipientLabel: String?
    let lyricsPreview: String?
    let onAdvance: () -> Void
    let onAudioPlayed: ((_ trigger: String) -> Void)?

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var loadFailed = false
    @State private var statusObserver: NSKeyValueObservation?
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
                                .font(DesignTokens.displayFont(size: 20, weight: .semibold, relativeTo: .headline))
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

                    // Play affordance when audio available but not autoplaying
                    if demoURL != nil && !loadFailed && !isPlaying {
                        Button {
                            togglePlayback()
                            onAudioPlayed?("tap")
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
                        .accessibilityIdentifier("onboarding-splash-play")
                        .accessibilityLabel("Play sample song")
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
            cleanup()
            onAdvance()
        }
        .onAppear {
            prepareAudio()
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
                cleanup()
                onAdvance()
            }
        }
        .onDisappear { cleanup() }
        .accessibilityIdentifier("onboarding-living-splash")
    }

    // MARK: - Audio

    private func prepareAudio() {
        guard let urlString = demoURL, let url = URL(string: urlString) else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            #if DEBUG
            print("[LivingSplash] Audio session setup failed: \(error.localizedDescription)")
            #endif
        }
        let item = AVPlayerItem(url: url)
        let avPlayer = AVPlayer(playerItem: item)
        avPlayer.volume = 0.5
        player = avPlayer

        // Observe item status to detect offline/load failures
        statusObserver = item.observe(\.status, options: [.new]) { observed, _ in
            Task { @MainActor in
                switch observed.status {
                case .failed:
                    loadFailed = true
                    isPlaying = false
                    #if DEBUG
                    print("[LivingSplash] Audio load failed: \(observed.error?.localizedDescription ?? "unknown")")
                    #endif
                case .readyToPlay:
                    break // Already playing
                default:
                    break
                }
            }
        }

        avPlayer.play()
        isPlaying = true
        onAudioPlayed?("auto")
    }

    private func togglePlayback() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    private func cleanup() {
        autoAdvanceTask?.cancel()
        statusObserver?.invalidate()
        statusObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
