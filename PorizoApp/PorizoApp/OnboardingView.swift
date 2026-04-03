//
//  OnboardingView.swift
//  PorizoApp
//
//  3-slide onboarding wizard with swipeable pages and page dots.
//  Slide 1: Audio hook — "Hear what a birthday sounds like" with sample player.
//  Slide 2: "Tell Us Your Story" — how the creation flow works.
//  Slide 3: "Your Voice, Your Way" — voice personalization pitch.
//

import SwiftUI
import AVFoundation

struct OnboardingView: View {
    var sampleAudioURL: String?
    let onComplete: () -> Void
    let onSkip: () -> Void

    @State private var currentPage = 0
    @State private var player: AVPlayer?
    @State private var playerItem: AVPlayerItem?
    @State private var isPlaying = false
    @State private var isLoading = false
    @State private var loadFailed = false
    @State private var playbackProgress: Double = 0
    @State private var currentTime: TimeInterval = 0
    @State private var duration: TimeInterval = 0
    @State private var timeObserver: Any?
    @State private var endPlaybackObserver: NSObjectProtocol?
    @State private var statusObserver: NSKeyValueObservation?

    private let pageCount = 3

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Skip button (top-right)
                HStack {
                    Spacer()
                    if currentPage < pageCount - 1 {
                        Button {
                            stopSamplePlayback()
                            onSkip()
                        } label: {
                            Text("Skip")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
                .frame(height: 44)
                .padding(.horizontal, 20)

                // Pages
                TabView(selection: $currentPage) {
                    slideOne.tag(0)
                    slideTwo.tag(1)
                    slideThree.tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .automatic))
                .onChange(of: currentPage) { _, newPage in
                    // Stop audio when swiping away from slide 1
                    if newPage != 0 { stopSamplePlayback() }
                }

                // Bottom CTAs
                VStack(spacing: 12) {
                    Button {
                        if currentPage < pageCount - 1 {
                            withAnimation(.easeInOut) { currentPage += 1 }
                        } else {
                            stopSamplePlayback()
                            onComplete()
                        }
                    } label: {
                        Text(currentPage < pageCount - 1 ? "Continue" : "Get Started")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }

                    if currentPage == pageCount - 1 {
                        Button {
                            stopSamplePlayback()
                            onSkip()
                        } label: {
                            Text("Sign in")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.gold)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
                .animation(.easeInOut(duration: 0.2), value: currentPage)
            }
        }
        .onAppear { prepareSampleAudio() }
        .onDisappear { stopSamplePlayback() }
    }

    // MARK: - Slide 1: Welcome

    private var slideOne: some View {
        VStack(spacing: 24) {
            Spacer()

            Circle()
                .fill(DesignTokens.gold)
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "mic.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.white)
                )
                .accessibilityHidden(true)

            Text("Create Songs That\nSound Like You")
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text("Turn your special moments into personalized songs with AI-powered music generation")
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.horizontal, 40)

            // Audio player widget — only shown when a sample URL is configured
            if sampleAudioURL != nil && !loadFailed {
                HStack(spacing: 12) {
                    Button {
                        toggleSamplePlayback()
                    } label: {
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 44, height: 44)
                            .overlay(
                                Group {
                                    if isLoading {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                            .scaleEffect(0.8)
                                    } else {
                                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                                            .font(.system(size: 16))
                                            .foregroundStyle(.white)
                                    }
                                }
                            )
                    }
                    .disabled(isLoading)
                    .accessibilityLabel(isLoading ? "Loading sample" : isPlaying ? "Pause sample" : "Play sample")

                    VStack(alignment: .leading, spacing: 4) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(DesignTokens.border)
                                    .frame(height: 4)
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(DesignTokens.gold)
                                    .frame(width: geo.size.width * playbackProgress, height: 4)
                                    .animation(.linear(duration: 0.1), value: playbackProgress)
                            }
                        }
                        .frame(height: 4)

                        Text("\(formatTime(currentTime)) / \(formatTime(duration))")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(16)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 40)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Sample song preview")
            }

            Text("Make one in 90 seconds")
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Slide 2: Tell Your Story

    private var slideTwo: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "bubble.left.and.text.bubble.right.fill")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.gold)
                .accessibilityHidden(true)

            Text("Tell Us Your Story")
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text("Share who the song is for, the occasion,\nand your favorite memories.\nOur AI crafts lyrics just for them.")
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.horizontal, 40)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Slide 3: Make It Personal

    private var slideThree: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.goldSoft)
                    .frame(width: 80, height: 80)

                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.gold)
            }
            .accessibilityHidden(true)

            Text("Your Voice, Your Way")
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text("Use AI vocals or optionally add your\nown voice to make songs even more personal.")
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.horizontal, 40)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Sample Audio Playback (AVPlayer for remote streaming)

    private func prepareSampleAudio() {
        guard let urlString = sampleAudioURL,
              let url = URL(string: urlString) else {
            return
        }

        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            #if DEBUG
            print("[OnboardingView] Failed to configure audio session: \(error.localizedDescription)")
            #endif
        }

        isLoading = true
        let item = AVPlayerItem(url: url)
        playerItem = item
        let avPlayer = AVPlayer(playerItem: item)
        player = avPlayer

        // Observe item status for readiness (pattern from PlaybackController)
        statusObserver = item.observe(\.status, options: [.initial, .new]) { observedItem, _ in
            Task { @MainActor in
                switch observedItem.status {
                case .readyToPlay:
                    isLoading = false
                    loadDurationAsync(observedItem)

                case .failed:
                    #if DEBUG
                    print("[OnboardingView] Player item failed: \(observedItem.error?.localizedDescription ?? "unknown")")
                    #endif
                    isLoading = false
                    loadFailed = true

                case .unknown:
                    break

                @unknown default:
                    break
                }
            }
        }

        // Observe end of playback to reset state
        endPlaybackObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { _ in
            Task { @MainActor in
                isPlaying = false
                currentTime = 0
                playbackProgress = 0
                avPlayer.seek(to: .zero)
                removeTimeObserver()
            }
        }

        // Add periodic time observer for playback progress
        timeObserver = avPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { time in
            let seconds = time.seconds
            guard seconds.isFinite else { return }
            currentTime = seconds
            if duration > 0 {
                playbackProgress = min(1, seconds / duration)
            }
        }
    }

    private func loadDurationAsync(_ item: AVPlayerItem) {
        Task {
            do {
                let loaded = try await item.asset.load(.duration)
                let seconds = loaded.seconds
                if seconds.isFinite && seconds > 0 {
                    duration = seconds
                }
            } catch {
                #if DEBUG
                print("[OnboardingView] Could not load duration: \(error.localizedDescription)")
                #endif
            }
        }
    }

    private func toggleSamplePlayback() {
        guard let player, !isLoading else { return }

        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    private func stopSamplePlayback() {
        player?.pause()
        isPlaying = false
        removeTimeObserver()
        if let observer = endPlaybackObserver {
            NotificationCenter.default.removeObserver(observer)
            endPlaybackObserver = nil
        }
    }

    private func removeTimeObserver() {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

#Preview {
    OnboardingView(
        sampleAudioURL: nil,
        onComplete: { print("Complete") },
        onSkip: { print("Skip") }
    )
}
